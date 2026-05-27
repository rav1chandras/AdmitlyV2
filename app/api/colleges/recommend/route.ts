/**
 * /api/colleges/recommend — College Recommendation Engine v5
 * ──────────────────────────────────────────────────────────
 *
 * Scoring model (100 pts max, strictly enforced):
 *   Academic fit   — logistic probability (SAT + GPA co-factors) (0–25 pts)
 *   GPA fit        — contextual GPA match vs selectivity tier    (0–10 pts)
 *   Major strength — program match + earnings + cohort size      (0–20 pts)
 *   Outcomes       — grad rate + retention + post-grad earnings  (0–15 pts)
 *   Affordability  — net price + median debt + Pell rate         (0–15 pts)
 *   Preferences    — location + school size                      (0– 8 pts)
 *   Boosts         — in-state, ED, athlete, holistic profile     (0– 7 pts)
 *
 * Probability boost pipeline (applied in order, before bucketing):
 *   base → STEM penalty → ED boost → legacy boost → AP rigor boost
 *
 *   ED probability boost:
 *     · accept < 10%:  admitProb × 1.15 (modest — self-selecting pool)
 *     · accept 10–25%: admitProb × 1.30 (biggest advantage)
 *     · accept 25–40%: admitProb × 1.20 (moderate)
 *     · accept >= 40%: no boost
 *
 *   Legacy boost (private nonprofits only, accept < 40%):
 *     · accept < 10%:  ×1.35
 *     · accept 10–25%: ×1.55
 *     · accept 25–40%: ×1.30
 *
 *   AP rigor boost (accept < 35% only, based on ap_taken/ap_offered ratio):
 *     · ratio >= 0.80: ×1.06
 *     · ratio >= 0.60: ×1.04
 *     · ratio >= 0.40: ×1.02
 *
 * Bucket assignment (probability-based + holistic floor):
 *   Reach  — admitProb < 0.18  (or < 0.15 with ED)
 *   Target — everything between reach and safety
 *   Safety — varies by selectivity:
 *     · accept < 40%:  NEVER safety (holistic review — too unpredictable)
 *     · accept 40–55%: admitProb >= 0.75
 *     · accept >= 55%: admitProb >= 0.60
 *
 * Flags:
 *   overmatch_risk — student SAT > 150 above school 75th (yield protection)
 *   gpa_normalized — true if weighted GPA was auto-converted to unweighted
 *
 * v5 improvements over v4:
 *   ✓ Legacy status now modulates admit probability (was unused)
 *   ✓ AP rigor ratio (taken/offered) modulates admit probability at selective schools
 *   ✓ profile.is_ed now defaults the ED flag when URL param absent
 *   ✓ admission_probability surfaced in client response (already computed, now exposed in inputs)
 *
 * v4 baseline:
 *   ✓ GPA is a co-factor in the logistic model (not just post-hoc bonus)
 *   ✓ IQR-normalized SAT z-score (school-aware scaling)
 *   ✓ Weighted GPA auto-detection & normalization (4.0+ → unweighted)
 *   ✓ Holistic profile score (final_score) as a boost signal
 *   ✓ Holistic review floor — sub-40% schools never classified as safety
 *   ✓ publicFilter uses cm.ownership (not pm.control on LEFT JOIN)
 *   ✓ In-state filter uses student's actual state
 *   ✓ Per-bucket ranking preserves TARGET schools during diversity capping
 *   ✓ FIX: capByState skipped when in-state filter active
 *   ✓ Score overflow fixed — point budget sums to exactly 100
 *   ✓ Seed cache — ensureCollegesMaster runs once per cold start
 *   ✓ Yield-protection flag for overmatch detection
 *
 * Returns deep pools for client-side reshuffling:
 *   { pools, page_sizes, inputs, counts }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool, getProfile } from '@/lib/db';
import { getSettings } from '@/lib/db_settings';
import { ensureCollegesMaster } from '@/lib/seed-colleges';
import { ensureProgramsMaster } from '@/lib/seed-programs';
import { getCIPCodesForStudent } from '@/lib/major-cip-map';
import { isPro } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

/* ─────────────────────────────────────────────────────────── */
/* Seeding cache — run once per cold start, not per request    */
/* ─────────────────────────────────────────────────────────── */

let _seeded = false;

async function ensureSeeded() {
  if (_seeded) return;
  await ensureCollegesMaster();
  await ensureProgramsMaster();
  _seeded = true;
}

/* ─────────────────────────────────────────────────────────── */
/* Location helpers                                            */
/* ─────────────────────────────────────────────────────────── */

const REGION_MAP: Record<string, string[]> = {
  northeast:    ['CT','DE','MA','MD','ME','NH','NJ','NY','PA','RI','VT','DC'],
  southeast:    ['AL','AR','FL','GA','KY','LA','MS','NC','SC','TN','VA','WV'],
  midwest:      ['IA','IL','IN','KS','MI','MN','MO','ND','NE','OH','SD','WI'],
  southwest:    ['AZ','NM','OK','TX'],
  west:         ['AK','CA','CO','HI','ID','MT','NV','OR','UT','WA','WY'],
  'west coast': ['CA','OR','WA'],
  'east coast': ['CT','DE','FL','GA','MA','MD','ME','NC','NH','NJ','NY','PA','RI','SC','VA','VT','DC'],
  'new england':['CT','MA','ME','NH','RI','VT'],
  california:   ['CA'],
  texas:        ['TX'],
  florida:      ['FL'],
  'new york':   ['NY'],
};

