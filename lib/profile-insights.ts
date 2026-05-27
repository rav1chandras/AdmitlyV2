/**
 * profile-insights.ts — Heuristic derivation of activity impact scores
 * and profile themes. Pure functions, no DB / network access.
 *
 * Phase 1 of the Profile Builder uses this module to render Top Themes
 * and per-activity impact scores without an LLM call. Phase 2 will
 * layer LLM analysis on top — the output shape is intentionally close
 * to what the LLM will return so the UI doesn't change between phases.
 */

export type ActivityCategory =
  | 'leadership' | 'community' | 'arts' | 'academic' | 'athletics' | 'work' | 'other';

export interface Activity {
  id?: number;
  name: string;
  category: ActivityCategory;
  role?: string | null;
  hours_per_week?: number | null;
  start_grade?: number | null;
  end_grade?: number | null;
  is_current?: boolean;
  description?: string | null;
  sort_order?: number;
}

export interface ImpactBreakdown {
  score: number;            // 1.0–10.0
  label: 'High impact' | 'Strong' | 'Moderate' | 'Light';
  color: 'green' | 'amber' | 'gray';
}

export interface ThemeScore {
  key: string;
  label: string;
  score: number;            // 0.0–10.0
  rank: 'Excellent' | 'Strong' | 'Good' | 'Building';
}

// ─── Activity Impact ──────────────────────────────────────────────
// We start at 2.0 baseline, then add up to ~8.0 in bonuses. Caps at 10.
// Reason for keeping it deterministic: students will revisit and tweak
// activities to see scores change. LLM-derived scores wouldn't be
// stable enough to support that interaction.

const LEADERSHIP_KEYWORDS = [
  'captain', 'president', 'founder', 'co-founder', 'editor', 'chief',
  'lead', 'head', 'director', 'chair', 'organizer', 'manager',
];

const CATEGORY_BASE_MULTIPLIER: Record<ActivityCategory, number> = {
  leadership: 1.2,
  community:  1.0,
  academic:   1.0,
  athletics:  0.9,
  arts:       0.85,
  work:       0.8,
  other:      0.7,
};

export function scoreActivityImpact(a: Activity): ImpactBreakdown {
  const startG = a.start_grade ?? 11;
  const endG   = a.is_current ? 12 : (a.end_grade ?? startG);
  const years  = Math.max(0, Math.min(4, endG - startG + 1));
  const hrs    = Math.max(0, Math.min(20, a.hours_per_week ?? 0));

  const longevityBonus = years * 0.8;          // up to +3.2
  const intensityBonus = hrs / 4;              // up to +5
  const role = (a.role || '').toLowerCase();
  const isLeader = LEADERSHIP_KEYWORDS.some(k => role.includes(k));
  const roleBonus = isLeader ? 1.5 : 0;
  const catMult   = CATEGORY_BASE_MULTIPLIER[a.category] ?? 1.0;

  const raw = (2 + longevityBonus + intensityBonus + roleBonus) * catMult;
  const score = Math.max(1, Math.min(10, Math.round(raw * 10) / 10));

  const label  = score >= 8 ? 'High impact'
              : score >= 6.5 ? 'Strong'
              : score >= 4.5 ? 'Moderate'
              : 'Light';
  const color  = score >= 8 ? 'green'
              : score >= 5 ? 'amber'
              : 'gray';

  return { score, label, color };
}

// ─── Themes ───────────────────────────────────────────────────────
// Each activity category contributes to one or more themes with a
// weight. Theme score = sum of (impact × weight) across activities,
// then divided by a calibration constant and clamped to 0–10.

type ThemeKey = 'leadership' | 'community_impact' | 'resilience' | 'curiosity' | 'creativity';

const THEME_LABELS: Record<ThemeKey, string> = {
  leadership:       'Leadership',
  community_impact: 'Community impact',
  resilience:       'Resilience',
  curiosity:        'Curiosity',
  creativity:       'Creativity',
};

