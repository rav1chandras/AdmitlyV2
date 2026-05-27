/**
 * db.ts - PostgreSQL client using node-postgres (pg)
 * Works in any Node.js environment including Docker
 */

import { Pool } from 'pg';

export interface User {
  id: number;
  email: string;
  name: string;
  password: string;
  role: string;
  is_locked: boolean;
  subscription_status: 'free' | 'pro' | 'premium' | 'cancelled';
  subscription_expires_at: Date | null;
  premium_package: string | null;
  stripe_customer_id: string | null;
  created_at: Date;
}

export interface College {
  id: number;
  user_id: number;
  master_id: number | null;    // references masterData college_id
  name: string;
  bucket: 'reach' | 'target' | 'safety';
  accept_rate: number;
  grad_rate: number;
  sat_avg: number;
  sat_range: string;           // e.g. "1500-1580"
  act_range: string;           // e.g. "33-35"
  tuition_in: string;
  tuition_out: string;
  notes?: string;
  created_at: Date;
}

export interface Profile {
  id: number;
  user_id: number;
  gpa: number;
  sat?: number;
  act?: number;
  ap_offered: number;
  ap_taken: number;
  ec_tier: number;
  leadership_roles: number;
  major_multiplier: number;
  is_ed: boolean;
  is_athlete: boolean;
  is_legacy: boolean;
  final_score: number;
  candidate_statement?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Connection pool - lazy initialization
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('POSTGRES_URL environment variable is not set');
    }
    console.log('[DB] Creating connection pool');
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email.trim()]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] getUserByEmail error:', error);
    return null;
  }
}