const US_STATES: Record<string, string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',
  colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',
  hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',
  kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',
  massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',
  missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH',
  'new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC',
  'north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA',
  'rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',
  texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA',
  'west virginia':'WV',wisconsin:'WI',wyoming:'WY',dc:'DC',
};

function getPreferredStates(pref: string): string[] {
  if (!pref) return [];
  const lower = pref.toLowerCase().trim();
  for (const [region, states] of Object.entries(REGION_MAP)) {
    if (lower.includes(region)) return states;
  }
  const matches: string[] = [];
  for (const [name, abbrev] of Object.entries(US_STATES)) {
    if (lower.includes(name)) matches.push(abbrev);
  }
  const allAbbrevs = Object.values(REGION_MAP).flat();
  for (const w of lower.split(/[,\s]+/)) {
    if (w.length === 2 && allAbbrevs.includes(w.toUpperCase())) matches.push(w.toUpperCase());
  }
  return Array.from(new Set(matches));
}

/* ─────────────────────────────────────────────────────────── */
/* Size helper                                                 */
/* ─────────────────────────────────────────────────────────── */

function parseSize(pref: string): { min: number; max: number } | null {
  if (!pref) return null;
  const lower = pref.toLowerCase();
  if (lower.includes('small')  || lower.includes('<5k')   || lower.includes('under 5')) return { min: 0,     max: 5000   };
  if (lower.includes('medium') || lower.includes('5k-15k'))                              return { min: 5000,  max: 15000  };
  if (lower.includes('large')  || lower.includes('>15k')  || lower.includes('15k+'))     return { min: 15000, max: 999999 };
  return null;
}

/* ─────────────────────────────────────────────────────────── */
/* ACT to SAT conversion (College Board concordance)           */
/* ─────────────────────────────────────────────────────────── */

function actToSat(act: number): number {
  const table: [number, number][] = [
    [36,1600],[35,1560],[34,1500],[33,1460],[32,1430],[31,1400],[30,1360],
    [29,1330],[28,1290],[27,1250],[26,1210],[25,1180],[24,1150],[23,1110],
    [22,1080],[21,1050],[20,1020],[19,980],[18,940],[17,900],[16,870],
    [15,830],[14,790],[13,750],[12,710],[11,680],
  ];
  for (let i = 0; i < table.length - 1; i++) {
    const [a1, s1] = table[i];
    const [a2, s2] = table[i + 1];
    if (act >= a2) {
      const t = (act - a2) / (a1 - a2);
      return Math.round(s2 + t * (s1 - s2));
    }
  }
  return 680;
}

/* ─────────────────────────────────────────────────────────── */
/* GPA scale normalization                                     */
/*                                                             */
/* Many students report weighted GPAs (4.0+). The scoring      */
/* model compares against unweighted expectations, so we       */
/* detect and normalise. Heuristic:                            */
/*   > 4.0  → weighted → convert to approximate unweighted     */
/*   ≤ 4.0  → assume already unweighted                        */
/*                                                             */
/* Conversion: maps the 3.0–5.0 weighted range to 2.5–4.0     */
/* unweighted via linear interpolation, which approximates     */
/* common weighting schemes (+0.5 honors, +1.0 AP).            */
/* ─────────────────────────────────────────────────────────── */

function normalizeGPA(rawGPA: number): { gpa: number; wasNormalized: boolean } {
  if (rawGPA <= 0) return { gpa: 0, wasNormalized: false };

  // Already on unweighted 4.0 scale
  if (rawGPA <= 4.0) return { gpa: rawGPA, wasNormalized: false };

  // Weighted GPA detected (4.01–5.0+)
  // Linear map: 3.0w → 2.5uw, 4.0w → 3.5uw, 5.0w → 4.0uw
  // Formula: uw = 0.75 * weighted + 0.25
  const unweighted = Math.min(4.0, Math.max(2.0, rawGPA * 0.75 + 0.25));
  return { gpa: Math.round(unweighted * 100) / 100, wasNormalized: true };
}

/* ─────────────────────────────────────────────────────────── */
/* GPA expected value by selectivity tier                       */
/* ─────────────────────────────────────────────────────────── */

function expectedGPA(acceptRate: number): number {
  if (acceptRate <= 10)  return 3.92;
  if (acceptRate <= 20)  return 3.80;
  if (acceptRate <= 35)  return 3.55;
  if (acceptRate <= 50)  return 3.25;
  if (acceptRate <= 70)  return 3.00;
  return 2.75;
}

/* ─────────────────────────────────────────────────────────── */
/* Admission probability model (v4)                            */
/*                                                             */
/* Design:                                                     */
/*  1. IQR-normalized SAT z-score — each school's own 25/75    */
/*     spread is the scale, so narrow-IQR elite schools and    */
/*     wide-IQR state schools both calibrate naturally          */
/*  2. GPA co-factor — enters logistic as a z-score against    */
/*     expected GPA for that selectivity tier                   */
/*  3. Selectivity anchor — log-scaled pull prevents SAT       */
/*     alone from over-inflating probability                    */
/*  4. Steepness 2.2 calibrated so a 3.9/1550 student sees:   */
/*     Harvard → reach, Georgetown → target, Penn State →      */
/*     safety                                                  */
/*                                                             */
/* v2 bugs fixed:                                              */
/*  - Fixed divisor (300) killed differentiation for elites     */
/*  - GPA had zero effect on bucket assignment                  */
/*  - Score overflow let fitScore saturate at 99               */
/* ─────────────────────────────────────────────────────────── */

