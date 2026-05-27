import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const cs = process.env.POSTGRES_URL;
    if (!cs) throw new Error('POSTGRES_URL not set');
    pool = new Pool({ connectionString: cs, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}

// ── Types (mirrored in the frontend) ─────────────────────────────────────────

export interface Activity {
  id: string;           // client-generated uuid
  name: string;         // "Robotics Team"
  role: string;         // "Captain / Lead Engineer"
  years: string;        // "9th–12th"
  hours_per_week: number;
  impact: string;       // what changed because you were there
  story_moment: string; // one specific scene — the anti-hallucination anchor
  essay_worthy: boolean;
}

export interface Honor {
  id: string;
  name: string;
  level: 'school' | 'regional' | 'state' | 'national' | 'international';
  year: string;
  context: string;      // why it mattered / what you had to do
}

export interface Experience {
  id: string;
  title: string;        // "Grandmother's immigration story"
  timeframe: string;    // "Summer before 10th grade"
  what_happened: string; // facts only — no interpretation
  what_changed: string;  // reflection / meaning
  essay_worthy: boolean;
}

export interface IdentityBlock {
  family_background: string;
  challenge_overcome: string;
  three_words: string;          // comma-separated
  grades_dont_show: string;     // hidden strengths / context
  proud_of_outside_school: string;
}

export interface GoalsBlock {
  career_direction: string;
  intended_college_major: string;
  why_college_now: string;
  ten_year_vision: string;
}

export interface StudentJourney {
  activities:  Activity[];
  honors:      Honor[];
  experiences: Experience[];
  identity:    IdentityBlock;
  goals:       GoalsBlock;
}

export const JOURNEY_DEFAULTS: StudentJourney = {
  activities:  [],
  honors:      [],
  experiences: [],
  identity: {
    family_background:         '',
    challenge_overcome:        '',
    three_words:               '',
    grades_dont_show:          '',
    proud_of_outside_school:   '',
  },
  goals: {
    career_direction:      '',
    intended_college_major: '',
    why_college_now:       '',
    ten_year_vision:       '',
  },
};

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getJourney(userId: number): Promise<StudentJourney | null> {
  const db = getPool();
  const res = await db.query('SELECT * FROM student_journey WHERE user_id = $1', [userId]);
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    activities:  r.activities  ?? [],
    honors:      r.honors      ?? [],
    experiences: r.experiences ?? [],
    identity:    r.identity    ?? JOURNEY_DEFAULTS.identity,
    goals:       r.goals       ?? JOURNEY_DEFAULTS.goals,
  };
}

export async function upsertJourney(userId: number, data: StudentJourney): Promise<StudentJourney> {
  const db = getPool();
  const res = await db.query(
    `INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       activities  = EXCLUDED.activities,
       honors      = EXCLUDED.honors,
       experiences = EXCLUDED.experiences,
       identity    = EXCLUDED.identity,
       goals       = EXCLUDED.goals,
       updated_at  = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      userId,
      JSON.stringify(data.activities),
      JSON.stringify(data.honors),
      JSON.stringify(data.experiences),
      JSON.stringify(data.identity),
      JSON.stringify(data.goals),
    ]
  );
  const r = res.rows[0];
  return { activities: r.activities, honors: r.honors, experiences: r.experiences, identity: r.identity, goals: r.goals };
}

// ── Build the facts block injected into AI prompts ────────────────────────────
export function buildFactsBlock(journey: StudentJourney, settings?: { intended_major?: string; graduation_year?: number | null }): string {
  const lines: string[] = ['STUDENT FACTS — use ONLY what is listed below. Do not invent any experience, award, or detail not present here.\n'];

  // Activities
  const essayActivities = journey.activities.filter(a => a.essay_worthy);
  const otherActivities = journey.activities.filter(a => !a.essay_worthy);

  if (journey.activities.length > 0) {
    lines.push('EXTRACURRICULAR ACTIVITIES:');
    [...essayActivities, ...otherActivities].forEach(a => {
      lines.push(`- ${a.name}${a.role ? ` — ${a.role}` : ''} (${a.years ?? ''}, ~${a.hours_per_week}h/week)${a.essay_worthy ? ' [ESSAY-WORTHY]' : ''}`);
      if (a.impact)       lines.push(`  Impact: ${a.impact}`);
      if (a.story_moment) lines.push(`  Specific moment: ${a.story_moment}`);
    });
    lines.push('');
  }

  // Honors
  if (journey.honors.length > 0) {
    lines.push('HONORS & AWARDS:');
    journey.honors.forEach(h => {
      lines.push(`- ${h.name} (${h.level}, ${h.year})`);
      if (h.context) lines.push(`  Context: ${h.context}`);
    });
    lines.push('');
  }

  // Experiences
  const essayExp = journey.experiences.filter(e => e.essay_worthy);
  const otherExp = journey.experiences.filter(e => !e.essay_worthy);
  if (journey.experiences.length > 0) {
    lines.push('MEANINGFUL EXPERIENCES:');
    [...essayExp, ...otherExp].forEach(e => {
      lines.push(`- ${e.title}${e.timeframe ? ` (${e.timeframe})` : ''}${e.essay_worthy ? ' [ESSAY-WORTHY]' : ''}`);
      if (e.what_happened) lines.push(`  What happened: ${e.what_happened}`);
      if (e.what_changed)  lines.push(`  What it meant: ${e.what_changed}`);
    });
    lines.push('');
  }

  // Identity
  const id = journey.identity;
  const hasIdentity = Object.values(id).some(v => v?.trim());
  if (hasIdentity) {
    lines.push('IDENTITY & BACKGROUND:');
    if (id.family_background)       lines.push(`- Family context: ${id.family_background}`);
    if (id.challenge_overcome)      lines.push(`- Challenge overcome: ${id.challenge_overcome}`);
    if (id.three_words)             lines.push(`- Others describe me as: ${id.three_words}`);
    if (id.grades_dont_show)        lines.push(`- What grades don't show: ${id.grades_dont_show}`);
    if (id.proud_of_outside_school) lines.push(`- Proud of outside school: ${id.proud_of_outside_school}`);
    lines.push('');
  }

  // Goals
  const g = journey.goals;
  const hasGoals = Object.values(g).some(v => v?.trim());
  if (hasGoals) {
    lines.push('GOALS & DIRECTION:');
    if (g.career_direction || settings?.intended_major)
      lines.push(`- Intended major/field: ${g.intended_college_major || settings?.intended_major || ''}`);
    if (g.career_direction)   lines.push(`- Career direction: ${g.career_direction}`);
    if (g.why_college_now)    lines.push(`- Why college now: ${g.why_college_now}`);
    if (g.ten_year_vision)    lines.push(`- 10-year vision: ${g.ten_year_vision}`);
    lines.push('');
  }

  if (lines.length === 1) {
    return ''; // No journey data yet — caller should skip the facts block
  }

  return lines.join('\n');
}