export async function getUserById(id: number): Promise<User | null> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] getUserById error:', error);
    return null;
  }
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  role: string = 'student'
): Promise<User | null> {
  try {
    console.log('[DB] createUser:', email, 'role:', role);
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO users (email, name, password, role, subscription_status)
       VALUES ($1, $2, $3, $4, 'free') RETURNING *`,
      [email, name, password, role]
    );
    console.log('[DB] createUser success');
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] createUser error:', error);
    return null;
  }
}

export async function getProfile(userId: number): Promise<Profile | null> {
  try {
    console.log('[DB] getProfile for user:', userId);
    const pool = getPool();
    const result = await pool.query('SELECT * FROM profiles WHERE user_id = $1 LIMIT 1', [userId]);
    console.log('[DB] getProfile result:', result.rows.length, 'rows');
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] getProfile error:', error);
    throw error;
  }
}

export async function upsertProfile(
  userId: number,
  data: Partial<Profile>
): Promise<Profile | null> {
  try {
    console.log('[DB] upsertProfile for user:', userId);
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO profiles (
        user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier,
        leadership_roles, major_multiplier, is_ed, is_athlete, is_legacy,
        final_score, candidate_statement, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        gpa = EXCLUDED.gpa,
        sat = EXCLUDED.sat,
        act = EXCLUDED.act,
        ap_offered = EXCLUDED.ap_offered,
        ap_taken = EXCLUDED.ap_taken,
        ec_tier = EXCLUDED.ec_tier,
        leadership_roles = EXCLUDED.leadership_roles,
        major_multiplier = EXCLUDED.major_multiplier,
        is_ed = EXCLUDED.is_ed,
        is_athlete = EXCLUDED.is_athlete,
        is_legacy = EXCLUDED.is_legacy,
        final_score = EXCLUDED.final_score,
        candidate_statement = EXCLUDED.candidate_statement,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        userId,
        data.gpa ?? 0,
        data.sat ?? null,
        data.act ?? null,
        data.ap_offered ?? 0,
        data.ap_taken ?? 0,
        data.ec_tier ?? 6,
        data.leadership_roles ?? 0,
        data.major_multiplier ?? 1.0,
        data.is_ed ?? false,
        data.is_athlete ?? false,
        data.is_legacy ?? false,
        data.final_score ?? 0,
        data.candidate_statement ?? '',
      ]
    );
    console.log('[DB] upsertProfile success');
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] upsertProfile error:', error);
    throw error;
  }
}

export async function getColleges(userId: number): Promise<College[]> {
  try {
    console.log('[DB] getColleges for user:', userId);
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM colleges WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );
    console.log('[DB] getColleges result:', result.rows.length, 'rows');
    return result.rows;
  } catch (error) {
    console.error('[DB] getColleges error:', error);
    throw error;
  }
}

export async function addCollege(
  userId: number,
  data: Omit<College, 'id' | 'user_id' | 'created_at'>
): Promise<College | null> {
  try {
    console.log('[DB] addCollege for user:', userId, 'college:', data.name);
    const pool = getPool();

    // Try to add new columns gracefully — they may not exist in older DB schemas.
    // We use COALESCE-style INSERT to handle missing columns.
    let result;
    try {
      result = await pool.query(
        `INSERT INTO colleges
          (user_id, master_id, name, bucket, accept_rate, grad_rate, sat_avg, sat_range, act_range, tuition_in, tuition_out, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          userId,
          data.master_id ?? null,
          data.name,
          data.bucket,
          data.accept_rate,
          data.grad_rate,
          data.sat_avg,
          data.sat_range ?? 'N/A',
          data.act_range ?? 'N/A',
          data.tuition_in,
          data.tuition_out,
          data.notes ?? '',
        ]
      );
    } catch (colErr: any) {
      // Fallback for older DB schema without master_id / sat_range / act_range columns
      console.warn('[DB] addCollege falling back to legacy schema:', colErr.message);
      result = await pool.query(
        `INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [userId, data.name, data.bucket, data.accept_rate, data.grad_rate, data.sat_avg, data.tuition_in, data.tuition_out, data.notes ?? '']
      );
    }

    console.log('[DB] addCollege success');
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] addCollege error:', error);
    throw error;
  }
}

export async function updateCollege(
  id: number,
  userId: number,
  data: Partial<College>
): Promise<College | null> {
  try {
    console.log('[DB] updateCollege:', id, 'for user:', userId);
    const pool = getPool();
    const result = await pool.query(
      `UPDATE colleges SET
        name = COALESCE($1, name),
        bucket = COALESCE($2, bucket),
        accept_rate = COALESCE($3, accept_rate),
        grad_rate = COALESCE($4, grad_rate),
        sat_avg = COALESCE($5, sat_avg),
        tuition_in = COALESCE($6, tuition_in),
        tuition_out = COALESCE($7, tuition_out),
        notes = COALESCE($8, notes)
      WHERE id = $9 AND user_id = $10
      RETURNING *`,
      [data.name, data.bucket, data.accept_rate, data.grad_rate, data.sat_avg, data.tuition_in, data.tuition_out, data.notes, id, userId]
    );
    console.log('[DB] updateCollege success');
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] updateCollege error:', error);
    throw error;
  }
}

export async function deleteCollege(id: number, userId: number): Promise<boolean> {
  try {
    console.log('[DB] deleteCollege:', id, 'for user:', userId);
    const pool = getPool();
    await pool.query('DELETE FROM colleges WHERE id = $1 AND user_id = $2', [id, userId]);
    console.log('[DB] deleteCollege success');
    return true;
  } catch (error) {
    console.error('[DB] deleteCollege error:', error);
    throw error;
  }
}

// ── colleges_master ─────────────────────────────────────────────────────────
// Schema built by scripts/seed-colleges.mjs from College Scorecard API.
// Refresh quarterly with scripts/refresh-colleges.mjs.

export interface MasterCollegeRow {
  id: number;
  ope6_id: number;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  college_url: string | null;
  ownership: string | null;        // 'Public' | 'Private' | 'For-Profit'
  locale: string | null;           // 'City' | 'Suburb' | 'Town' | 'Rural'
  carnegie_basic: number | null;
  // Admissions
  acceptance_rate: number | null;  // percent, e.g. 4.2
  sat_25: number | null;
  sat_75: number | null;
  sat_math_25: number | null;
  sat_math_75: number | null;
  sat_cr_25: number | null;
  sat_cr_75: number | null;
  sat_avg: number | null;
  sat_range: string | null;        // "1500-1580"
  act_25: number | null;
  act_75: number | null;
  act_mid: number | null;
  act_range: string | null;        // "33-35"
  // Students
  enrollment: number | null;
  retention_rate: number | null;
  student_faculty_ratio: number | null;
  pct_men: number | null;
  pct_women: number | null;
  pct_white: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_asian: number | null;
  pct_two_or_more: number | null;
  // Cost
  tuition_in_state: number | null;
  tuition_out_state: number | null;
  net_price: number | null;        // avg annual cost after aid
  cost_attendance: number | null;
  median_debt: number | null;
  pell_rate: number | null;
  loan_rate: number | null;
  // Outcomes
  grad_rate: number | null;
  earnings_6yr: number | null;
  earnings_8yr: number | null;
  earnings_10yr: number | null;
  // Metadata
  last_refreshed: Date | null;
}

export async function searchMasterCollegesDB(query: string, limit = 10): Promise<MasterCollegeRow[]> {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT * FROM colleges_master
      WHERE name ILIKE $1
      ORDER BY
        CASE WHEN acceptance_rate IS NOT NULL THEN 0 ELSE 1 END,
        acceptance_rate ASC
      LIMIT $2
    `, [`%${query}%`, limit]);
    return result.rows;
  } catch (error) {
    console.error('[DB] searchMasterCollegesDB error:', error);
    return [];
  }
}