const CATEGORY_TO_THEMES: Record<ActivityCategory, Partial<Record<ThemeKey, number>>> = {
  leadership: { leadership: 1.0, curiosity: 0.2 },
  community:  { community_impact: 1.0, resilience: 0.3 },
  arts:       { creativity: 1.0, curiosity: 0.4 },
  academic:   { curiosity: 1.0, leadership: 0.2 },
  athletics:  { resilience: 0.9, leadership: 0.3 },
  work:       { resilience: 0.8, community_impact: 0.2 },
  other:      { curiosity: 0.4 },
};

// Activities scoring 8+ trigger a "leadership" extra weight regardless
// of category — high-impact roles imply leadership across all domains.
const HIGH_IMPACT_LEADERSHIP_BONUS = 0.4;

// Calibration: tuned so a balanced 4-activity profile lands themes around 6-8.
const THEME_DIVISOR = 4.0;

export function deriveThemes(activities: Activity[]): ThemeScore[] {
  const sums: Record<ThemeKey, number> = {
    leadership: 0, community_impact: 0, resilience: 0, curiosity: 0, creativity: 0,
  };

  for (const a of activities) {
    const impact = scoreActivityImpact(a).score;
    const weights = CATEGORY_TO_THEMES[a.category] || {};
    for (const k of Object.keys(weights) as ThemeKey[]) {
      sums[k] += impact * (weights[k] || 0);
    }
    if (impact >= 8) {
      sums.leadership += impact * HIGH_IMPACT_LEADERSHIP_BONUS;
    }
  }

  return (Object.keys(sums) as ThemeKey[])
    .map((key) => {
      const raw = sums[key] / THEME_DIVISOR;
      const score = Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
      const rank: ThemeScore['rank'] =
        score >= 8.5 ? 'Excellent'
        : score >= 7 ? 'Strong'
        : score >= 5 ? 'Good'
        : 'Building';
      return { key, label: THEME_LABELS[key], score, rank };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Completion ───────────────────────────────────────────────────
// Drives the Profile Completion checklist on the right rail.

export interface CompletionInput {
  has_academic: boolean;     // GPA + (SAT or ACT)
  activity_count: number;
  has_sat: boolean;
  has_act: boolean;
  has_intended_major: boolean;
}

export interface CompletionResult {
  pct: number;
  items: { key: string; label: string; status: 'done' | 'partial' | 'todo'; detail: string; phase: 1 | 2; }[];
}

export function deriveCompletion(c: CompletionInput): CompletionResult {
  const items: CompletionResult['items'] = [
    {
      key: 'academic',
      label: 'Academic profile',
      status: c.has_academic ? 'done' : 'todo',
      detail: c.has_academic ? 'Complete' : 'Add GPA + a test score',
      phase: 1,
    },
    {
      key: 'activities',
      label: 'Activities',
      status: c.activity_count >= 6 ? 'done' : c.activity_count > 0 ? 'partial' : 'todo',
      detail: c.activity_count === 0
        ? 'Add your first activity'
        : `${c.activity_count} of 6 added`,
      phase: 1,
    },
    {
      key: 'tests',
      label: 'Standardized tests',
      status: c.has_sat && c.has_act ? 'done' : (c.has_sat || c.has_act) ? 'partial' : 'todo',
      detail: c.has_sat && c.has_act ? 'Both submitted'
            : c.has_sat ? 'SAT only · add ACT'
            : c.has_act ? 'ACT only · add SAT'
            : 'Add SAT or ACT',
      phase: 1,
    },
    {
      key: 'major',
      label: 'Intended major',
      status: c.has_intended_major ? 'done' : 'todo',
      detail: c.has_intended_major ? 'Set' : 'Select a target field',
      phase: 1,
    },
    {
      key: 'stories',
      label: 'Personal stories',
      status: 'todo',
      detail: 'AI-derived in Phase 2',
      phase: 2,
    },
  ];

  const phase1 = items.filter(i => i.phase === 1);
  const phase1Pts = phase1.reduce((sum, i) => sum + (i.status === 'done' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
  const pct = Math.round((phase1Pts / phase1.length) * 100);

  return { pct, items };
}
