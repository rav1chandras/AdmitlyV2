import { Pool } from 'pg';
import { ensureSchema } from '@/lib/db_schema';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const cs = process.env.POSTGRES_URL;
    if (!cs) {
      console.error('[db_admin] POSTGRES_URL not set — database queries will fail');
      throw new Error('POSTGRES_URL not set');
    }
    pool = new Pool({ connectionString: cs, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}



// ── Types ─────────────────────────────────────────────────────────────────────
export interface AdminStudent {
  id: number;
  name: string;
  email: string;
  created_at: string;
  last_login: string | null;
  auth_provider: string;
  // Profile
  gpa: number | null;
  sat: number | null;
  act: number | null;
  final_score: number | null;
  profile_updated_at: string | null;
  // Settings
  high_school_name: string | null;
  graduation_year: number | null;
  intended_major: string | null;
  phone: string | null;
  // Counts
  college_count: number;
  reach_count: number;
  target_count: number;
  safety_count: number;
  essay_count: number;
  submitted_essay_count: number;
  essay_word_count_total: number;
  // LLM
  llm_calls: number;
  llm_tokens_total: number;
  llm_cost_usd: number;
}

export interface AdminStats {
  total_users: number;
  active_last_7d: number;
  active_last_30d: number;
  total_colleges_saved: number;
  total_essays: number;
  submitted_essays: number;
  total_llm_calls: number;
  total_llm_tokens: number;
  total_llm_cost_usd: number;
  avg_profile_score: number;
  avg_colleges_per_user: number;
  avg_essays_per_user: number;
}

export interface LlmUsageRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  mode: string;
  essay_type: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface DailyActivity {
  date: string;
  logins: number;
  essays_created: number;
  colleges_added: number;
  llm_calls: number;
  llm_tokens: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<AdminStats> {
  const db = getPool();

  await ensureSchema();

  const res = await db.query(`
    SELECT
      (SELECT COUNT(*)                           FROM users)                        AS total_users,
      (SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL '7 days')    AS active_last_7d,
      (SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL '30 days')   AS active_last_30d,
      (SELECT COUNT(*)                           FROM colleges)                     AS total_colleges_saved,
      (SELECT COUNT(*)                           FROM essay_drafts)                 AS total_essays,
      (SELECT COUNT(*) FROM essay_drafts WHERE status = 'submitted')               AS submitted_essays,
      (SELECT COALESCE(COUNT(*), 0)              FROM llm_usage)                   AS total_llm_calls,
      (SELECT COALESCE(SUM(total_tokens), 0)     FROM llm_usage)                   AS total_llm_tokens,
      (SELECT COALESCE(SUM(cost_microcents), 0)  FROM llm_usage)                   AS total_llm_cost_microcents,
      (SELECT COALESCE(AVG(final_score), 0)      FROM profiles WHERE final_score > 0) AS avg_profile_score,
      (SELECT COALESCE(AVG(cnt), 0) FROM (
         SELECT COUNT(*) AS cnt FROM colleges GROUP BY user_id
       ) t)                                                                         AS avg_colleges_per_user,
      (SELECT COALESCE(AVG(cnt), 0) FROM (
         SELECT COUNT(*) AS cnt FROM essay_drafts GROUP BY user_id
       ) t)                                                                         AS avg_essays_per_user
  `);
  const r = res.rows[0];
  return {
    total_users:          parseInt(r.total_users),
    active_last_7d:       parseInt(r.active_last_7d),
    active_last_30d:      parseInt(r.active_last_30d),
    total_colleges_saved: parseInt(r.total_colleges_saved),
    total_essays:         parseInt(r.total_essays),
    submitted_essays:     parseInt(r.submitted_essays),
    total_llm_calls:      parseInt(r.total_llm_calls),
    total_llm_tokens:     parseInt(r.total_llm_tokens),
    total_llm_cost_usd:   parseInt(r.total_llm_cost_microcents) / 1_000_000,
    avg_profile_score:    parseFloat(r.avg_profile_score),
    avg_colleges_per_user: parseFloat(r.avg_colleges_per_user),
    avg_essays_per_user:   parseFloat(r.avg_essays_per_user),
  };
}

export async function getAdminStudents(): Promise<AdminStudent[]> {
  const db = getPool();
  await ensureSchema();

  const mapRow = (r: any) => ({
    ...r,
    is_locked:             r.is_locked === true || r.is_locked === 't',
    auth_provider:         r.auth_provider || 'credentials',
    has_expert_session:    r.has_expert_session === true || r.has_expert_session === 't',
    has_active_expert_session: r.has_active_expert_session === true || r.has_active_expert_session === 't',
    needs_assignment: r.needs_assignment === true || r.needs_assignment === 't',
    expert_plan:           r.expert_plan || '',
    subscription_status:   r.subscription_status || 'free',
    subscription_expires_at: r.subscription_expires_at || null,
    college_count:         parseInt(r.college_count) || 0,
    reach_count:           parseInt(r.reach_count) || 0,
    target_count:          parseInt(r.target_count) || 0,
    safety_count:          parseInt(r.safety_count) || 0,
    essay_count:           parseInt(r.essay_count) || 0,
    submitted_essay_count: parseInt(r.submitted_essay_count) || 0,
    essay_word_count_total: parseInt(r.essay_word_count_total) || 0,
    llm_calls:             parseInt(r.llm_calls) || 0,
    llm_tokens_total:      parseInt(r.llm_tokens_total) || 0,
    llm_cost_usd:          parseFloat(r.llm_cost_usd) || 0,
    gpa:                   r.gpa ? parseFloat(r.gpa) : null,
    final_score:           r.final_score ? parseInt(r.final_score) : null,
  });

  try {
    const res = await db.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      COALESCE(u.is_locked, false)                   AS is_locked,
      u.created_at,
      u.last_login,
      COALESCE(u.subscription_status, 'free')        AS subscription_status,
      u.subscription_expires_at,
      COALESCE(u.auth_provider, 'credentials')       AS auth_provider,
      -- Profile
      p.gpa,
      p.sat,
      p.act,
      p.final_score,
      p.updated_at                                   AS profile_updated_at,
      -- Settings
      ss.high_school_name,
      ss.high_school_state,
      ss.graduation_year,
      ss.intended_major,
      COALESCE(u.phone, ss.phone)                    AS phone,
      -- College counts
      COALESCE(col_agg.total,  0)                    AS college_count,
      COALESCE(col_agg.reach,  0)                    AS reach_count,
      COALESCE(col_agg.target, 0)                    AS target_count,
      COALESCE(col_agg.safety, 0)                    AS safety_count,
      -- Essay counts
      COALESCE(ess_agg.total,     0)                 AS essay_count,
      COALESCE(ess_agg.submitted, 0)                 AS submitted_essay_count,
      COALESCE(ess_agg.wc_total,  0)                 AS essay_word_count_total,
      -- LLM usage
      COALESCE(llm_agg.calls,   0)                   AS llm_calls,
      COALESCE(llm_agg.tokens,  0)                   AS llm_tokens_total,
      COALESCE(llm_agg.cost_mc, 0) / 1000000.0      AS llm_cost_usd,
      -- Expert session
      COALESCE(ep_agg.has_session, false)            AS has_expert_session,
      COALESCE(ep_agg.has_active_session, false)     AS has_active_expert_session,
      COALESCE(ep_agg.plan_name, '')                 AS expert_plan,
      -- Needs assignment: has premium payment with no valid assignment created after it
      CASE WHEN pmt_agg.latest_premium_payment_at IS NOT NULL
                AND (
                  ep_agg.latest_valid_assignment_at IS NULL
                  OR ep_agg.latest_valid_assignment_at < pmt_agg.latest_premium_payment_at
                )
           THEN true ELSE false
      END                                            AS needs_assignment
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN student_settings ss ON ss.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE bucket = 'reach')         AS reach,
        COUNT(*) FILTER (WHERE bucket = 'target')        AS target,
        COUNT(*) FILTER (WHERE bucket = 'safety')        AS safety
      FROM colleges WHERE user_id = u.id
    ) col_agg ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE status = 'submitted')     AS submitted,
        COALESCE(SUM(word_count), 0)                     AS wc_total
      FROM essay_drafts WHERE user_id = u.id
    ) ess_agg ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                          AS calls,
        COALESCE(SUM(total_tokens), 0)                   AS tokens,
        COALESCE(SUM(cost_microcents), 0)                AS cost_mc
      FROM llm_usage WHERE user_id = u.id
    ) llm_agg ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) > 0                                      AS has_session,
        COUNT(*) FILTER (WHERE status = 'active') > 0    AS has_active_session,
        (ARRAY_AGG(plan ORDER BY created_at DESC))[1]    AS plan_name,
        MAX(created_at)                                   AS latest_assignment_at,
        MAX(created_at) FILTER (WHERE status IN ('active','completed','pending_acceptance','paused')) AS latest_valid_assignment_at
      FROM ep_assignments WHERE student_id = u.id AND status != 'cancelled'
    ) ep_agg ON true
    LEFT JOIN LATERAL (
      SELECT MAX(created_at) AS latest_premium_payment_at
      FROM payments
      WHERE user_id = u.id AND status = 'succeeded'
        AND (plan_id LIKE 'premium%' OR LOWER(plan_name) IN ('full cycle','essay only','starter'))
    ) pmt_agg ON true
    WHERE u.role = 'student'
    ORDER BY u.created_at DESC
  `);
  return res.rows.map(mapRow);
  } catch(err) {
    console.error('[getAdminStudents] Full query failed, trying fallback:', (err as any)?.message);
    // Fallback: simpler query without potentially missing columns
    try {
      const res2 = await db.query(`
        SELECT u.id, u.name, u.email,
          COALESCE(u.role, 'student') AS role,
          false AS is_locked,
          u.created_at, u.last_login,
          COALESCE(u.subscription_status, 'free') AS subscription_status,
          u.subscription_expires_at,
          COALESCE(u.auth_provider, 'credentials') AS auth_provider,
          COALESCE(u.phone, ss.phone) AS phone,
          p.gpa, p.sat, p.act, p.final_score,
          p.updated_at AS profile_updated_at,
          ss.high_school_name, ss.graduation_year, ss.intended_major,
          0 AS college_count, 0 AS reach_count, 0 AS target_count, 0 AS safety_count,
          0 AS essay_count, 0 AS submitted_essay_count, 0 AS essay_word_count_total,
          0 AS llm_calls, 0 AS llm_tokens_total, 0 AS llm_cost_usd,
          false AS has_expert_session, false AS has_active_expert_session, false AS needs_assignment, '' AS expert_plan
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        LEFT JOIN student_settings ss ON ss.user_id = u.id
        WHERE u.role = 'student'
        ORDER BY u.created_at DESC
      `);
      return res2.rows.map(mapRow);
    } catch(e2) {
      console.error('[getAdminStudents] Fallback also failed:', (e2 as any)?.message);
      return [];
    }
  }
}

export async function getLlmUsage(limit = 100): Promise<LlmUsageRow[]> {
  const db = getPool();
  const res = await db.query(`
    SELECT
      l.*,
      u.name  AS user_name,
      u.email AS user_email,
      l.cost_microcents / 1000000.0 AS cost_usd
    FROM llm_usage l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

