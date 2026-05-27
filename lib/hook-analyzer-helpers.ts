/**
 * lib/hook-analyzer-helpers.ts
 *
 * Pure helper functions for the hook analyzer route. Extracted into their
 * own module so they can be unit-tested without pulling in next/server,
 * next-auth, or the OpenAI SDK. The route file imports from here.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface HookDimension {
  name: 'Intrigue' | 'Clarity' | 'Originality';
  score: number;     // 1-10
  feedback: string;
}

export interface HookAnalysisResult {
  hook_text: string;
  overall_score: number;
  one_line_verdict: string;
  dimensions: HookDimension[];
  rewrite_suggestion: string;
  rewrite_rationale: string;
  remaining_scores: number;
  rate_limit_reset: number;
}

export interface ParsedHookResponse {
  intrigue_score: number;
  intrigue_feedback: string;
  clarity_score: number;
  clarity_feedback: string;
  originality_score: number;
  originality_feedback: string;
  one_line_verdict: string;
  rewrite_suggestion: string;
  rewrite_rationale: string;
}

// ── Hook extraction ─────────────────────────────────────────────────────────

/**
 * Extract the opening "hook" from the essay. We use the first 3 sentences,
 * but if those total fewer than 30 words we extend to up to 5 sentences or
 * 60 words, whichever comes first. This handles short staccato openers
 * ("It was raining. I was late. I had no umbrella.") without truncating
 * them to a meaningless fragment.
 */
export function extractHook(essay: string): string {
  const trimmed = essay.trim();
  if (!trimmed) return '';

  // Split on sentence-ending punctuation followed by whitespace.
  // This is intentionally simple — robust sentence segmentation is hard
  // and not necessary here. False splits on "Dr." or "U.S." just give us
  // a slightly weirder hook, which the model handles fine.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return trimmed.slice(0, 600);

  let hook = '';
  let count = 0;
  const minWords = 30;
  const maxSentences = 5;
  const maxWords = 60;

  for (const s of sentences) {
    if (count >= maxSentences) break;
    const wordsInS = s.split(/\s+/).length;
    const candidateWords = (hook ? hook.split(/\s+/).length : 0) + wordsInS;
    // If we already have enough words and at least 1 sentence, stop.
    if (count >= 1 && candidateWords > maxWords && hook.split(/\s+/).length >= minWords) break;
    hook = hook ? hook + ' ' + s : s;
    count++;
    // Stop after 3 sentences if we have enough words.
    if (count >= 3 && hook.split(/\s+/).length >= minWords) break;
  }

  // Hard cap at 600 chars regardless, as a safety net.
  return hook.slice(0, 600);
}

// ── Prompt-injection sanitizer ──────────────────────────────────────────────

/**
 * Strip sequences from the hook that could break out of the <hook>
 * delimiter and be interpreted as instructions.
 */
export function sanitizeHookForPrompt(hook: string): string {
  return hook
    // Neutralize literal </hook> and <hook> tags (case-insensitive)
    .replace(/<\s*\/?\s*hook\s*>/gi, '[hook-tag-removed]')
    // Triple backticks could close a markdown fence the model is generating
    .replace(/```/g, '`\u200b`\u200b`')
    // Common prompt-injection markers
    .replace(/\bIGNORE\s+(PREVIOUS|PRIOR|ABOVE)\s+INSTRUCTIONS\b/gi, '[ignored]')
    .replace(/\bSYSTEM\s*:/gi, '[system-marker-removed]:');
}

// ── Robust JSON parser ──────────────────────────────────────────────────────

/**
 * Parse the OpenAI response defensively. The model can return:
 *   - clean JSON (the happy path)
 *   - JSON wrapped in ```json fences
 *   - JSON with extra prose before or after
 *   - JSON with missing fields
 *   - JSON with out-of-range numeric values
 *
 * This function handles all of those without throwing. Fields that can't
 * be recovered get safe defaults; numbers get clamped to [1, 10].
 */
export function parseHookResponse(raw: string): ParsedHookResponse | null {
  if (!raw) return null;

  // Strip markdown fences and any leading/trailing prose around the JSON.
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  // If the model added a preamble like "Here's the JSON:" before the {,
  // find the first { and the last } and extract that range.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  let obj: any;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== 'object') return null;

  // Coerce and clamp every field. Missing fields get defaults that won't
  // crash the UI.
  const clampScore = (v: any): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v));
    if (!Number.isFinite(n)) return 5;
    return Math.max(1, Math.min(10, Math.round(n)));
  };
  const safeStr = (v: any, fallback = ''): string => {
    if (typeof v === 'string') return v.trim().slice(0, 1000);
    if (v == null) return fallback;
    return String(v).slice(0, 1000);
  };

  return {
    intrigue_score:        clampScore(obj.intrigue_score),
    intrigue_feedback:     safeStr(obj.intrigue_feedback, 'No feedback returned.'),
    clarity_score:         clampScore(obj.clarity_score),
    clarity_feedback:      safeStr(obj.clarity_feedback, 'No feedback returned.'),
    originality_score:     clampScore(obj.originality_score),
    originality_feedback:  safeStr(obj.originality_feedback, 'No feedback returned.'),
    one_line_verdict:      safeStr(obj.one_line_verdict, 'Analysis complete.'),
    rewrite_suggestion:    safeStr(obj.rewrite_suggestion, ''),
    rewrite_rationale:     safeStr(obj.rewrite_rationale, ''),
  };
}
