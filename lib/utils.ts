/**
 * lib/utils.ts
 * Shared formatting and helper utilities used across the app.
 */

// ── College formatting ────────────────────────────────────────────────────────

export function fmtTuition(n: number): string {
  if (!n) return 'N/A';
  const k = n / 1000;
  return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
}

export function fmtSalary(n: number): string {
  if (!n) return 'N/A';
  return `$${n.toLocaleString()}`;
}

export function fmtHousing(n: number): string {
  if (!n) return 'N/A';
  return `$${n.toLocaleString()}/yr`;
}

export function autoBucket(rate: number): 'reach' | 'target' | 'safety' {
  if (rate <= 15) return 'reach';
  if (rate <= 40) return 'target';
  return 'safety';
}

// ── Number / boolean coercion (safe for DB values) ───────────────────────────

/** Safely coerce any value (string or number) to a number */
export function toNum(val: unknown, fallback = 0): number {
  const parsed = parseFloat(String(val));
  return isNaN(parsed) ? fallback : parsed;
}

/** Safely coerce to boolean (handles "true"/"false" strings from DB) */
export function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  return String(val) === 'true' || val === 1 || String(val) === '1';
}

// ── Time formatting ───────────────────────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)     return 'Just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

// ── Profile Strength Score V5 — Dual-Axis Gap-Sensitive Model ───────────────
// Single source of truth — used by profile page, dashboard, and any future consumer.
//
// Two independent axes, each scored 0–99:
//   Academic Axis  — selective-pool SAT/ACT percentile (boosted above 1500/33)
//                    + GPA percentile (boosted above 3.7 UW)
//   EC Axis        — tier base + leadership bonus
//                    non-elite (tier 2/3/4, no D1): per-tier caps (T4→25, T3→46, T2→53)
//                    elite (tier 1 OR D1 athlete):  full 0–99, D1 floor at 62
//
// Final score = gap-sensitive merge of both axes + rigor bonus (0–8):
//   stronger axis ≥ 91 (elite floor): stronger sets base, weaker adds 0–10 bonus
//     — if academic axis < 45 and EC is dominant: weak-acad penalty, bonus capped at 5
//     — if academic dominates (acad < 99) and EC is weak (< 40 or < 60):
//       pre-rigor merge is capped (89 or 92) to prevent one-pillar inflation
//   otherwise gap-sensitive blend:
//     gap ≤ 20 → 65% stronger / 35% weaker
//     gap ≤ 50 → 75% stronger / 25% weaker
//     gap > 50 → 88% stronger / 12% weaker
//
// D1 athlete: EC axis floor 62, final score floor 78 (Strong Match minimum).
// No ED or Legacy hooks (strategy choices, not profile quality).
// Major multiplier is advisory text only — does NOT change the score.

// ── Selective-pool SAT percentile table ──
// Reflects where a score ranks among applicants to top-100 schools,
// not the national test-taking population. Meaningfully differentiates 1400–1600.
const SAT_PERCENTILES: [number, number][] = [
  [1600, 99], [1590, 98], [1580, 96], [1570, 94], [1560, 92],
  [1550, 90], [1540, 87], [1530, 85], [1520, 82], [1510, 79],
  [1500, 76], [1490, 73], [1480, 70], [1470, 67], [1460, 64],
  [1450, 61], [1440, 58], [1420, 52], [1400, 46], [1380, 41],
  [1350, 35], [1320, 30], [1280, 24], [1240, 19], [1200, 15],
  [1150, 11], [1100, 8],  [1050, 5],  [1000, 3],
];

const ACT_PERCENTILES: [number, number][] = [
  [36, 99], [35, 97], [34, 95], [33, 92], [32, 90],
  [31, 88], [30, 85], [29, 82], [28, 78], [27, 74],
  [26, 70], [25, 65], [24, 59], [23, 53], [22, 47],
  [21, 40], [20, 34], [19, 27], [18, 21], [17, 16],
  [16, 11], [15, 7],  [14, 4],  [13, 2],
];

