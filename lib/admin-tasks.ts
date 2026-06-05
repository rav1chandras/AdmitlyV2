import type { Pool } from 'pg';

export type AdminTaskPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface FounderInboxTaskInput {
  unique_key: string;
  type: string;
  priority: AdminTaskPriority;
  title: string;
  details?: string;
  action_label?: string;
  action_tab?: string;
  user_id?: number | null;
  counselor_id?: number | null;
  assignment_id?: number | null;
  payment_id?: number | null;
  premium_request_id?: number | null;
  due_at?: string | Date | null;
  metadata?: Record<string, unknown>;
}

const PRIORITY_RANK: Record<AdminTaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function asInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function dollars(cents: unknown): string {
  const amount = Math.max(0, Number(cents || 0)) / 100;
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function sortTasks(tasks: FounderInboxTaskInput[]) {
  return tasks.sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) return dueA - dueB;
    return a.title.localeCompare(b.title);
  });
}

export async function syncFounderInboxTasks(pool: Pool) {
  const tasks: FounderInboxTaskInput[] = [];

  const [
    unassignedPremium,
    pendingCounselors,
    failedPayments,
    premiumRequests,
    unreadCounselorThreads,
    systemErrors,
    payableCounselors,
  ] = await Promise.all([
    pool.query(`
      SELECT u.id, u.name, u.email, u.created_at
        FROM users u
       WHERE u.role = 'student'
         AND COALESCE(u.subscription_status, 'free') = 'premium'
         AND COALESCE(u.is_locked, false) = false
         AND NOT EXISTS (
           SELECT 1 FROM ep_assignments a
            WHERE a.student_id = u.id
              AND a.status IN ('active', 'pending_acceptance')
         )
       ORDER BY u.created_at DESC
       LIMIT 25
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT ec.id AS counselor_id, u.id AS user_id, u.name, u.email,
             ec.display_name, ec.applied_at, ec.status
        FROM ep_counselors ec
        JOIN users u ON u.id = ec.user_id
       WHERE u.role = 'pending_counselor'
          OR COALESCE(ec.status, 'active') = 'pending'
       ORDER BY COALESCE(ec.applied_at, u.created_at) ASC
       LIMIT 25
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT p.id, p.user_id, p.plan_name, p.amount_cents, p.created_at,
             u.name AS user_name, u.email AS user_email
        FROM payments p
        JOIN users u ON u.id = p.user_id
       WHERE p.status = 'failed'
         AND NOT EXISTS (
           SELECT 1 FROM payments p2
            WHERE p2.user_id = p.user_id
              AND p2.status = 'succeeded'
              AND p2.created_at > p.created_at
         )
       ORDER BY p.created_at DESC
       LIMIT 25
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT pr.id, pr.user_id, pr.plan_name, pr.status,
             pr.amount_cents_quoted, pr.amount_cents_invoiced,
             pr.invoice_expires_at, pr.created_at,
             u.name AS user_name, u.email AS user_email
        FROM premium_requests pr
        JOIN users u ON u.id = pr.user_id
       WHERE pr.status IN ('pending_review', 'awaiting_payment')
       ORDER BY
         CASE WHEN pr.status = 'pending_review' THEN 0 ELSE 1 END,
         COALESCE(pr.invoice_expires_at, pr.created_at) ASC
       LIMIT 40
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT u.id AS counselor_user_id, u.name, u.email,
             COUNT(*)::int AS unread_count,
             MAX(am.created_at) AS last_message_at
        FROM admin_messages am
        JOIN users u ON u.id = am.counselor_user_id
       WHERE am.sender_role = 'counselor'
         AND COALESCE(am.is_read, false) = false
       GROUP BY u.id, u.name, u.email
       ORDER BY MAX(am.created_at) DESC
       LIMIT 25
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT COUNT(*)::int AS error_count,
             MAX(created_at) AS latest_error_at
        FROM admin_logs
       WHERE level = 'error'
         AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{ error_count: 0, latest_error_at: null }] })),
    pool.query(`
      SELECT ec.id AS counselor_id, ec.display_name, u.id AS user_id, u.email,
             SUM(ROUND((COALESCE(a.sessions_used, 0) * COALESCE(ep.session_duration_minutes, 60) / 60.0) * COALESCE(ec.hourly_rate_cents, 5000)))::int AS owed_cents,
             COUNT(*)::int AS payable_assignments
        FROM ep_assignments a
        JOIN ep_counselors ec ON ec.id = a.counselor_id
        JOIN users u ON u.id = ec.user_id
        LEFT JOIN ep_plans ep ON ep.name = a.plan
       WHERE a.status != 'cancelled'
         AND COALESCE(a.sessions_used, 0) > 0
         AND (
           a.status = 'completed'
           OR (a.end_date IS NOT NULL AND a.end_date + INTERVAL '7 days' <= NOW())
         )
         AND NOT EXISTS (
           SELECT 1 FROM counselor_payouts cp
            WHERE cp.assignment_id = a.id
              AND cp.status = 'paid'
         )
       GROUP BY ec.id, ec.display_name, u.id, u.email
      HAVING SUM(ROUND((COALESCE(a.sessions_used, 0) * COALESCE(ep.session_duration_minutes, 60) / 60.0) * COALESCE(ec.hourly_rate_cents, 5000))) > 0
       ORDER BY owed_cents DESC
       LIMIT 25
    `).catch(() => ({ rows: [] })),
  ]);

  for (const row of unassignedPremium.rows) {
    const userId = asInt(row.id);
    if (!userId) continue;
    tasks.push({
      unique_key: `premium-unassigned:${userId}`,
      type: 'assignment_gap',
      priority: 'urgent',
      title: `Assign counselor to ${row.name || row.email}`,
      details: `${row.name || 'Student'} is Premium but has no active counselor assignment.`,
      action_label: 'Open assignments',
      action_tab: 'assignments',
      user_id: userId,
      metadata: { email: row.email },
    });
  }

  for (const row of pendingCounselors.rows) {
    const userId = asInt(row.user_id);
    if (!userId) continue;
    tasks.push({
      unique_key: `counselor-approval:${userId}`,
      type: 'counselor_approval',
      priority: 'high',
      title: `Review counselor application`,
      details: `${row.display_name || row.name || row.email} is waiting for approval.`,
      action_label: 'Review counselor',
      action_tab: 'counselors',
      user_id: userId,
      counselor_id: asInt(row.counselor_id),
      due_at: row.applied_at || null,
      metadata: { email: row.email, status: row.status },
    });
  }

  for (const row of failedPayments.rows) {
    const paymentId = asInt(row.id);
    if (!paymentId) continue;
    tasks.push({
      unique_key: `payment-recovery:${paymentId}`,
      type: 'payment_recovery',
      priority: 'high',
      title: `Recover failed payment`,
      details: `${row.user_name || row.user_email} failed ${dollars(row.amount_cents)} for ${row.plan_name || 'a plan'}.`,
      action_label: 'Open recoveries',
      action_tab: 'recoveries',
      user_id: asInt(row.user_id),
      payment_id: paymentId,
      due_at: row.created_at,
      metadata: { email: row.user_email, amount_cents: row.amount_cents, plan_name: row.plan_name },
    });
  }

  const soonMs = 24 * 60 * 60 * 1000;
  for (const row of premiumRequests.rows) {
    const requestId = asInt(row.id);
    if (!requestId) continue;
    const expiresAt = row.invoice_expires_at ? new Date(row.invoice_expires_at) : null;
    const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;
    const expiringSoon = expiresAt ? expiresAt.getTime() - Date.now() < soonMs : false;
    const status = String(row.status || '');
    const priority: AdminTaskPriority = status === 'pending_review' || expired ? 'high' : expiringSoon ? 'medium' : 'low';
    const title = status === 'pending_review'
      ? `Send Premium invoice`
      : expired
        ? `Premium invoice expired`
        : `Premium invoice follow-up`;
    const amount = row.amount_cents_invoiced || row.amount_cents_quoted;
    tasks.push({
      unique_key: `premium-request:${requestId}:${status === 'pending_review' ? 'review' : expired ? 'expired' : 'followup'}`,
      type: 'premium_request',
      priority,
      title,
      details: `${row.user_name || row.user_email} · ${row.plan_name || 'Premium'} · ${dollars(amount)}.`,
      action_label: 'Open requests',
      action_tab: 'premium_requests',
      user_id: asInt(row.user_id),
      premium_request_id: requestId,
      due_at: row.invoice_expires_at || row.created_at,
      metadata: { email: row.user_email, status, amount_cents: amount },
    });
  }

  for (const row of unreadCounselorThreads.rows) {
    const userId = asInt(row.counselor_user_id);
    if (!userId) continue;
    tasks.push({
      unique_key: `counselor-message:${userId}`,
      type: 'unread_message',
      priority: 'medium',
      title: `Reply to counselor message`,
      details: `${row.name || row.email} has ${row.unread_count} unread admin message${row.unread_count === 1 ? '' : 's'}.`,
      action_label: 'Open messages',
      action_tab: 'messages',
      user_id: userId,
      due_at: row.last_message_at,
      metadata: { email: row.email, unread_count: row.unread_count },
    });
  }

  for (const row of payableCounselors.rows) {
    const counselorId = asInt(row.counselor_id);
    if (!counselorId) continue;
    tasks.push({
      unique_key: `payout-due:${counselorId}`,
      type: 'payout_due',
      priority: 'medium',
      title: `Pay counselor balance`,
      details: `${row.display_name || row.email} has ${dollars(row.owed_cents)} payable across ${row.payable_assignments} assignment${row.payable_assignments === 1 ? '' : 's'}.`,
      action_label: 'Open earnings',
      action_tab: 'earnings',
      user_id: asInt(row.user_id),
      counselor_id: counselorId,
      metadata: { email: row.email, owed_cents: row.owed_cents, payable_assignments: row.payable_assignments },
    });
  }

  const errorRow = systemErrors.rows[0];
  const errorCount = Number(errorRow?.error_count || 0);
  if (errorCount > 0) {
    tasks.push({
      unique_key: 'system-errors:24h',
      type: 'system_error',
      priority: errorCount >= 5 ? 'urgent' : 'high',
      title: `Review recent system errors`,
      details: `${errorCount} error${errorCount === 1 ? '' : 's'} logged in the last 24 hours.`,
      action_label: 'Open error log',
      action_tab: 'errors',
      due_at: errorRow.latest_error_at,
      metadata: { error_count: errorCount },
    });
  }

  const activeTasks = sortTasks(tasks);
  const activeKeys = activeTasks.map((task) => task.unique_key);

  for (const task of activeTasks) {
    await pool.query(
      `INSERT INTO admin_tasks
         (unique_key, type, source, status, priority, title, details, action_label, action_tab,
          user_id, counselor_id, assignment_id, payment_id, premium_request_id, due_at, metadata)
       VALUES ($1, $2, 'system', 'open', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (unique_key) DO UPDATE SET
         priority = EXCLUDED.priority,
         title = EXCLUDED.title,
         details = EXCLUDED.details,
         action_label = EXCLUDED.action_label,
         action_tab = EXCLUDED.action_tab,
         user_id = EXCLUDED.user_id,
         counselor_id = EXCLUDED.counselor_id,
         assignment_id = EXCLUDED.assignment_id,
         payment_id = EXCLUDED.payment_id,
         premium_request_id = EXCLUDED.premium_request_id,
         due_at = EXCLUDED.due_at,
         metadata = EXCLUDED.metadata,
         updated_at = NOW(),
         status = CASE
           WHEN admin_tasks.status IN ('resolved', 'dismissed') THEN admin_tasks.status
           ELSE 'open'
         END`,
      [
        task.unique_key,
        task.type,
        task.priority,
        task.title,
        task.details || '',
        task.action_label || null,
        task.action_tab || null,
        task.user_id || null,
        task.counselor_id || null,
        task.assignment_id || null,
        task.payment_id || null,
        task.premium_request_id || null,
        task.due_at || null,
        JSON.stringify(task.metadata || {}),
      ],
    );
  }

  if (activeKeys.length > 0) {
    await pool.query(
      `UPDATE admin_tasks
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, NOW()),
              updated_at = NOW(),
              metadata = metadata || $1::jsonb
        WHERE source = 'system'
          AND status = 'open'
          AND unique_key IS NOT NULL
          AND NOT (unique_key = ANY($2::text[]))`,
      [JSON.stringify({ auto_resolved: true }), activeKeys],
    );
  } else {
    await pool.query(
      `UPDATE admin_tasks
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, NOW()),
              updated_at = NOW(),
              metadata = metadata || $1::jsonb
        WHERE source = 'system'
          AND status = 'open'
          AND unique_key IS NOT NULL`,
      [JSON.stringify({ auto_resolved: true })],
    );
  }

  const { rows: openTasks } = await pool.query(`
    SELECT at.*,
           u.name AS user_name,
           u.email AS user_email,
           ec.display_name AS counselor_name
      FROM admin_tasks at
      LEFT JOIN users u ON u.id = at.user_id
      LEFT JOIN ep_counselors ec ON ec.id = at.counselor_id
     WHERE at.status IN ('open', 'snoozed')
     ORDER BY
       CASE at.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       at.due_at NULLS LAST,
       at.created_at DESC
     LIMIT 80
  `);

  const { rows: summaryRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','snoozed'))::int AS open,
      COUNT(*) FILTER (WHERE status IN ('open','snoozed') AND priority = 'urgent')::int AS urgent,
      COUNT(*) FILTER (WHERE status IN ('open','snoozed') AND priority = 'high')::int AS high,
      COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at > NOW() - INTERVAL '7 days')::int AS resolved_7d
    FROM admin_tasks
  `);

  return {
    tasks: openTasks,
    summary: summaryRows[0] || { open: 0, urgent: 0, high: 0, resolved_7d: 0 },
    generated: activeTasks.length,
  };
}
