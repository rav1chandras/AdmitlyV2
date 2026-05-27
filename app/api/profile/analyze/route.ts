/**
 * /api/profile/analyze — Phase 2 LLM analysis for the Profile Builder.
 *
 *   GET                → returns the cached analysis for the signed-in user
 *                        (with `stale: true` if the inputs have changed since)
 *   POST { force? }    → runs a fresh analysis. Skips the LLM call when the
 *                        content hash matches the cache unless force=true.
 *
 * Cost-control:
 *   - One round-trip per refresh (themes + impact + story relevance + strengthen + recs all in one call)
 *   - Cached in profile_analysis keyed on a SHA-1 of the normalised inputs
 *   - 12-second client debounce + a max of 6 analyses/day per user (via llm_usage rate check)
 *
 * Model: gpt-4o-mini (cheapest sensible model for structured JSON extraction).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import {
  buildContentHash,
  buildUserMessage,
  parseAnalysisResponse,
  SYSTEM_PROMPT,
  type AnalysisInput,
} from '@/lib/profile-analysis-helpers';

export const dynamic = 'force-dynamic';

const MODEL = 'gpt-4o-mini';

// ─── Pull the analysis input from the DB ────────────────────────
async function loadInput(userId: number): Promise<AnalysisInput> {
  const pool = getPool();
  const [profile, settings, acts, stories] = await Promise.all([
    pool.query(`SELECT gpa, sat, act, ap_taken, ap_offered, major_multiplier FROM profiles WHERE user_id = $1`, [userId]),
    pool.query(`SELECT intended_major FROM student_settings WHERE user_id = $1`, [userId]).catch(() => ({ rows: [] as any[] })),
    pool.query(`SELECT id, name, category, role, hours_per_week, start_grade, end_grade, is_current, description FROM student_activities WHERE user_id = $1 ORDER BY sort_order ASC`, [userId]),
    pool.query(`SELECT id, title, summary, grade, theme_tags FROM personal_stories WHERE user_id = $1 ORDER BY sort_order ASC`, [userId]),
  ]);
  const p = profile.rows[0] || {};
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  return {
    academic: {
      gpa: num(p.gpa),
      sat: num(p.sat),
      act: num(p.act),
      ap_taken: num(p.ap_taken),
      ap_offered: num(p.ap_offered),
      intended_major: settings.rows[0]?.intended_major || '',
    },
    activities: acts.rows.map((a: any) => ({
      id: a.id, name: a.name, category: a.category, role: a.role,
      hours_per_week: a.hours_per_week, start_grade: a.start_grade,
      end_grade: a.end_grade, is_current: a.is_current, description: a.description,
    })),
    stories: stories.rows.map((s: any) => ({
      id: s.id, title: s.title, summary: s.summary, grade: s.grade,
      theme_tags: Array.isArray(s.theme_tags) ? s.theme_tags : [],
    })),
  };
}

// ─── GET: cached payload + freshness signal ─────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT content_hash, payload, model, generated_at FROM profile_analysis WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ cached: false });
    }
    // Check if inputs changed since the cached run
    const input = await loadInput(userId);
    const currentHash = buildContentHash(input);
    return NextResponse.json({
      cached: true,
      stale: currentHash !== rows[0].content_hash,
      payload: rows[0].payload,
      model: rows[0].model,
      generated_at: rows[0].generated_at,
    });
  } catch (err: any) {
    if (err?.code === '42P01') {
      return NextResponse.json({ cached: false, warning: 'profile_analysis table missing — run migrations/010_profile_phase2.sql' });
    }
    console.error('[analyze GET] error:', err);
    return NextResponse.json({ error: 'Failed to load analysis.' }, { status: 500 });
  }
}

// ─── POST: run analysis (cache-aware) ───────────────────────────
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-openai-api-key-here') {
    return NextResponse.json({ error: 'Something went wrong with the AI generation engine. Please try again later.' }, { status: 503 });
  }

  const pool = getPool();
  const input = await loadInput(userId);
  if (input.activities.length === 0 && input.stories.length === 0) {
    return NextResponse.json({ error: 'Add at least one activity or story before analyzing.' }, { status: 400 });
  }

  const hash = buildContentHash(input);

  // Cache hit (and not forced) → return cached payload, skip LLM
  if (!force) {
    try {
      const { rows: cached } = await pool.query(
        `SELECT payload, model, generated_at FROM profile_analysis WHERE user_id = $1 AND content_hash = $2`,
        [userId, hash]
      );
      if (cached.length > 0) {
        return NextResponse.json({
          payload: cached[0].payload,
          model: cached[0].model,
          generated_at: cached[0].generated_at,
          cached: true,
        });
      }
    } catch {}
  }

  // ── Daily cap: max 6 analyses per user per day ──
  try {
    const { rows: dailyRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM llm_usage
        WHERE user_id = $1 AND endpoint = 'profile/analyze'
          AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (dailyRows[0].c >= 6) {
      return NextResponse.json({ error: 'Daily limit reached (6/day). Try again later.' }, { status: 429 });
    }
  } catch {
    // llm_usage may not exist on older DBs — non-fatal
  }

  // ── LLM call ──
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  let raw = '';
  let promptTokens = 0;
  let outputTokens = 0;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    raw = completion.choices[0]?.message?.content || '';
    promptTokens = completion.usage?.prompt_tokens || 0;
    outputTokens = completion.usage?.completion_tokens || 0;
  } catch (err: any) {
    const msg = err?.status === 429 ? 'OpenAI rate limit hit — try again in a moment.'
              : err?.status === 401 ? 'Invalid OpenAI API key.'
              : 'Analysis failed. Please try again.';
    console.error('[analyze POST] OpenAI error:', err?.message || err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── Parse + validate ──
  let payload;
  try {
    payload = parseAnalysisResponse(raw);
  } catch (err) {
    console.error('[analyze POST] parse error:', err, 'raw:', raw.slice(0, 500));
    return NextResponse.json({ error: 'Could not parse analysis response.' }, { status: 502 });
  }

  // ── Cache + audit ──
  try {
    await pool.query(
      `INSERT INTO profile_analysis (user_id, content_hash, payload, model, prompt_tokens, output_tokens, generated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         content_hash  = EXCLUDED.content_hash,
         payload       = EXCLUDED.payload,
         model         = EXCLUDED.model,
         prompt_tokens = EXCLUDED.prompt_tokens,
         output_tokens = EXCLUDED.output_tokens,
         generated_at  = EXCLUDED.generated_at,
         updated_at    = NOW()`,
      [userId, hash, payload, MODEL, promptTokens, outputTokens]
    );
  } catch (err) {
    console.warn('[analyze POST] cache write failed (continuing):', err);
  }

  // Audit usage if table exists
  try {
    await pool.query(
      `INSERT INTO llm_usage (user_id, endpoint, model, prompt_tokens, completion_tokens, cost_cents, created_at)
       VALUES ($1, 'profile/analyze', $2, $3, $4, $5, NOW())`,
      [userId, MODEL, promptTokens, outputTokens, Math.round((promptTokens * 0.015 + outputTokens * 0.06) / 1000)]
    );
  } catch {
    // table may not exist or column shape may differ — non-fatal
  }

  return NextResponse.json({ payload, model: MODEL, cached: false, generated_at: new Date().toISOString() });
}