const GPA_PERCENTILES: [number, number][] = [
  [4.00, 96], [3.95, 94], [3.90, 92], [3.85, 89], [3.80, 86],
  [3.70, 82], [3.60, 77], [3.50, 72], [3.40, 66], [3.30, 60],
  [3.20, 54], [3.10, 48], [3.00, 42], [2.80, 32], [2.60, 22],
  [2.40, 14], [2.20, 8],  [2.00, 4],
];

/** Interpolate a value against a percentile table (sorted high→low) */
function lookupPercentile(value: number, table: [number, number][]): number {
  if (value <= 0) return 0;
  if (value >= table[0][0]) return table[0][1];
  if (value <= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [hiVal, hiPct] = table[i];
    const [loVal, loPct] = table[i + 1];
    if (value >= loVal && value <= hiVal) {
      const t = (value - loVal) / (hiVal - loVal);
      return Math.round(loPct + t * (hiPct - loPct));
    }
  }
  return 50;
}

export function satPercentile(sat: number): number { return lookupPercentile(sat, SAT_PERCENTILES); }
export function actPercentile(act: number): number { return lookupPercentile(act, ACT_PERCENTILES); }
export function gpaPercentile(gpa: number): number { return lookupPercentile(gpa, GPA_PERCENTILES); }

// ── SAT axis score (0–99): selective-pool percentile + exponential boost above 1500 ──
// t=0 at 1500, t=1 at 1600; exponent 0.6 (concave, gentler than old 0.35), max +8.
// Clamped to 99 — all axis scores use the same 0–99 range as ecAxis.
function satAxisScore(sat: number): number {
  const pctile = lookupPercentile(sat, SAT_PERCENTILES);
  if (sat < 1500) return pctile;
  const t = (sat - 1500) / 100;
  return Math.min(pctile + 8 * Math.pow(t, 0.6), 99);
}

// ── ACT axis score (0–99): selective-pool percentile ──
// Table differentiates 34/35/36: 32→90, 33→92, 34→95, 35→97, 36→99.
function actAxisScore(act: number): number {
  return Math.min(lookupPercentile(act, ACT_PERCENTILES), 99);
}

// ── GPA axis score (0–99): percentile + exponential boost above 3.7 UW ──
// Threshold 3.7 UW (≈4.625/5.0); exponent 1.5 (slow start); max bonus +6.
// Clamped to 99 so GPA stays on the same scale as all other axes.
function gpaAxisScore(normalizedGpa: number): number {
  const pctile = lookupPercentile(normalizedGpa, GPA_PERCENTILES);
  if (normalizedGpa < 3.7) return pctile;
  const t = (normalizedGpa - 3.7) / (4.0 - 3.7);
  return Math.min(pctile + 6 * Math.pow(t, 1.5), 99);
}

// ── Academic axis (0–99): GPA 55% + best test score 45% ──
// Sub-scores are already clamped to 99, so result is also ≤ 99.
// Test-optional: no test provided → GPA carries full weight (not penalised).
function calcAcademicAxis(normalizedGpa: number, sat: number, act: number): number {
  const gpaS  = gpaAxisScore(normalizedGpa);
  const satS  = sat > 0 ? satAxisScore(sat) : 0;
  const actS  = act > 0 ? actAxisScore(act) : 0;
  const testS = Math.max(satS, actS);
  if (testS === 0) return gpaS;
  return Math.min((gpaS * 0.55) + (testS * 0.45), 99);
}

// ── EC axis (0–99) ──
// Elite trigger: tier 1 (National/International) OR D1 recruited athlete
//   elite   → full 0–99 range, leadership bonus up to +20
//   non-elite → per-tier caps: T2 max 53, T3 max 38, T4 max 22
const EC_TIER_LABELS: Record<number, string> = {
  1: 'National / International',
  2: 'State / Regional',
  3: 'School-Level',
  4: 'Club / Volunteer',
};