export async function getMasterCollegeById(id: number): Promise<MasterCollegeRow | null> {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM colleges_master WHERE ope6_id = $1',
      [id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] getMasterCollegeById error:', error);
    return null;
  }
}

// ── Score History ─────────────────────────────────────────────────────────────

export interface ScoreHistoryPoint {
  week: string;   // ISO week start date e.g. "2026-02-17"
  score: number;  // max score that week
}

export async function logScoreHistory(userId: number, score: number): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      'INSERT INTO score_history (user_id, score) VALUES ($1, $2)',
      [userId, score]
    );
  } catch (error) {
    console.error('[DB] logScoreHistory error:', error);
  }
}

export async function getScoreHistory(userId: number): Promise<ScoreHistoryPoint[]> {
  try {
    const pool = getPool();
    // Aggregate to one point per week (Monday as week start), take max score
    const result = await pool.query(`
      SELECT
        to_char(date_trunc('week', saved_at), 'YYYY-MM-DD') AS week,
        MAX(score) AS score
      FROM score_history
      WHERE user_id = $1
      GROUP BY date_trunc('week', saved_at)
      ORDER BY date_trunc('week', saved_at) ASC
      LIMIT 52
    `, [userId]);
    return result.rows.map(r => ({ week: r.week, score: parseInt(r.score, 10) }));
  } catch (error) {
    console.error('[DB] getScoreHistory error:', error);
    return [];
  }
}

// ── Key Dates ─────────────────────────────────────────────────────────────────

export interface KeyDate {
  id: number;
  category: 'sat' | 'act' | 'ap' | 'fafsa' | 'app_deadline' | 'other';
  title: string;
  description: string | null;
  event_date: string; // ISO date string YYYY-MM-DD
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function getKeyDates(activeOnly = true): Promise<KeyDate[]> {
  try {
    const pool = getPool();
    const where = activeOnly ? 'WHERE is_active = true' : '';
    const result = await pool.query(`
      SELECT * FROM key_dates ${where}
      ORDER BY event_date ASC
    `);
    return result.rows;
  } catch (error) {
    console.error('[DB] getKeyDates error:', error);
    return [];
  }
}

export async function upsertKeyDate(data: Omit<KeyDate, 'id' | 'created_at' | 'updated_at'>): Promise<KeyDate | null> {
  try {
    const pool = getPool();
    const result = await pool.query(`
      INSERT INTO key_dates (category, title, description, event_date, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [data.category, data.title, data.description, data.event_date, data.is_active]);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] upsertKeyDate error:', error);
    return null;
  }
}

export async function updateKeyDate(id: number, data: Partial<Omit<KeyDate, 'id' | 'created_at' | 'updated_at'>>): Promise<KeyDate | null> {
  try {
    const pool = getPool();
    const result = await pool.query(`
      UPDATE key_dates SET
        category    = COALESCE($2, category),
        title       = COALESCE($3, title),
        description = COALESCE($4, description),
        event_date  = COALESCE($5, event_date),
        is_active   = COALESCE($6, is_active),
        updated_at  = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, data.category, data.title, data.description, data.event_date, data.is_active]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB] updateKeyDate error:', error);
    return null;
  }
}

export async function deleteKeyDate(id: number): Promise<boolean> {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM key_dates WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('[DB] deleteKeyDate error:', error);
    return false;
  }
}