function admissionProbability(
  studentSAT: number | null,
  studentGPA: number,
  sat25: number | null,
  sat75: number | null,
  acceptRate: number  // 0–100
): number {
  const baseProb = Math.min(acceptRate / 100, 0.95);
  const gpaExp   = expectedGPA(acceptRate);

  // ── Case 1: No SAT data — GPA-informed fallback ──────────
  // Students who are test-optional still get GPA-adjusted
  // probability rather than raw acceptance rate
  if (!studentSAT || !sat25 || !sat75) {
    if (studentGPA <= 0) return baseProb;
    // Each 0.3 GPA above/below expected shifts base prob ~12%
    const gpaShift = (studentGPA - gpaExp) / 0.3 * 0.12;
    return Math.max(0.03, Math.min(0.95, baseProb + gpaShift));
  }

  // ── Case 2: Full model — SAT + GPA ───────────────────────
  const midpoint = (sat25 + sat75) / 2;
  const scoreDiff = studentSAT - midpoint;
  const iqr = Math.max(sat75 - sat25, 60); // floor at 60 to avoid division spikes

  // Academic z-score: normalised by the school's own IQR
  //   +1.0 ≈ student at school's 75th percentile
  //   -1.0 ≈ student at school's 25th percentile
  const academicZ = scoreDiff / (iqr * 0.75);

  // GPA z-score: each 0.25 GPA above/below expected ≈ 1 unit
  const gpaZ = studentGPA > 0 ? (studentGPA - gpaExp) / 0.25 : 0;

  // Combined signal: SAT primary (55%), GPA secondary (18%)
  // Remaining 27% is selectivity anchor below
  const combined = academicZ * 0.55 + gpaZ * 0.18;

  // Selectivity anchor: log-scaled pull from acceptance rate
  //   Harvard (3%)  → selPull ≈ 1.12
  //   UVA (17%)     → selPull ≈ 0.56
  //   Penn State (54%) → selPull ≈ 0.19
  const selPull = Math.log(100 / acceptRate) * 0.32;

  const raw = combined - selPull;

  // Steepness 2.2 calibrated against named schools:
  //   Harvard/MIT → ~0.09–0.12 (reach for 3.9/1550)
  //   Georgetown/Emory → ~0.41–0.50 (target)
  //   UConn/Penn State → ~0.85–0.96 (safety)
  return 1 / (1 + Math.exp(-raw * 2.2));
}

/* ─────────────────────────────────────────────────────────── */
/* STEM program-level selectivity                              */
/*                                                             */
/* CS at CMU, engineering at Georgia Tech, etc. are far more   */
/* selective than the university-wide acceptance rate.          */
/* detectProgramCompetitiveness classifies the student's       */
/* intended program into a tier, then stemPenalty computes     */
/* a probability reduction applied via a blended approach:     */
/*   60% multiplicative + 40% flat                             */
/* so elite schools don't collapse to zero while mid-tier      */
/* schools still get meaningful shifts.                        */
/* ─────────────────────────────────────────────────────────── */

type StemTier = 'cs' | 'engineering' | 'other_stem' | 'none';

function detectProgramCompetitiveness(
  primaryMajor: string,
  altMajor: string,
  programName: string | null,
  programCip4: string | null,
  programNormalized: string | null
): StemTier {
  const text = `${primaryMajor} ${altMajor} ${programName ?? ''} ${programNormalized ?? ''} ${programCip4 ?? ''}`.toLowerCase();
  const cip = programCip4 ?? '';
  const norm = (programNormalized ?? '').toLowerCase();

  // Engineering FIRST — prevents "computer engineering" matching CS
  if (
    norm === 'civil engineering' || norm === 'electrical engineering' || norm === 'mechanical engineering' ||
    /\bengineering\b|electrical|mechanical|civil|chemical|biomedical|aerospace|industrial|computer engineering/.test(text) ||
    cip.startsWith('14.')
  ) return 'engineering';

  // CS / computing
  if (
    norm === 'computer science' ||
    /computer science|computing|software|informatics|data science|artificial intelligence|cyber|information science/.test(text) ||
    ['11.01','11.02','11.03','11.04','11.05','11.07','11.08','11.09','11.10'].includes(cip)
  ) return 'cs';

  // Other STEM
  if (
    ['biology','chemistry','mathematics','public health'].includes(norm) ||
    /physics|math\b|mathematics|statistics|biology|biological|chemistry|biochemistry|neuroscience/.test(text) ||
    cip.startsWith('26.') || cip.startsWith('27.') || cip.startsWith('40.')
  ) return 'other_stem';

  return 'none';
}

function stemPenalty(kind: StemTier, acceptRate: number, programGrads: number | null): number {
  if (kind === 'none') return 0;

  let p = kind === 'cs' ? 0.08 : kind === 'engineering' ? 0.06 : 0.02;

  // Selectivity amplifier
  if      (acceptRate < 20) p += kind === 'cs' ? 0.03 : 0.02;
  else if (acceptRate < 35) p += kind === 'cs' ? 0.02 : 0.01;

  // Program-size penalty (only at selective schools)
  if (programGrads !== null && acceptRate < 50) {
    if      (kind === 'cs'          && programGrads < 60)  p += 0.02;
    else if (kind === 'cs'          && programGrads < 120) p += 0.01;
    else if (kind === 'engineering' && programGrads < 80)  p += 0.02;
    else if (kind === 'engineering' && programGrads < 150) p += 0.01;
    else if (kind === 'other_stem'  && programGrads < 50)  p += 0.01;
  }

  const cap = kind === 'cs' ? 0.14 : kind === 'engineering' ? 0.12 : 0.05;
  return Math.min(p, cap);
}

