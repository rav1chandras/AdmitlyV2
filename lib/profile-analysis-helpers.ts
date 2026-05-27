/**
 * profile-analysis-helpers.ts — Pure helpers for the Profile Builder
 * Phase 2 LLM analysis. Kept free of next/server, next-auth, the OpenAI
 * SDK, and the DB so they can be unit-tested in isolation.
 *
 * Three responsibilities:
 *   1. Build the LLM messages (system + user) from the user's profile
 *   2. Build a stable content hash so we can short-circuit re-runs
 *   3. Defensively parse + validate the LLM JSON response
 */
import { createHash } from 'crypto';
import type { Activity } from './profile-insights';

// ─── Inputs ──────────────────────────────────────────────────────
export interface AnalysisInput {
  academic: {
    gpa: number;
    sat: number;
    act: number;
    ap_taken: number;
    ap_offered: number;
    intended_major: string;
    course_rigor_label?: string;
  };
  activities: Activity[];
  stories: Array<{
    id?: number;
    title: string;
    summary: string;
    grade?: number | null;
    theme_tags?: string[];
  }>;
}

// ─── Output shape (mirrors the JSON schema in the system prompt) ──
export interface AnalysisPayload {
  verdict: { label: string; subtitle: string };
  themes: Array<{ key: string; label: string; score: number; rationale: string }>;
  activity_scores: Array<{ id: number; score: number; label: string; rationale: string }>;
  story_scores: Array<{ id: number; relevance: number; rationale: string }>;
  areas_to_strengthen: Array<{ title: string; description: string; priority: 'high' | 'medium' | 'low' }>;
  recommendations: Array<{ title: string; description: string; category: string }>;
}

// ─── Content hash for caching ────────────────────────────────────
// Normalises input so reordering activities or whitespace tweaks
// don't bust the cache. SHA-1 is fine here — we're not authenticating
// anything, just detecting "did the user materially change anything?"
export function buildContentHash(input: AnalysisInput): string {
  const norm = {
    a: {
      gpa: input.academic.gpa,
      sat: input.academic.sat,
      act: input.academic.act,
      apt: input.academic.ap_taken,
      apo: input.academic.ap_offered,
      m: input.academic.intended_major,
    },
    acts: [...input.activities]
      .map(a => ({
        n: a.name.trim(),
        c: a.category,
        r: (a.role || '').trim().toLowerCase(),
        h: a.hours_per_week || 0,
        sg: a.start_grade || 0,
        eg: a.end_grade || 0,
        cur: !!a.is_current,
      }))
      .sort((x, y) => x.n.localeCompare(y.n)),
    sts: [...input.stories]
      .map(s => ({
        t: s.title.trim(),
        s: s.summary.trim(),
        g: s.grade || 0,
        tg: [...(s.theme_tags || [])].sort(),
      }))
      .sort((x, y) => x.t.localeCompare(y.t)),
  };
  return createHash('sha1').update(JSON.stringify(norm)).digest('hex');
}

// ─── Prompt construction ─────────────────────────────────────────
export const SYSTEM_PROMPT = `You analyze a high-school student's college admissions profile and return structured JSON insights.

Return STRICTLY valid JSON matching this exact schema (no extra keys, no commentary outside the JSON):

{
  "verdict": { "label": string, "subtitle": string },
  "themes": [
    { "key": string, "label": string, "score": number, "rationale": string }
  ],
  "activity_scores": [
    { "id": number, "score": number, "label": "High impact"|"Strong"|"Moderate"|"Light", "rationale": string }
  ],
  "story_scores": [
    { "id": number, "relevance": number, "rationale": string }
  ],
  "areas_to_strengthen": [
    { "title": string, "description": string, "priority": "high"|"medium"|"low" }
  ],
  "recommendations": [
    { "title": string, "description": string, "category": string }
  ]
}

Rules:
- Themes: 4 to 6 items. Use slug "key" (e.g. "leadership", "community_impact", "resilience", "curiosity", "creativity", "intellectual_curiosity"). Score 0.0–10.0, one decimal. Rationale ≤ 100 chars.
- Activity_scores: ONE per provided activity id, in any order. Score 1.0–10.0, one decimal. Rationale ≤ 80 chars.
- Story_scores: ONE per provided story id. Relevance 0.0–10.0 (admissions impact). Rationale ≤ 80 chars.
- Areas_to_strengthen: 2 to 4 items, the most impactful next moves. Description ≤ 140 chars.
- Recommendations: 3 to 5 concrete actions. Description ≤ 140 chars. Category is short (e.g. "Activities","Tests","Essays","Awards").
- Be honest. Don't inflate scores. A profile with one weak activity should not score 9+ on themes.
- Verdict.label is one of: "Building", "Target range", "Competitive", "Strong match", "Elite".
- Verdict.subtitle is a one-sentence next step (≤ 120 chars).`;