function calcEcAxis(ecTier: number, leadershipRoles: number, isAthlete: boolean): number {
  const isEliteEC = ecTier === 1 || isAthlete;
  // Tier bases spread across a wider range so tiers are meaningfully distinct.
  // Tier 3 moved 20→30, Tier 2 moved 35→45.
  const tierBases: Record<number, number> = { 1: 75, 2: 45, 3: 30, 4: 12 };
  const base = tierBases[ecTier] ?? 12;
  const leadershipBonus = isEliteEC
    ? Math.min(leadershipRoles * 4, 20)
    : Math.min(leadershipRoles * 2, 8);
  const raw = Math.min(base + leadershipBonus, 99);
  // Per-tier caps for non-elite — replaces the flat cap of 28 which compressed
  // tier 2 and 3 down to the same ceiling as tier 4.
  // Tier 4 cap (22) = base(12) + max leadership(8) + small buffer — no inflation
  // Tier 3 cap (38) = base(30) + max leadership(8) — natural ceiling, no inflation
  // Tier 2 cap (53) = base(45) + leadership room — state achievers can earn into mid-50s
  const tierCaps: Record<number, number> = { 2: 53, 3: 38, 4: 22 };
  const cap = tierCaps[ecTier] ?? 25;
  const score = isEliteEC ? raw : Math.min(raw, cap);
  // D1 recruited athletes get a minimum EC axis of 62 regardless of tier —
  // a coach-backed recruitment slot is a meaningful admissions lever even without
  // national-level achievement in that sport.
  if (isAthlete && score < 62) return 62;
  return score;
}

// ── Rigor bonus (0–8): additive only, not a primary pillar ──
// 60% absolute AP count + 40% ratio of APs taken vs offered
function calcRigorBonus(apTaken: number, apOffered: number): number {
  if (!apOffered || !apTaken) return 0;
  const abs   = Math.min(apTaken / 10, 1.0);
  const ratio = Math.min(apTaken / apOffered, 1.0);
  return (abs * 0.6 + ratio * 0.4) * 8;
}

// ── Gap-sensitive merge ──
// ELITE FLOOR (stronger axis ≥ 91):
//   stronger sets the base; weaker adds a bonus of 0–10 (or 0–5 if weak-acad penalty).
//   EC cap: if academic axis drives the floor but EC is weak (< 40 or < 60), the
//   pre-rigor merge is capped so that a brilliant-but-inactive student scores 90–94
//   rather than 97–98. A truly maxed academic (acad ≥ 99) bypasses this cap.
// NON-ELITE EC (ecAxis < 55):
//   Always use 88/12 academic-dominant blend. The gap-sensitive thresholds create
//   inversions here — crossing the gap=50 boundary drops the academic weight from 0.88
//   to 0.75, which reduces the merged score even as EC increases. Fixed blend prevents
//   this and guarantees tier 2 > tier 3 > tier 4 for any academic profile.
// GAP-SENSITIVE BLEND (ecAxis ≥ 55, stronger < 91):
//   gap ≤ 20 → 65/35 | gap ≤ 50 → 75/25 | gap > 50 → 88/12
const ELITE_FLOOR_THRESHOLD = 91;