function applySTEMPenalty(admitProb: number, penalty: number): number {
  if (penalty <= 0) return admitProb;
  const adjusted = admitProb * (1 - penalty * 0.6) - penalty * 0.4;
  return Math.max(0.02, adjusted);
}

/* ─────────────────────────────────────────────────────────── */
/* Early Decision probability boost                            */
/*                                                             */
/* ED applicants demonstrate commitment, which schools value   */
/* for yield. The boost scales by selectivity:                 */
/*   Sub-10% (Ivies):  ×1.15 — modest, pool self-selects      */
/*   10–25%:           ×1.30 — biggest advantage               */
/*   25–40%:           ×1.20 — moderate                        */
/*   40%+:             no boost — ED irrelevant                */
/* The reach threshold also lowers from 0.18 → 0.15 in ED.    */
/* ─────────────────────────────────────────────────────────── */

function applyEDBoost(admitProb: number, acceptRate: number, isED: boolean): number {
  if (!isED || acceptRate >= 40) return admitProb;
  const edMultiplier = acceptRate < 10 ? 1.15
                     : acceptRate < 25 ? 1.30
                     : 1.20;
  return Math.min(0.95, admitProb * edMultiplier);
}

/* ─────────────────────────────────────────────────────────── */
/* Legacy applicant boost                                      */
/*                                                             */
/* Legacy status meaningfully shifts admission odds, but only  */
/* at (a) private schools where the practice continues and     */
/* (b) selective enough schools where the admit bar is set by  */
/* holistic review (below ~40% accept).                        */
/*                                                             */
/* Several elite publics (UCs, UVA, UNC) and a growing list    */
/* of privates (Amherst, Johns Hopkins, MIT) have explicitly   */
/* ended legacy preference. We apply conservatively to avoid   */
/* misleading students — small bump at <10%, larger at 10–25%, */
/* modest at 25–40%. Zero above 40% or at public schools.      */
/*                                                             */
/* Published studies (Chetty et al., Arcidiacono) put the      */
/* conditional admit multiplier in the 1.5–2.0× range at       */
/* Ivy-peer privates for legacies with similar credentials.    */
/* ─────────────────────────────────────────────────────────── */

function applyLegacyBoost(
  admitProb: number,
  acceptRate: number,
  ownership: string | null,
  isLegacy: boolean
): number {
  if (!isLegacy) return admitProb;
  // Only applies at private schools
  if (!ownership || ownership.toLowerCase() !== 'private nonprofit') return admitProb;
  // Only applies at holistic-review schools
  if (acceptRate >= 40) return admitProb;

  const multiplier = acceptRate < 10 ? 1.35
                   : acceptRate < 25 ? 1.55
                   : 1.30;  // 25–40%
  return Math.min(0.95, admitProb * multiplier);
}

/* ─────────────────────────────────────────────────────────── */
/* AP rigor adjustment                                         */
/*                                                             */
/* AP course-taking (as a ratio of offered) is the strongest   */
/* signal of college-readiness after GPA itself, per AOs at    */
/* Stanford, UPenn, and the Common Data Set for most selective */
/* privates. The ratio matters more than the absolute number   */
/* because a student at a school offering 6 APs who takes 5 is */
/* doing more than a student at a 30-AP school who takes 8.    */
/*                                                             */
/* Effect: small multiplicative bump to admit probability at   */
/* schools <35% accept (where rigor is most scrutinised).      */
/* Capped at +6% absolute so a weak profile isn't rescued by   */
/* APs alone.                                                  */
/* ─────────────────────────────────────────────────────────── */

function applyAPRigorBoost(
  admitProb: number,
  acceptRate: number,
  apTaken: number,
  apOffered: number
): number {
  if (acceptRate >= 35) return admitProb;
  if (apOffered <= 0 || apTaken <= 0) return admitProb;

  const ratio = Math.min(apTaken / apOffered, 1);

  // Sub-scale: ratio 0.25 → 0, 0.50 → 0.02, 0.75 → 0.04, 1.0 → 0.06
  let bump = 0;
  if      (ratio >= 0.80) bump = 0.06;
  else if (ratio >= 0.60) bump = 0.04;
  else if (ratio >= 0.40) bump = 0.02;
  else return admitProb;

  return Math.min(0.95, admitProb * (1 + bump));
}

/* ─────────────────────────────────────────────────────────── */
/* Bucket assignment with holistic review floor                */
/*                                                             */
/* Schools below ~40% acceptance practice holistic review      */
/* and can reject overqualified students unpredictably.        */
/* We enforce this by NEVER allowing sub-40% schools to be     */
/* classified as safety — even if the model gives high prob.   */
/* ─────────────────────────────────────────────────────────── */

function assignBucket(
  admitProb: number,
  acceptRate: number,
  isED: boolean
): 'reach' | 'target' | 'safety' {
  const reachThreshold = isED ? 0.15 : 0.18;

  if (admitProb < reachThreshold) return 'reach';

  // Holistic review floor: sub-40% schools are never safety
  if (acceptRate < 40) return 'target';

  // 40–55%: higher bar for safety
  if (acceptRate < 55 && admitProb >= 0.75) return 'safety';

  // 55%+: standard bar
  if (admitProb >= 0.60) return 'safety';

  return 'target';
}

function rankScoreForBucket(bucket: 'reach' | 'target' | 'safety', fitScore: number, affordabilityPoints: number): number {
  if (bucket === 'target') {
    return fitScore - affordabilityPoints;
  }
  return fitScore;
}