export async function getDailyActivity(days = 14): Promise<DailyActivity[]> {
  const db = getPool();

  await ensureSchema();

  const res = await db.query(`
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - INTERVAL '1 day' * $1)::date,
        CURRENT_DATE,
        '1 day'::interval
      )::date AS date
    )
    SELECT
      ds.date::text,
      COALESCE(login_agg.cnt,   0) AS logins,
      COALESCE(essay_agg.cnt,   0) AS essays_created,
      COALESCE(col_agg.cnt,     0) AS colleges_added,
      COALESCE(llm_agg.calls,   0) AS llm_calls,
      COALESCE(llm_agg.tokens,  0) AS llm_tokens
    FROM date_series ds
    LEFT JOIN (
      SELECT DATE(last_login) AS d, COUNT(*) AS cnt
      FROM users WHERE last_login IS NOT NULL
      GROUP BY DATE(last_login)
    ) login_agg ON login_agg.d = ds.date
    LEFT JOIN (
      SELECT DATE(created_at) AS d, COUNT(*) AS cnt
      FROM essay_drafts GROUP BY DATE(created_at)
    ) essay_agg ON essay_agg.d = ds.date
    LEFT JOIN (
      SELECT DATE(created_at) AS d, COUNT(*) AS cnt
      FROM colleges GROUP BY DATE(created_at)
    ) col_agg ON col_agg.d = ds.date
    LEFT JOIN (
      SELECT DATE(created_at) AS d, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens
      FROM llm_usage GROUP BY DATE(created_at)
    ) llm_agg ON llm_agg.d = ds.date
    ORDER BY ds.date ASC
  `, [days]);
  return res.rows.map(r => ({
    date:           r.date,
    logins:         parseInt(r.logins),
    essays_created: parseInt(r.essays_created),
    colleges_added: parseInt(r.colleges_added),
    llm_calls:      parseInt(r.llm_calls),
    llm_tokens:     parseInt(r.llm_tokens),
  }));
}

// ── Update last_login on sign-in ──────────────────────────────────────────────
export async function touchLastLogin(userId: number): Promise<void> {
  const db = getPool();
  await ensureSchema();
  await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
}

// ── Log a single LLM call ─────────────────────────────────────────────────────
// GPT-4o pricing (Feb 2025): $5/1M input tokens, $15/1M output tokens
export async function logLlmUsage(params: {
  userId: number;
  essayId?: number | null;
  mode: string;
  essayType?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  const db = getPool();
  const total = params.promptTokens + params.completionTokens;
  // Cost in microcents (1 USD = 1,000,000 microcents)
  const costMicrocents = Math.round(
    (params.promptTokens / 1_000_000) * 5 * 1_000_000 +
    (params.completionTokens / 1_000_000) * 15 * 1_000_000
  );
  await db.query(
    `INSERT INTO llm_usage
       (user_id, essay_id, mode, essay_type, model, prompt_tokens, completion_tokens, total_tokens, cost_microcents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.userId, params.essayId ?? null, params.mode,
      params.essayType ?? null, params.model,
      params.promptTokens, params.completionTokens, total, costMicrocents,
    ]
  );
}