export function buildUserMessage(input: AnalysisInput): string {
  const acts = input.activities.length === 0
    ? '(none yet)'
    : input.activities.map(a => {
        const grade = a.start_grade ? `grade ${a.start_grade}${a.is_current ? '+' : (a.end_grade ? '–' + a.end_grade : '')}` : '';
        return `  [id:${a.id}] "${a.name}" — ${a.category}${a.role ? `, role: ${a.role}` : ''}${a.hours_per_week ? `, ${a.hours_per_week}h/wk` : ''}${grade ? `, ${grade}` : ''}${a.description ? `. ${a.description}` : ''}`;
      }).join('\n');

  const stories = input.stories.length === 0
    ? '(none yet)'
    : input.stories.map(s => {
        const grade = s.grade ? ` (grade ${s.grade})` : '';
        const tags = s.theme_tags && s.theme_tags.length > 0 ? ` [tags: ${s.theme_tags.join(', ')}]` : '';
        return `  [id:${s.id}] "${s.title}"${grade}${tags}\n    ${s.summary || '(no summary)'}`;
      }).join('\n');

  return `STUDENT PROFILE

Academic:
- GPA: ${input.academic.gpa || 'not entered'}
- SAT: ${input.academic.sat || 'not entered'} / ACT: ${input.academic.act || 'not entered'}
- AP/IB: ${input.academic.ap_taken} of ${input.academic.ap_offered} offered
- Intended major: ${input.academic.intended_major || 'undecided'}
- Course rigor: ${input.academic.course_rigor_label || 'unknown'}

Activities (${input.activities.length}):
${acts}

Personal stories (${input.stories.length}):
${stories}

Analyse this profile and return the JSON now.`;
}

// ─── Response parsing ────────────────────────────────────────────
// The model can return:
//   - clean JSON
//   - JSON wrapped in ```json fences
//   - JSON with trailing prose
// We strip fences, find the first { ... } block, parse, then validate.
export function parseAnalysisResponse(raw: string): AnalysisPayload {
  let body = (raw || '').trim();

  // Strip ```json ... ``` fences
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();

  // Pick the first {...} block
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open < 0 || close < open) throw new Error('No JSON object found in response.');
  const slice = body.slice(open, close + 1);

  const parsed = JSON.parse(slice);

  // Defensive defaults
  const verdict = parsed.verdict && typeof parsed.verdict === 'object'
    ? { label: String(parsed.verdict.label || 'Building'), subtitle: String(parsed.verdict.subtitle || '') }
    : { label: 'Building', subtitle: '' };

  const themes = Array.isArray(parsed.themes)
    ? parsed.themes.map((t: any) => ({
        key: String(t.key || 'theme'),
        label: String(t.label || t.key || 'Theme'),
        score: clampScore(t.score, 0, 10),
        rationale: String(t.rationale || '').slice(0, 200),
      })).filter((t: any) => t.label).slice(0, 6)
    : [];

  const activity_scores = Array.isArray(parsed.activity_scores)
    ? parsed.activity_scores.map((a: any) => ({
        id: parseInt(a.id, 10) || 0,
        score: clampScore(a.score, 1, 10),
        label: String(a.label || 'Moderate'),
        rationale: String(a.rationale || '').slice(0, 200),
      })).filter((a: any) => a.id > 0)
    : [];

  const story_scores = Array.isArray(parsed.story_scores)
    ? parsed.story_scores.map((s: any) => ({
        id: parseInt(s.id, 10) || 0,
        relevance: clampScore(s.relevance, 0, 10),
        rationale: String(s.rationale || '').slice(0, 200),
      })).filter((s: any) => s.id > 0)
    : [];

  const areas_to_strengthen = Array.isArray(parsed.areas_to_strengthen)
    ? parsed.areas_to_strengthen.map((a: any) => ({
        title: String(a.title || 'Focus area'),
        description: String(a.description || '').slice(0, 300),
        priority: (['high', 'medium', 'low'].includes(a.priority) ? a.priority : 'medium') as 'high' | 'medium' | 'low',
      })).slice(0, 4)
    : [];

  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.map((r: any) => ({
        title: String(r.title || ''),
        description: String(r.description || '').slice(0, 300),
        category: String(r.category || 'General'),
      })).filter((r: any) => r.title).slice(0, 5)
    : [];

  return { verdict, themes, activity_scores, story_scores, areas_to_strengthen, recommendations };
}

function clampScore(v: any, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10));
}