function capByState<T extends { state?: string | null }>(items: T[], maxPerState = 3): T[] {
  const stateCount: Record<string, number> = {};
  return items.filter(item => {
    if (!item.state) return true;
    stateCount[item.state] = (stateCount[item.state] ?? 0) + 1;
    return stateCount[item.state] <= maxPerState;
  });
}

/* ─────────────────────────────────────────────────────────── */
/* Yield-protection / overmatch detection                       */
/* ─────────────────────────────────────────────────────────── */

function isOvermatch(studentSAT: number | null, sat75: number | null): boolean {
  if (!studentSAT || !sat75) return false;
  return studentSAT > sat75 + 150;
}

/* ─────────────────────────────────────────────────────────── */
/* Holistic profile score → small boost                        */
/*                                                             */
/* final_score (0–100) captures ECs, essays, letters, etc.     */
/* We use it as a tiebreaker-level signal (0–1 pt, part of     */
/* Boosts cap) so holistic profile influences ranking without  */
/* overwhelming the data-driven academic signal.               */
/* ─────────────────────────────────────────────────────────── */

function holisticBoost(finalScore: number): { points: number; reason: string | null } {
  if (!finalScore || finalScore <= 0) return { points: 0, reason: null };
  if (finalScore >= 80) return { points: 1, reason: 'Strong holistic profile' };
  return { points: 0, reason: null };
}