function mergeAxes(acadAxis: number, ecAxis: number): number {
  const stronger = Math.max(acadAxis, ecAxis);
  const weaker   = Math.min(acadAxis, ecAxis);
  const gap      = stronger - weaker;

  if (stronger >= ELITE_FLOOR_THRESHOLD) {
    const weakAcadPenalty = ecAxis > acadAxis && acadAxis < 45;
    const maxBonus = weakAcadPenalty ? 5 : 10;
    const raw = stronger + (weaker / 99) * maxBonus;
    // Academic-dominant profiles with weak EC: cap pre-rigor merge.
    // Bypass cap if acad is truly maxed (≥ 99 — a 4.0/1600 deserves 99).
    if (acadAxis >= stronger && acadAxis < 99) {
      if (ecAxis < 40) return Math.min(raw, 89);  // minimal EC  → +rigor up to 8 → final ~90–97
      if (ecAxis < 60) return Math.min(raw, 92);  // moderate EC → +rigor up to 8 → final ~93–99
    }
    return raw;
  }

  // Non-elite EC: fixed academic-dominant blend — no gap-sensitive thresholds.
  // This guarantees higher EC always yields a higher merged score.
  if (ecAxis < 55) return acadAxis * 0.88 + ecAxis * 0.12;

  // Gap-sensitive blend (both axes are meaningful — EC ≥ 55)
  // Guard: result must never be lower than the ec<55 baseline to prevent
  // score inversions when EC crosses the 55 threshold (e.g. D1 bumping ec from 45→62).
  const baseline = acadAxis * 0.88 + ecAxis * 0.12;
  let blended: number;
  if      (gap <= 20) { blended = stronger * 0.65 + weaker * 0.35; }
  else if (gap <= 50) { blended = stronger * 0.75 + weaker * 0.25; }
  else                { blended = stronger * 0.88 + weaker * 0.12; }
  return Math.max(blended, baseline);
}

// ── Interfaces ──

export interface ScoreInput {
  gpa: number;
  gpa_scale?: string;   // '4.0' or '5.0' — defaults to '4.0'
  sat: number;
  act: number;
  ap_offered: number;
  ap_taken: number;
  ec_tier: number;
  leadership_roles: number;
  major_multiplier: number;
  is_ed: boolean;       // kept for UI compatibility — no longer affects score
  is_athlete: boolean;
  is_legacy: boolean;   // kept for UI compatibility — no longer affects score
}

export interface PillarScore {
  label: string;
  score: number;
  max: number;
  pct: number;          // 0–100 normalized percentage
  percentileLabel: string;
  detail: string;
  icon: string;
  color: string;
  bg: string;
}

export interface Insight {
  type: 'gap' | 'action' | 'strength' | 'context';
  icon: string;
  color: string;
  bg: string;
  title: string;
  desc: string;
}

export interface ScoreBreakdown {
  finalScore: number;
  pillars: PillarScore[];
  insights: Insight[];
  hookBonus: number;
  baseScore: number;
  isTestOptional: boolean;
  majorContext: string;
  // Percentiles
  satPctile: number;
  actPctile: number;
  gpaPctile: number;
  testPctile: number;
  // Verdicts
  verdict: string;
  verdictSub: string;
  verdictDesc: string;
  // Backward-compat display helpers
  academicIndex: number;
  academicPct: number;
  rigorOutOf10: number;
  ecOutOf10: number;
  // Absolute EC strength as % of 99 — useful for showing cross-tier comparisons
  // without the "100% of tier ceiling" confusion of the relative ecPct.
  ecAxisAbsolutePct: number;
}

