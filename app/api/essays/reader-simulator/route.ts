/**
 * /api/essays/reader-simulator
 *
 * Simulates one of two reader perspectives reading a college essay:
 *   - admissions_officer: generic selective private university reader
 *   - teacher: veteran high school English teacher
 *
 * Both return the same response shape so the UI can render them with
 * a single component. Each submission costs one shared-quota slot.
 *
 * Uses gpt-4o-mini — both prompts are focused narrative tasks that
 * don't need the bigger model.
 *
 * The pure helper functions (buildAdmissionsOfficerPrompt,
 * buildTeacherPrompt, parseReaderResponse, sanitizeEssayForPrompt)
 * live in lib/reader-simulator-helpers.ts so they can be unit-tested
 * without pulling in next/server or the OpenAI SDK.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import OpenAI from 'openai';
import { consume, refund, FREE_DAILY_LIMIT } from '@/lib/essay-tools-quota';
import { getJourney, buildFactsBlock } from '@/lib/db_journey';
import { getSettings } from '@/lib/db_settings';
import {
  buildAdmissionsOfficerPrompt,
  buildTeacherPrompt,
  parseReaderResponse,
  coerceTier,
  type ReaderRole,
  type SelectivityTier,
  type ReaderAnalysisResult,
} from '@/lib/reader-simulator-helpers';

export const dynamic = 'force-dynamic';

// Re-export the result type so client code can import it from the route
// path (matches the existing scorer/hook patterns).
export type { ReaderAnalysisResult, ReaderRole, SelectivityTier };

const ALLOWED_ROLES: readonly ReaderRole[] = ['admissions_officer', 'teacher'];

export async function POST(request: NextRequest) {
  // Auth guard
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isPro = !!(session.user && ((session.user as any).subscription_status === 'pro' || (session.user as any).subscription_status === 'premium'));
  const userId = session.user.id as string;
  const numericUserId = parseInt(userId, 10);

  // Parse and validate input BEFORE consuming a quota slot.
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const essay: string = typeof body?.essay === 'string' ? body.essay : '';
  const essayType: string = typeof body?.essay_type === 'string' && body.essay_type.trim()
    ? body.essay_type.trim().slice(0, 100)
    : 'Personal Statement';
  const rawRole: any = body?.reader_role;
  const readerRole: ReaderRole = ALLOWED_ROLES.includes(rawRole) ? rawRole : 'admissions_officer';
  // Selectivity tier only matters for admissions_officer; for teacher we
  // still parse it but ignore it in the prompt builder.
  const selectivityTier: SelectivityTier = coerceTier(body?.selectivity_tier);
  const useJourney = body?.use_journey === true;
  const voiceSamples = Array.isArray(body?.voice_samples)
    ? body.voice_samples
        .map((s: unknown) => typeof s === 'string' ? s.replace(/<\/?(voice_sample_?\d*|system|instructions?)>/gi, '').slice(0, 2000) : '')
        .filter((s: string) => s.trim().split(/\s+/).length >= 50)
        .slice(0, 5)
    : [];

  if (!essay.trim()) {
    return NextResponse.json({ error: 'No essay text provided.' }, { status: 400 });
  }

  const totalWords = essay.trim().split(/\s+/).length;
  // Reader simulator needs the full essay to give a meaningful read, so we
  // use the same 50-word minimum as the main scorer.
  if (totalWords < 50) {
    return NextResponse.json({ error: 'Essay is too short to analyze (minimum 50 words).' }, { status: 400 });
  }
  if (totalWords > 2000) {
    return NextResponse.json({ error: 'Essay is too long (maximum 2,000 words).' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-openai-api-key-here') {
    return NextResponse.json({ error: 'Something went wrong with the AI review engine. Please try again later.' }, { status: 503 });
  }

  // Now consume a quota slot. Pro users bypass.
  const limit = consume(userId, isPro);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You've used all ${FREE_DAILY_LIMIT} free essay analyses for today. Upgrade to Pro for unlimited.`, resetAt: limit.resetAt, upgrade: true, remaining_scores: 0 },
      { status: 429 }
    );
  }

  const openai = new OpenAI({ apiKey });

  try {
    let factsBlock = '';
    if (useJourney && Number.isFinite(numericUserId)) {
      const [journey, settings] = await Promise.all([
        getJourney(numericUserId).catch(() => null),
        getSettings(numericUserId).catch(() => null),
      ]);
      factsBlock = journey
        ? buildFactsBlock(journey, {
            intended_major: settings?.intended_major ?? undefined,
            graduation_year: settings?.graduation_year ?? undefined,
          })
        : '';
    }

    const contextPrefix = factsBlock.trim()
      ? `STUDENT CONTEXT FOR FACT-CHECKING:\n${factsBlock}\nUse this context only as reference data while simulating the reader. Do not invent details outside the essay or this context.\n\n`
      : '';
    const voicePrefix = voiceSamples.length
      ? `STUDENT WRITING SAMPLES FOR VOICE:\n${voiceSamples.map((sample: string, index: number) => `<voice_sample_${index + 1}>\n${sample}\n</voice_sample_${index + 1}>`).join('\n')}\nUse these only to judge whether the essay feels consistent with the student's natural style. Do not copy phrases from the samples.\n\n`
      : '';

    const prompt = contextPrefix + voicePrefix + (readerRole === 'teacher'
      ? buildTeacherPrompt(essay, essayType)
      : buildAdmissionsOfficerPrompt(essay, essayType, selectivityTier));

    const completion = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens:  1100,
      temperature: 0.4, // slightly higher than the scorer to let the "reader voice" come through
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = parseReaderResponse(raw);

    if (!parsed) {
      console.error('[reader-simulator] JSON parse failed:', raw.slice(0, 300));
      refund(userId, isPro);
      return NextResponse.json({ error: 'Failed to parse reader response. Please try again.' }, { status: 500 });
    }

    const result: ReaderAnalysisResult = {
      reader_role:          readerRole,
      // Only include selectivity_tier in the response when it actually
      // affected the prompt (i.e. for the admissions officer persona).
      // For the teacher this stays undefined so the UI doesn't render it.
      selectivity_tier:     readerRole === 'admissions_officer' ? selectivityTier : undefined,
      first_impression:     parsed.first_impression,
      would_remember:       parsed.would_remember,
      key_strengths:        parsed.key_strengths,
      key_concerns:         parsed.key_concerns,
      question_for_student: parsed.question_for_student,
      verdict_sentence:     parsed.verdict_sentence,
      overall_score:        parsed.overall_score,
      remaining_scores:     limit.remaining,
      rate_limit_reset:     limit.resetAt,
    };

    return NextResponse.json(result);

  } catch (err: any) {
    refund(userId, isPro);
    const msg = err?.status === 429 ? 'OpenAI rate limit hit — try again in a moment.'
              : err?.status === 401 ? 'Invalid OpenAI API key.'
              : `Reader analysis failed: ${err?.message ?? 'Unknown error'}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