/* ─────────────────────────────────────────────────────────── */
/* Route handler                                               */
/* ─────────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPro(session)) return NextResponse.json({ error: 'Pro subscription required', upgrade: true }, { status: 403 });

    const userId = parseInt(session.user.id);
    const url = new URL(req.url);
    const isInstate = url.searchParams.get('instate') === '1';
    const edParam   = url.searchParams.get('ed');  // '1' forces on, '0' forces off, missing → profile default
    const isED      = edParam === '1';
    const edExplicitOff = edParam === '0';
    const isPublic  = url.searchParams.get('public') === '1';

    // Seed once per cold start
    await ensureSeeded();

    const [profile, settings] = await Promise.all([
      getProfile(userId),
      getSettings(userId),
    ]);

    if (!profile || (!profile.gpa && !profile.sat && !profile.act)) {
      return NextResponse.json({
        error: 'incomplete_profile',
        message: 'Please complete your Profile Strength page (GPA, SAT/ACT) before getting recommendations.',
      }, { status: 400 });
    }

    // ── Standardise inputs ──────────────────────────────────
    const rawSAT: number | null = profile.sat ? Number(profile.sat) : null;
    const rawACT: number | null = profile.act ? Number(profile.act) : null;
    const studentSAT: number | null = rawSAT ?? (rawACT ? actToSat(rawACT) : null);

    // GPA normalization: detect weighted (>4.0) and convert to unweighted
    const rawGPA = Number(profile.gpa) || 0;
    const { gpa: studentGPA, wasNormalized: gpaNormalized } = normalizeGPA(rawGPA);

    const studentScore = profile.final_score ?? 0;
    const isAthlete    = profile.is_athlete ?? false;
    const isLegacy     = profile.is_legacy ?? false;
    const apOffered    = Number(profile.ap_offered ?? 0);
    const apTaken      = Number(profile.ap_taken ?? 0);

    // ED default: explicit override (URL param '1' or '0') wins, else fall back
    // to profile.is_ed. Previously only URL param '1' worked — profile flag was ignored.
    const isEDEffective = edExplicitOff
      ? false
      : (isED || (profile.is_ed ?? false));

    const primaryMajor  = settings?.intended_major ?? '';
    const altMajor      = settings?.intended_major_alt ?? '';
    const locationPref  = settings?.preferred_location ?? '';
    const sizePref      = settings?.preferred_size ?? '';
    const needsAid      = settings?.financial_aid_needed ?? false;
    const studentState  = settings?.high_school_state ?? '';

    const programNames = getCIPCodesForStudent(primaryMajor, altMajor);
    const prefStates = getPreferredStates(locationPref);
    const sizeRange  = parseSize(sizePref);

    /* ── Query ─────────────────────────────────────────────── */
    /*                                                          */
    /* Program filter uses program_normalized (not CIP codes).  */
    /* When student is Undecided (programNames=[]), the LEFT    */
    /* JOIN runs without a program filter — every college gets  */
    /* its best-earning program for display, but no program     */
    /* match scoring bonus applies.                             */
    /* ──────────────────────────────────────────────────────── */

    // Build query params with correct positional indexes
    const queryParams: any[] = [];
    let paramIdx = 0;

    // Program filter: skip when Undecided (empty programNames)
    const hasProgFilter = programNames.length > 0;
    let progFilterClause = '';
    if (hasProgFilter) {
      paramIdx++;
      queryParams.push(programNames);
      progFilterClause = `AND pm.program_normalized = ANY($${paramIdx}::text[])`;
    }

    // In-state filter
    let instateFilterClause = '';
    if (isInstate && studentState) {
      paramIdx++;
      queryParams.push(studentState.toUpperCase().trim());
      instateFilterClause = `AND cm.state = $${paramIdx}`;
    }

    const publicFilter = isPublic
      ? `AND cm.ownership = 'Public'`
      : '';

    const { rows: colleges } = await getPool().query(`
      SELECT DISTINCT ON (cm.ope6_id)
        cm.ope6_id, cm.name, cm.city, cm.state, cm.ownership, cm.locale,
        cm.college_url,
        cm.acceptance_rate,
        cm.sat_25, cm.sat_75, cm.sat_avg, cm.sat_range,
        cm.sat_math_25, cm.sat_math_75, cm.sat_cr_25, cm.sat_cr_75,
        cm.act_25, cm.act_75, cm.act_range,
        cm.enrollment, cm.retention_rate, cm.student_faculty_ratio,
        cm.tuition_in_state, cm.tuition_out_state, cm.net_price, cm.cost_attendance,
        cm.grad_rate, cm.median_debt, cm.pell_rate,
        cm.earnings_6yr, cm.earnings_10yr,
        cm.pct_men, cm.pct_women, cm.pct_white, cm.pct_black,
        cm.pct_hispanic, cm.pct_asian, cm.pct_two_or_more,
        pm.cip4                AS program_cip4,
        pm.cipdesc             AS program_name,
        pm.program_normalized  AS program_normalized,
        pm.earn_mdn_4yr        AS program_earn_4yr,
        pm.earn_mdn_5yr        AS program_earn_5yr,
        pm.ipedscount2         AS program_grads
      FROM colleges_master cm
      LEFT JOIN programs_master pm
        ON pm.ope6_id = cm.ope6_id
        ${progFilterClause}
      WHERE cm.acceptance_rate IS NOT NULL
        AND cm.acceptance_rate > 0
        AND cm.grad_rate >= 0.30
        AND cm.enrollment > 300
        ${hasProgFilter ? 'AND pm.program_normalized IS NOT NULL' : ''}
        ${instateFilterClause}
        ${publicFilter}
      ORDER BY cm.ope6_id, pm.earn_mdn_5yr DESC NULLS LAST
    `, queryParams);

    /* ── Score each college ────────────────────────────────── */

    const scored: any[] = [];

    for (const c of colleges) {
      const acceptRate   = parseFloat(c.acceptance_rate) || 50;
      const sat25        = c.sat_25 ? parseInt(c.sat_25) : null;
      const sat75        = c.sat_75 ? parseInt(c.sat_75) : null;
      const act25        = c.act_25 ? parseInt(c.act_25) : null;
      const act75        = c.act_75 ? parseInt(c.act_75) : null;

      // Fall back to ACT-derived SAT range if no SAT data for this school
      const eff25 = sat25 ?? (act25 ? actToSat(act25) : null);
      const eff75 = sat75 ?? (act75 ? actToSat(act75) : null);

      const gradRate     = c.grad_rate        ? parseFloat(c.grad_rate)        : null;
      const retRate      = c.retention_rate   ? parseFloat(c.retention_rate)   : null;
      const enrollment   = c.enrollment       ? parseInt(c.enrollment)         : null;
      const netPrice     = c.net_price        ? parseInt(c.net_price)          : null;
      const pellRate     = c.pell_rate        ? parseFloat(c.pell_rate)        : null;
      const earnings10   = c.earnings_10yr    ? parseInt(c.earnings_10yr)      : null;
      const programEarn  = c.program_earn_5yr ? parseInt(c.program_earn_5yr)   : null;
      const programGrads = c.program_grads    ? parseInt(c.program_grads)      : null;
      const hasProgram   = !!c.program_normalized;
      const bestEarnings = programEarn ?? earnings10 ?? null;

      let points = 0;
      let affordabilityPoints = 0;
      const reasons: { text: string; good: boolean }[] = [];

      /* ── 1. Academic fit (0–25 pts) — logistic probability ── */

      const baseAdmitProb = admissionProbability(studentSAT, studentGPA, eff25, eff75, acceptRate);

      // Apply STEM program-level selectivity penalty
      const stemKind  = detectProgramCompetitiveness(primaryMajor, altMajor, c.program_name ?? null, c.program_cip4 ?? null, c.program_normalized ?? null);
      const stemPen   = stemPenalty(stemKind, acceptRate, programGrads);
      const stemAdjusted = applySTEMPenalty(baseAdmitProb, stemPen);

      // Apply Early Decision probability boost
      const edBoosted = applyEDBoost(stemAdjusted, acceptRate, isEDEffective);

      // Apply legacy boost (private schools <40% accept only)
      const legacyBoosted = applyLegacyBoost(edBoosted, acceptRate, c.ownership ?? null, isLegacy);

      // Apply AP rigor boost (schools <35% accept)
      const admitProb = applyAPRigorBoost(legacyBoosted, acceptRate, apTaken, apOffered);

      if (stemPen > 0) {
        const label = stemKind === 'cs' ? 'CS' : stemKind === 'engineering' ? 'Engineering' : 'STEM';
        reasons.push({ text: `${label} program — more selective`, good: false });
      }

      // Legacy reason — only when it actually applied
      if (isLegacy && acceptRate < 40 && c.ownership && c.ownership.toLowerCase() === 'private nonprofit') {
        reasons.push({ text: 'Legacy applicant — boosts odds at private selective schools', good: true });
      }

      // AP rigor reason — only when it actually applied
      if (acceptRate < 35 && apOffered > 0 && apTaken > 0) {
        const ratio = apTaken / apOffered;
        if (ratio >= 0.80) {
          reasons.push({ text: 'Exceptional AP rigor vs. what your school offers', good: true });
        } else if (ratio >= 0.60) {
          reasons.push({ text: 'Strong AP rigor', good: true });
        }
      }

      if      (admitProb > 0.80) { points += 25; reasons.push({ text: 'Very strong academic match', good: true  }); }
      else if (admitProb > 0.50) { points += 18; reasons.push({ text: 'Solid academic match',       good: true  }); }
      else if (admitProb > 0.25) { points += 12; reasons.push({ text: 'Competitive match',          good: true  }); }
      else if (admitProb > 0.10) { points += 6;  reasons.push({ text: 'Reach academically',         good: false }); }
      else                       { points += 2;  reasons.push({ text: 'Significant reach',           good: false }); }

      /* ── 2. GPA fit (0–10 pts) ─────────────────────────────── */
      // Separate visible scoring dimension — rewards GPA strength
      // even though GPA already modulates the probability model.
      // This lets students see "GPA above expected" as a reason.

      if (studentGPA > 0) {
        const gpaExp  = expectedGPA(acceptRate);
        const gpaDiff = studentGPA - gpaExp;

        if      (gpaDiff >= 0.3)  { points += 10; reasons.push({ text: 'GPA well above expected',    good: true  }); }
        else if (gpaDiff >= 0.1)  { points += 7;  reasons.push({ text: 'GPA above expected',         good: true  }); }
        else if (gpaDiff >= -0.1) { points += 4;  }
        else if (gpaDiff >= -0.3) { points += 2;  reasons.push({ text: 'GPA slightly below typical', good: false }); }
        else                      {                reasons.push({ text: 'GPA below typical admits',   good: false }); }
      }

      /* ── 3. Major strength (0–20 pts) ──────────────────────── */

      if (hasProgram) {
        points += 10;
        reasons.push({ text: `Offers ${primaryMajor || 'your major'}`, good: true });
        if (programGrads && programGrads > 30) { points += 3; reasons.push({ text: 'Strong program size', good: true }); }
        if (programEarn) {
          if      (programEarn >= 70000) { points += 7; reasons.push({ text: 'Top program earnings', good: true }); }
          else if (programEarn >= 55000)   points += 4;
          else if (programEarn >= 40000)   points += 2;
        }
      } else {
        if (primaryMajor && primaryMajor !== 'Undecided') {
          points += 2;
          reasons.push({ text: 'Major not confirmed at this school', good: false });
        } else {
          points += 8; // Undecided — don't penalize, but don't max out
        }
      }

      /* ── 4. Institution outcomes (0–15 pts) ────────────────── */
      // grad_rate and retention_rate may be 0–100 or 0–1 depending
      // on data source. Normalise to 0–1 before comparison.

      if (gradRate !== null) {
        const gr = gradRate > 1 ? gradRate / 100 : gradRate;
        if      (gr >= 0.80) { points += 6; reasons.push({ text: 'High graduation rate', good: true }); }
        else if (gr >= 0.60)   points += 4;
        else                 { points += 1; reasons.push({ text: 'Below-avg graduation rate', good: false }); }
      }

      if (retRate !== null) {
        const rr = retRate > 1 ? retRate / 100 : retRate;
        if      (rr >= 0.90) { points += 4; reasons.push({ text: 'Strong retention', good: true }); }
        else if (rr >= 0.75)   points += 2;
      }

      if (bestEarnings) {
        if      (bestEarnings >= 80000) { points += 5; reasons.push({ text: 'Strong post-grad earnings', good: true }); }
        else if (bestEarnings >= 60000)   points += 3;
        else if (bestEarnings >= 50000)   points += 1;
      }

      /* ── 5. Affordability (0–15 pts) ───────────────────────── */

      if (netPrice) {
        if (netPrice <= 15000) {
          points += 9;
          affordabilityPoints += 9;
          reasons.push({ text: 'Very affordable', good: true });
        } else if (netPrice <= 25000) {
          points += 6;
          affordabilityPoints += 6;
        } else if (netPrice <= 35000) {
          points += 3;
          affordabilityPoints += 3;
        } else {
          reasons.push({ text: 'High net price', good: false });
        }
      }

      if (c.median_debt && parseInt(c.median_debt) < 20000) {
        points += 3;
        affordabilityPoints += 3;
        reasons.push({ text: 'Low median debt', good: true });
      }

      if (needsAid) {
        if (pellRate && pellRate >= 30) {
          points += 3;
          affordabilityPoints += 3;
          reasons.push({ text: 'Good financial aid', good: true });
        } else if (pellRate && pellRate < 10) {
          reasons.push({ text: 'Limited financial aid', good: false });
        }
      }

      /* ── 6. Preferences (0–8 pts) ──────────────────────────── */

      if (prefStates.length > 0 && c.state && prefStates.includes(c.state)) {
        points += 5;
        reasons.push({ text: 'Preferred location', good: true });
      }

      if (sizeRange && enrollment && enrollment >= sizeRange.min && enrollment <= sizeRange.max) {
        points += 3;
        reasons.push({ text: 'Right school size', good: true });
      }

      /* ── 7. Boosts (0–7 pts) ───────────────────────────────── */
      // Budget: in-state (0–4) + ED (0–1) + athlete (0–1) + holistic (0–1) = 7 max

      // In-state tuition boost (0–4 pts)
      if (isInstate && studentState) {
        const isStudentState = c.state && c.state.toUpperCase() === studentState.toUpperCase().trim();
        if (isStudentState) {
          const inT  = c.tuition_in_state  ? parseInt(c.tuition_in_state)  : null;
          const outT = c.tuition_out_state ? parseInt(c.tuition_out_state) : null;
          if (inT && outT && outT > inT) {
            const savings = outT - inT;
            if      (savings >= 15000) { points += 4; reasons.push({ text: 'In-state tuition savings', good: true }); }
            else if (savings >= 5000)  { points += 2; reasons.push({ text: 'In-state discount',        good: true }); }
            else                       { points += 1; reasons.push({ text: 'In-state school',           good: true }); }
          } else {
            points += 1;
            reasons.push({ text: 'In-state school', good: true });
          }
        }
      }

      // ED boost (0–1 pt) — the real ED effect is in applyEDBoost() on probability
      if (isEDEffective) {
        points += 1;
        if (acceptRate < 40) {
          reasons.push({ text: 'ED — probability boosted', good: true });
        } else {
          reasons.push({ text: 'ED applied (no boost at this selectivity)', good: true });
        }
      }

      // Athlete signal (0–1 pt)
      if (isAthlete) {
        points += 1;
        reasons.push({ text: 'Recruited athlete', good: true });
      }

      // Holistic profile boost (0–1 pt) — from final_score
      const hBoost = holisticBoost(studentScore);
      if (hBoost.points > 0) {
        points += hBoost.points;
        if (hBoost.reason) reasons.push({ text: hBoost.reason, good: true });
      }

      /* ── Clamp, bucket, overmatch ───────────────────────────── */

      const fitScore = Math.max(0, Math.min(100, Math.round(points)));

      const bucket = assignBucket(admitProb, acceptRate, isEDEffective);
      const rankScore = rankScoreForBucket(bucket, fitScore, affordabilityPoints);

      const overmatchRisk = isOvermatch(studentSAT, eff75);
      if (overmatchRisk) {
        reasons.push({ text: 'Overmatch — yield protection possible', good: false });
      }

      scored.push({
        ...c,
        college_url:           c.college_url ?? null,
        acceptance_rate:       acceptRate,
        sat_25:                sat25,
        sat_75:                sat75,
        sat_avg:               c.sat_avg ? parseInt(c.sat_avg) : null,
        act_25:                act25,
        act_75:                act75,
        enrollment,
        retention_rate:        retRate,
        grad_rate:             gradRate,
        net_price:             netPrice,
        cost_attendance:       c.cost_attendance   ? parseInt(c.cost_attendance)   : null,
        tuition_in_state:      c.tuition_in_state  ? parseInt(c.tuition_in_state)  : null,
        tuition_out_state:     c.tuition_out_state ? parseInt(c.tuition_out_state) : null,
        earnings_6yr:          c.earnings_6yr      ? parseInt(c.earnings_6yr)      : null,
        earnings_10yr:         earnings10,
        pell_rate:             pellRate,
        median_debt:           c.median_debt       ? parseInt(c.median_debt)       : null,
        student_faculty_ratio: c.student_faculty_ratio ? parseInt(c.student_faculty_ratio) : null,
        program_earn_5yr:      programEarn,
        program_grads:         programGrads,
        fit_score:             fitScore,
        bucket,
        _rank_score:           rankScore,
        fit_reasons:           reasons,
        admission_probability: admitProb,
        overmatch_risk:        overmatchRisk,
        stem_penalty_kind:     stemKind,
      });
    }

    /* ── Pool, rank, diversify, paginate ───────────────────── */
    // Preserve bucket integrity by ranking and capping within each bucket.
    // TARGET ignores affordability in ranking so cost does not crowd out
    // otherwise strong academic/match schools.
    //
    // FIX: Skip state diversity cap when in-state filter is active.
    // When isInstate + studentState, the SQL already constrains to one
    // state, so capByState(items, 3) would kill all but 3 results per
    // bucket — the exact bug that caused "only 3 safety schools."
    const diversify = <T extends { state?: string | null }>(items: T[]): T[] =>
      (isInstate && studentState) ? items : capByState(items);

    const reach  = diversify(
      scored
        .filter(c => c.bucket === 'reach')
        .sort((a, b) =>
          (b.admission_probability - a.admission_probability) ||
          (b.fit_score - a.fit_score) ||
          (b.acceptance_rate - a.acceptance_rate)
        )
    );

    const target = diversify(
      scored
        .filter(c => c.bucket === 'target')
        .sort((a, b) => b._rank_score - a._rank_score || b.fit_score - a.fit_score)
    );

    const safety = diversify(
      scored
        .filter(c => c.bucket === 'safety')
        .sort((a, b) => b.fit_score - a.fit_score)
    );

    const POOL_CAP  = { reach: 25, target: 50, safety: 25 };
    const PAGE_SIZE = { reach: 5,  target: 10, safety: 5  };

    return NextResponse.json({
      pools: {
        reach:  reach .slice(0, POOL_CAP.reach).map(({ _rank_score, ...college }) => college),
        target: target.slice(0, POOL_CAP.target).map(({ _rank_score, ...college }) => college),
        safety: safety.slice(0, POOL_CAP.safety).map(({ _rank_score, ...college }) => college),
      },
      page_sizes: PAGE_SIZE,
      inputs: {
        sat:             rawSAT,
        act:             rawACT,
        gpa_raw:         rawGPA,
        gpa_used:        studentGPA,
        gpa_normalized:  gpaNormalized,
        final_score:     studentScore,
        primary_major:   primaryMajor,
        alt_major:       altMajor,
        location:        locationPref,
        size:            sizePref,
        needs_aid:       needsAid,
        is_athlete:      isAthlete,
        is_legacy:       isLegacy,
        ap_taken:        apTaken,
        ap_offered:      apOffered,
        is_instate:      isInstate,
        is_ed:           isEDEffective,
        is_public:       isPublic,
        student_state:   studentState || null,
      },
      counts: {
        reach:        reach.length,
        target:       target.length,
        safety:       safety.length,
        total_scored: scored.length,
      },
    });

  } catch (error: any) {
    console.error('[Recommend] Error:', error);
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 });
  }
}