export function calcProfileScore(input: ScoreInput): ScoreBreakdown {
  // Coerce all inputs — PostgreSQL DECIMAL fields arrive as strings
  const gpaScale    = input.gpa_scale === '5.0' ? 5.0 : 4.0;
  const rawGpa      = Number(input.gpa) || 0;
  const sat         = Number(input.sat) || 0;
  const act         = Number(input.act) || 0;
  const apTaken     = Number(input.ap_taken) || 0;
  const apOffered   = Number(input.ap_offered) || 0;
  const ecTier      = Number(input.ec_tier) || 4;
  const leadRoles   = Number(input.leadership_roles) || 0;
  const isAthlete   = !!input.is_athlete;

  // Normalize GPA to 4.0 scale
  const normalizedGpa = gpaScale === 5.0
    ? Math.min(rawGpa / 5.0, 1.0) * 4.0
    : Math.min(rawGpa, 4.0);

  const hasTest      = sat > 0 || act > 0;
  const isTestOptional = !hasTest;
  const isEliteEC    = ecTier === 1 || isAthlete;

  // ── Raw percentiles (for display and insights) ──
  const gpaPctile  = gpaPercentile(normalizedGpa);
  const satPctile  = sat > 0 ? satPercentile(sat) : 0;
  const actPctile  = act > 0 ? actPercentile(act) : 0;
  const testPctile = Math.max(satPctile, actPctile);

  // ── Axis scores ──
  const acadAxis  = calcAcademicAxis(normalizedGpa, sat, act);
  const ecAxis    = calcEcAxis(ecTier, leadRoles, isAthlete);
  const rigorBonus = calcRigorBonus(apTaken, apOffered);

  // ── Merge → final score ──
  const merged    = mergeAxes(acadAxis, ecAxis);
  const rawFinal  = Math.min(Math.round(merged + rigorBonus), 99);
  // D1 recruited athletes get a final-score floor of 78 (Strong Match).
  // A school that wants you on their roster is a different kind of signal than
  // a self-reported EC achievement — it deserves a minimum placement.
  const finalScore = (isAthlete && rawFinal < 78) ? 78 : rawFinal;

  // ── Display: map axes onto pillar cards ──
  // Academic pillar: show acadAxis as percentage of 99
  const academicMax = 99;
  const academicScore = acadAxis;
  const academicPctVal = Math.min(Math.round((acadAxis / 99) * 100), 100);

  const gpaDisplayLabel = gpaScale === 5.0
    ? `${rawGpa.toFixed(2)} / 5.0 (≈${normalizedGpa.toFixed(2)} UW)`
    : `${normalizedGpa.toFixed(2)} UW`;
  const academicPctileLabel = hasTest
    ? `${gpaPctile}th GPA · ${testPctile}th ${sat > 0 ? 'SAT' : 'ACT'} (selective-pool)`
    : `${gpaPctile}th percentile GPA (test-optional)`;
  const academicDetail = hasTest
    ? `${gpaDisplayLabel} · ${sat > 0 ? sat + ' SAT' : act + ' ACT'}`
    : `${gpaDisplayLabel} · No test submitted`;

  // Rigor pillar: show as 0–20 display scale (bonus capped at 8, display ×2.5)
  const rigorDisplayMax = 20;
  const rigorDisplayScore = Math.round((rigorBonus / 8) * rigorDisplayMax * 10) / 10;
  const rigorPct = Math.round((rigorBonus / 8) * 100);
  const rigorLabel = apOffered > 0
    ? `${apTaken} of ${apOffered} APs taken`
    : 'No AP data entered';
  const rigorAdvisory = apTaken >= 8 ? 'above typical range for competitive applicants'
    : apTaken >= 5 ? 'solid — competitive for most schools'
    : apTaken > 0  ? 'below typical 7–12 range for top schools'
    : 'enter your AP courses';

  // EC pillar: show ecAxis as percentage of its effective ceiling
  const ecTierCaps: Record<number, number> = { 1: 99, 2: 53, 3: 38, 4: 22 };
  const ecDisplayMax = isEliteEC ? 99 : (ecTierCaps[ecTier] ?? 22);
  const ecPct = Math.min(Math.round((ecAxis / ecDisplayMax) * 100), 100);
  const ecDetail = `${EC_TIER_LABELS[ecTier] || 'Unknown'} · ${leadRoles} leadership role${leadRoles !== 1 ? 's' : ''}${isAthlete ? ' · D1 Recruit' : ''}`;

  // ── Pillars array ──
  const pillars: PillarScore[] = [
    {
      label: 'Academics',
      score: Math.round(acadAxis * 10) / 10,
      max: academicMax,
      pct: academicPctVal,
      percentileLabel: academicPctileLabel,
      detail: academicDetail,
      icon: 'fa-graduation-cap',
      color: '#004EEB',
      bg: '#eff6ff',
    },
    {
      label: 'Course Rigor',
      score: rigorDisplayScore,
      max: rigorDisplayMax,
      pct: rigorPct,
      percentileLabel: `${rigorLabel} — ${rigorAdvisory}`,
      detail: rigorLabel,
      icon: 'fa-book-open',
      color: '#7c3aed',
      bg: 'var(--violet-light)',
    },
    {
      label: 'Extracurriculars',
      score: Math.round(ecAxis * 10) / 10,
      max: ecDisplayMax,
      pct: ecPct,
      percentileLabel: ecDetail,
      detail: ecDetail,
      icon: 'fa-trophy',
      color: '#059669',
      bg: 'var(--emerald-light)',
    },
  ];

  // ── Major context (advisory only — does not affect score) ──
  const majorMult = Number(input.major_multiplier) || 1.0;
  let majorContext = '';
  if (majorMult <= 0.85) majorContext = 'CS / Engineering is hyper-competitive — the applicant pool at top programs is exceptionally strong.';
  else if (majorMult <= 0.9) majorContext = 'Business / Finance is very competitive — your score reflects a tougher-than-average applicant pool.';
  else if (majorMult >= 1.1) majorContext = 'Niche / undersubscribed majors give you an edge — fewer applicants compete for the same seats.';

  // ── Verdicts ──
  const verdict = finalScore >= 90 ? 'Elite'
    : finalScore >= 78 ? 'Strong Match'
    : finalScore >= 65 ? 'Competitive'
    : finalScore >= 50 ? 'Target Range'
    : 'Building';
  const verdictSub = finalScore >= 90 ? '' : finalScore >= 78 ? ' — Strong Match' : finalScore >= 65 ? ' — Competitive' : finalScore >= 50 ? ' — Target Range' : '';
  const verdictDesc = finalScore >= 90
    ? 'Your profile places you in elite territory. Focus your essays on differentiation — your numbers already speak.'
    : finalScore >= 78
    ? 'Strong profile. Your essays and story are what will push you from Strong Match into elite territory.'
    : finalScore >= 65
    ? 'Competitive profile for target-range schools. Strengthen academics or ECs to move up, and invest heavily in essays.'
    : finalScore >= 50
    ? 'Solid foundation. Focus on course rigor, extracurricular depth, and a compelling personal narrative.'
    : 'Early stage — prioritize GPA, take challenging courses, and build extracurricular leadership.';

  // ── Smart Insights ──
  const insights = generateInsights(
    { gpa: normalizedGpa, sat, act, ap_taken: apTaken, ap_offered: apOffered, ec_tier: ecTier, leadership_roles: leadRoles, is_athlete: isAthlete, major_multiplier: majorMult, gpa_scale: input.gpa_scale, is_ed: !!input.is_ed, is_legacy: !!input.is_legacy },
    pillars, finalScore,
    { gpaPctile, testPctile, satPctile, actPctile },
  );

  // ── Backward-compat helpers ──
  const academicIndex = Math.round(acadAxis);
  const academicPct   = academicPctVal;
  const rigorOutOf10  = Math.round((rigorBonus / 8) * 10 * 10) / 10;
  const ecOutOf10     = Math.round((ecAxis / ecDisplayMax) * 10 * 10) / 10;
  const ecAxisAbsolutePct = Math.min(Math.round((ecAxis / 99) * 100), 100);

  return {
    finalScore, pillars, insights,
    hookBonus: 0,   // ED/Legacy hooks removed; athlete folded into EC axis
    baseScore: Math.round(merged * 10) / 10,
    isTestOptional, majorContext,
    satPctile, actPctile, gpaPctile, testPctile,
    verdict, verdictSub, verdictDesc,
    academicIndex, academicPct, rigorOutOf10, ecOutOf10, ecAxisAbsolutePct,
  };
}

// ── Smart Insights Engine ────────────────────────────────────────────────────
// Deterministic decision tree — no AI, no API calls. Analyzes axis gaps,
// identifies the weakest area, and generates 2–3 actionable recommendations.

function generateInsights(
  p: ScoreInput,
  pillars: PillarScore[],
  finalScore: number,
  pctiles: { gpaPctile: number; testPctile: number; satPctile: number; actPctile: number },
): Insight[] {
  const insights: Insight[] = [];
  const [, , ec] = pillars;
  const isEliteEC = p.ec_tier === 1 || p.is_athlete;

  // 1. SAT/ACT improvement opportunity
  // Use selective-pool thresholds — 1500 is the meaningful inflection point
  if (p.sat > 0 && p.sat < 1500 && pctiles.satPctile < 76) {
    const improved = p.sat + 60;
    const improvedPct = satPercentile(improved);
    insights.push({
      type: 'action',
      icon: 'fa-arrow-trend-up',
      color: '#2563eb',
      bg: '#eff6ff',
      title: 'A 60-point SAT jump would move you significantly',
      desc: `Going from ${p.sat} (${pctiles.satPctile}th in selective pool) to ${improved} (${improvedPct}th) is achievable with focused prep and meaningfully strengthens your academic axis.`,
    });
  } else if (p.sat > 0 && p.sat >= 1500 && p.sat < 1560) {
    insights.push({
      type: 'action',
      icon: 'fa-arrow-trend-up',
      color: '#2563eb',
      bg: '#eff6ff',
      title: 'Pushing past 1560 unlocks significant score gains',
      desc: `Your SAT is already strong, but the scoring model rewards 1560+ with an accelerating boost. Focused prep on your weaker section could meaningfully lift your profile score.`,
    });
  } else if (p.act > 0 && p.act < 33 && pctiles.actPctile < 95) {
    const improved = p.act + 2;
    const improvedPct = actPercentile(improved);
    insights.push({
      type: 'action',
      icon: 'fa-arrow-trend-up',
      color: '#2563eb',
      bg: '#eff6ff',
      title: `A 2-point ACT increase would be impactful`,
      desc: `Going from ${p.act} (${pctiles.actPctile}th) to ${improved} (${improvedPct}th) is a realistic goal that would strengthen your academic axis.`,
    });
  } else if (!p.sat && !p.act) {
    insights.push({
      type: 'action',
      icon: 'fa-clipboard-question',
      color: '#2563eb',
      bg: '#eff6ff',
      title: 'Consider submitting a test score',
      desc: `You're in test-optional mode. A strong SAT (1500+) or ACT (33+) adds meaningful weight to your academic axis and signals rigor to admissions officers.`,
    });
  }

  // 2. Rigor — additive bonus context
  if (p.ap_offered > 0 && p.ap_taken > 0) {
    const ratio = p.ap_taken / p.ap_offered;
    const unused = p.ap_offered - p.ap_taken;
    if (ratio < 0.5 && unused > 3) {
      insights.push({
        type: 'action',
        icon: 'fa-book-open',
        color: '#7c3aed',
        bg: 'var(--violet-light)',
        title: `${unused} more APs available at your school`,
        desc: `You've taken ${p.ap_taken} of ${p.ap_offered} available APs (${Math.round(ratio * 100)}%). Top applicants typically take 7–12. Each additional AP adds a small but real bonus to your score.`,
      });
    } else if (p.ap_taken >= 8 && ratio >= 0.6) {
      insights.push({
        type: 'strength',
        icon: 'fa-fire',
        color: '#059669',
        bg: 'var(--emerald-light)',
        title: 'Course rigor is a real strength',
        desc: `${p.ap_taken} APs puts you well above the typical applicant. Make sure your essays showcase what you learned — not just that you did it.`,
      });
    }
  } else if (!p.ap_offered || !p.ap_taken) {
    // Covers: both zero, or offered entered but taken is still 0
    insights.push({
      type: 'action',
      icon: 'fa-book-open',
      color: '#7c3aed',
      bg: 'var(--violet-light)',
      title: 'Add your AP / IB courses',
      desc: `Enter how many AP or IB courses your school offers and how many you've taken. Course rigor adds a bonus of up to 8 points on top of your score.`,
    });
  }

  // 3. EC depth / elite EC recognition
  if (isEliteEC) {
    insights.push({
      type: 'strength',
      icon: 'fa-medal',
      color: '#059669',
      bg: 'var(--emerald-light)',
      title: p.is_athlete
        ? 'D1 recruitment is one of the strongest admissions hooks'
        : 'National-level ECs are a genuine differentiator',
      desc: p.is_athlete
        ? `Athletic recruitment gives you a reserved-seat conversation that bypasses normal review at many schools. Coordinate your timeline closely with your coach and admissions office.`
        : `This level of achievement sets you apart from the vast majority of applicants. Your essays should tell the story behind this — the setbacks, the growth, not just the accolade.`,
    });
  } else if (ec.pct < 45) {
    insights.push({
      type: 'action',
      icon: 'fa-seedling',
      color: '#059669',
      bg: 'var(--emerald-light)',
      title: 'Deepen one activity rather than adding breadth',
      desc: `Admissions officers value sustained commitment over a long list. Aim for a leadership role or a tangible outcome in your strongest activity — it can meaningfully shift your EC axis.`,
    });
  }

  // 4. GPA strength callout (only if no strength insight yet)
  if (pctiles.gpaPctile >= 89 && p.gpa >= 3.85 && insights.filter(i => i.type === 'strength').length === 0) {
    insights.push({
      type: 'strength',
      icon: 'fa-star',
      color: '#d97706',
      bg: 'var(--amber-light)',
      title: 'Your GPA is in the top 10% of selective applicants',
      desc: `A ${p.gpa.toFixed(2)} UW puts you at the ${pctiles.gpaPctile}th percentile. This is a strong foundation. Pair it with a compelling test score and ECs to reach the elite tier.`,
    });
  }

  // 5. Major context
  if (p.major_multiplier <= 0.85 && finalScore < 85) {
    insights.push({
      type: 'context',
      icon: 'fa-triangle-exclamation',
      color: '#92400e',
      bg: 'var(--amber-light)',
      title: 'CS / Engineering applicant pools are hyper-competitive',
      desc: `For top CS programs, you're competing against a self-selected pool of strong STEM students. Aim for 85+ to be competitive at reaches, or consider applying undeclared and declaring later.`,
    });
  }

  return insights.slice(0, 3);
}

export function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

// ── College DB row → display shape ───────────────────────────────────────────
// NOTE: /api/colleges GET already enriches rows with master data (accept_rate,
// grad_rate, tuition_in, tuition_out, ratio, room_board, median_salary),
// so we never need to reference MASTER_COLLEGES on the client side.

export interface CollegeDisplay {
  id: string;
  name: string;
  bucket: 'reach' | 'target' | 'safety';
  accept: number;
  sat: string;
  act: string;
  inState: string;
  outState: string;
  grad: number;
  ratio: string;
  housing: string;
  salary: string;
  classSize: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbToCollegeDisplay(row: any): CollegeDisplay {
  const accept = Number(row.accept_rate) || 50;
  return {
    id:       String(row.id),
    name:     String(row.name ?? ''),
    bucket:   (row.bucket as 'reach' | 'target' | 'safety') ?? autoBucket(accept),
    accept,
    grad:     Number(row.grad_rate) || 80,
    sat:      row.sat_range && row.sat_range !== 'N/A' ? row.sat_range : 'N/A',
    act:      row.act_range && row.act_range !== 'N/A' ? row.act_range : 'N/A',
    inState:  row.tuition_in  && row.tuition_in  !== 'N/A' ? fmtTuition(Number(row.tuition_in))  : 'N/A',
    outState: row.tuition_out && row.tuition_out !== 'N/A' ? fmtTuition(Number(row.tuition_out)) : 'N/A',
    ratio:    row.ratio ?? 'N/A',
    housing:  row.room_board    ? fmtHousing(Number(row.room_board))   : 'N/A',
    salary:   row.median_salary ? fmtSalary(Number(row.median_salary)) : 'N/A',
    classSize: '—',
  };
}
