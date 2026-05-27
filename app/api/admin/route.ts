import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAdminStats, getAdminStudents, getLlmUsage, getDailyActivity } from '@/lib/db_admin';
import { getPool } from '@/lib/db';
import { ensureSchema, seedMockData } from '@/lib/db_schema';
import { sendEmail } from '@/lib/email';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

const PLAN_SESSIONS: Record<string, number> = { 'Starter': 1, 'Essay Only': 2, 'Full Cycle': 5 };

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') ?? 'overview';

  try {
    await ensureSchema();
    await seedMockData();

    if (view === 'overview') {
      const [stats, activity] = await Promise.all([
        getAdminStats(),
        getDailyActivity(14),
      ]);
      return NextResponse.json({ stats, activity });
    }

    if (view === 'students') {
      const students = await getAdminStudents();
      return NextResponse.json({ students });
    }

    if (view === 'admins') {
      // List all users who are admins, via either their DB role or the
      // ADMIN_EMAILS env var. Env-based admins are tagged with source='env'
      // so the UI can disable the lock toggle for them (locking them would
      // be a trivial self-foot-gun — they'd reappear as admin on next
      // session refresh because ADMIN_EMAILS is checked at runtime).
      const pool = getPool();
      const envAdmins = (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

      // Build a single query that returns any user who is either role=admin
      // OR has an email in the env list.
      let rows: any[] = [];
      if (envAdmins.length > 0) {
        const r = await pool.query(
          `SELECT id, name, email, role, is_locked, created_at, last_login
           FROM users
           WHERE role = 'admin' OR LOWER(email) = ANY($1::text[])
           ORDER BY created_at ASC`,
          [envAdmins]
        );
        rows = r.rows;
      } else {
        const r = await pool.query(
          `SELECT id, name, email, role, is_locked, created_at, last_login
           FROM users
           WHERE role = 'admin'
           ORDER BY created_at ASC`
        );
        rows = r.rows;
      }

      const admins = rows.map(r => {
        const emailLc = (r.email || '').toLowerCase();
        const inEnv = envAdmins.includes(emailLc);
        const isDbAdmin = r.role === 'admin';
        // source = 'both' | 'db' | 'env'
        const source = inEnv && isDbAdmin ? 'both' : (inEnv ? 'env' : 'db');
        return {
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          is_locked: !!r.is_locked,
          created_at: r.created_at,
          last_login: r.last_login,
          source,
        };
      });

      return NextResponse.json({ admins });
    }

    if (view === 'llm') {
      const usage = await getLlmUsage(200);
      return NextResponse.json({ usage });
    }

    if (view === 'assignments') {
      const pool = getPool();
      // role column may not exist on older DBs — use COALESCE with fallback
      let usersRes;
      try {
        usersRes = await pool.query(`SELECT id, name, email, role FROM users ORDER BY name`);
      } catch {
        // role column missing — add it and retry
        try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student'`); } catch {}
        usersRes = await pool.query(`SELECT id, name, email, COALESCE(role, 'student') as role FROM users ORDER BY name`);
      }
      const assignRes = await pool.query(`
        SELECT a.id, a.counselor_id, a.student_id, a.plan, a.sessions_total, a.sessions_used, a.status, a.target_schools, a.start_date, a.end_date, a.created_at,
               a.declined_reason, a.accepted_at,
               u_s.name AS student_name, u_s.email AS student_email,
               ec.display_name AS counselor_name, u_c.email AS counselor_email,
               COALESCE(ep.session_duration_minutes, 60) AS session_duration_minutes
        FROM ep_assignments a
        JOIN users u_s ON u_s.id = a.student_id
        JOIN ep_counselors ec ON ec.id = a.counselor_id
        JOIN users u_c ON u_c.id = ec.user_id
        LEFT JOIN ep_plans ep ON ep.name = a.plan
        ORDER BY a.created_at DESC
      `);
      const counselorsRes = await pool.query(`
        SELECT ec.id, ec.user_id, ec.display_name, ec.title, ec.specialties, ec.total_students, ec.years_experience,
               ec.application_note, ec.applied_at, ec.reviewed_at, ec.bio, ec.phone,
               COALESCE(ec.status, 'active') AS counselor_status,
               COALESCE(ec.hourly_rate_cents, 5000) AS hourly_rate_cents,
               COALESCE(ec.total_earned_cents, 0) AS total_earned_cents,
               ec.stripe_connect_account_id,
               u.email, u.name, u.role, u.created_at AS joined_at,
               COALESCE(u.auth_provider, 'credentials') AS auth_provider,
               u.phone AS user_phone,
               COALESCE(a_counts.active_count, 0)::int AS active_assignment_count,
               COALESCE(a_counts.completed_count, 0)::int AS completed_assignment_count
        FROM ep_counselors ec
        JOIN users u ON u.id = ec.user_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE status = 'active') AS active_count,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
          FROM ep_assignments WHERE counselor_id = ec.id
        ) a_counts ON true
        ORDER BY ec.display_name
      `);
      // Pending counselors (role = 'pending_counselor')
      const pendingRes = await pool.query(`
        SELECT ec.id, ec.user_id, ec.display_name, ec.title, ec.specialties, ec.years_experience,
               ec.application_note, ec.applied_at,
               u.email, u.name, u.created_at,
               COALESCE(u.auth_provider, 'credentials') AS auth_provider,
               u.phone AS user_phone
        FROM ep_counselors ec JOIN users u ON u.id = ec.user_id
        WHERE u.role = 'pending_counselor'
        ORDER BY ec.applied_at DESC
      `);
      const plansRes = await pool.query(`SELECT * FROM ep_plans ORDER BY sort_order, id`);
      return NextResponse.json({
        users: usersRes.rows,
        assignments: assignRes.rows,
        counselors: counselorsRes.rows,
        pending_counselors: pendingRes.rows,
        plans: plansRes.rows,
      });
    }

    // ── Message threads (aggregated from ep_messages) ──
    if (view === 'messages') {
      try {
        const pool = getPool();
        const threadsRes = await pool.query(`
          SELECT a.id AS assignment_id,
                 u_s.name AS student_name, u_s.email AS student_email,
                 ec.display_name AS counselor_name,
                 (SELECT body FROM ep_messages WHERE assignment_id = a.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                 (SELECT created_at FROM ep_messages WHERE assignment_id = a.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                 (SELECT COUNT(*) FROM ep_messages WHERE assignment_id = a.id AND is_read = false)::int AS unread_count
          FROM ep_assignments a
          JOIN users u_s ON u_s.id = a.student_id
          JOIN ep_counselors ec ON ec.id = a.counselor_id
          ORDER BY last_message_at DESC NULLS LAST
        `);
        return NextResponse.json({ threads: threadsRes.rows });
      } catch { return NextResponse.json({ threads: [] }); }
    }

    // ── Thread messages for a specific assignment ──
    if (view === 'thread_messages') {
      const assignmentId = searchParams.get('assignment_id');
      if (!assignmentId) return NextResponse.json({ error: 'Missing assignment_id' }, { status: 400 });
      const pool = getPool();
      const messagesRes = await pool.query(
        `SELECT id, assignment_id, sender_role, body, is_read, created_at FROM ep_messages WHERE assignment_id = $1 ORDER BY created_at ASC`,
        [assignmentId]
      );
      // Mark as read
      await pool.query(`UPDATE ep_messages SET is_read = true WHERE assignment_id = $1`, [assignmentId]);
      return NextResponse.json({ messages: messagesRes.rows });
    }

    // ── Admin ↔ Counselor direct message threads ──
    if (view === 'admin_threads') {
      try {
        const pool = getPool();
        const res = await pool.query(`
          SELECT u.id AS counselor_user_id, u.name, u.email, ec.display_name, ec.title,
                 ec.specialties, ec.status AS counselor_status,
                 (SELECT COUNT(*) FROM ep_assignments WHERE counselor_id = ec.id AND status = 'active')::int AS active_students,
                 (SELECT body FROM admin_messages WHERE counselor_user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                 (SELECT sender_role FROM admin_messages WHERE counselor_user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_sender,
                 (SELECT created_at FROM admin_messages WHERE counselor_user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                 (SELECT COUNT(*) FROM admin_messages WHERE counselor_user_id = u.id AND sender_role = 'counselor' AND is_read = false)::int AS unread_count,
                 (SELECT COUNT(*) FROM admin_messages WHERE counselor_user_id = u.id)::int AS total_messages
          FROM users u
          JOIN ep_counselors ec ON ec.user_id = u.id
          WHERE u.role IN ('counselor', 'pending_counselor')
          ORDER BY last_message_at DESC NULLS LAST, u.name ASC
        `);
        return NextResponse.json({ threads: res.rows });
      } catch { return NextResponse.json({ threads: [] }); }
    }

    // ── Admin ↔ Counselor thread messages ──
    if (view === 'admin_thread_messages') {
      const counselorUserId = searchParams.get('counselor_user_id');
      if (!counselorUserId) return NextResponse.json({ error: 'Missing counselor_user_id' }, { status: 400 });
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT id, sender_role, body, is_read, created_at FROM admin_messages WHERE counselor_user_id = $1 ORDER BY created_at ASC`,
          [counselorUserId]
        );
        // Mark counselor messages as read
        await pool.query(
          `UPDATE admin_messages SET is_read = true WHERE counselor_user_id = $1 AND sender_role = 'counselor' AND is_read = false`,
          [counselorUserId]
        );
        return NextResponse.json({ messages: res.rows });
      } catch { return NextResponse.json({ messages: [] }); }
    }

    // ── All key dates (including hidden) for admin ──
    if (view === 'all_dates') {
      try {
        const pool = getPool();
        const res = await pool.query('SELECT * FROM key_dates ORDER BY event_date ASC');
        return NextResponse.json({ dates: res.rows });
      } catch { return NextResponse.json({ dates: [] }); }
    }

    // ── College deadlines from CSV data ──
    if (view === 'college_deadlines') {
      try {
        const pool = getPool();
        await ensureSchema();
        const { ensureCollegeDeadlines } = await import('@/lib/seed-deadlines');
        await ensureCollegeDeadlines();
        const res = await pool.query('SELECT * FROM college_deadlines ORDER BY college_name, due_date');
        return NextResponse.json({ deadlines: res.rows });
      } catch { return NextResponse.json({ deadlines: [] }); }
    }

    // ── Payments view (from Stripe webhook records) ──
    if (view === 'payments') {
      const pool = getPool();
      try {
        // Ensure plan_id is varchar
        try { await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::VARCHAR`); } catch {}
        const paymentsRes = await pool.query(`
          SELECT p.id, p.user_id, u.name AS student_name, u.email AS student_email,
                 p.plan_name, p.amount_cents, p.status, p.stripe_session_id,
                 p.stripe_payment_intent_id, p.plan_id, p.created_at
          FROM payments p
          LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.created_at DESC
          LIMIT 200
        `);
        const statsRes = await pool.query(`
          SELECT
            COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END), 0)::int AS total_revenue,
            COALESCE(SUM(CASE WHEN status = 'succeeded' AND created_at >= date_trunc('month', NOW()) THEN amount_cents ELSE 0 END), 0)::int AS this_month,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0)::int AS pending,
            COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::int AS refunded
          FROM payments
        `);
        return NextResponse.json({
          payments: paymentsRes.rows,
          stats: statsRes.rows[0] || { total_revenue: 0, this_month: 0, pending: 0, refunded: 0 }
        });
      } catch (err: any) {
        console.error('[Admin payments view] Error:', err.message);
        return NextResponse.json({
          payments: [],
          stats: { total_revenue: 0, this_month: 0, pending: 0, refunded: 0 }
        });
      }
    }

    // ── Data Health: table row counts + freshness ──
    if (view === 'data_health') {
      const pool = getPool();
      const tables = ['users', 'profiles', 'colleges', 'essays', 'colleges_master', 'programs_master', 'llm_usage', 'ep_counselors', 'ep_assignments', 'ep_plans', 'student_settings'];
      const counts: Record<string, number> = {};
      for (const t of tables) {
        try {
          const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${t}`);
          counts[t] = r.rows[0].cnt;
        } catch { counts[t] = -1; }
      }
      // ope6_id join integrity
      let joinedCount = 0, orphanedCount = 0;
      try {
        const j = await pool.query(`SELECT COUNT(DISTINCT cm.ope6_id)::int AS cnt FROM colleges_master cm INNER JOIN programs_master pm ON pm.ope6_id = cm.ope6_id`);
        joinedCount = j.rows[0].cnt;
        orphanedCount = (counts.colleges_master > 0 ? counts.colleges_master : 0) - joinedCount;
      } catch {}
      // SAT coverage
      let satCoverage = 0;
      try {
        const sc = await pool.query(`SELECT COUNT(*)::int AS cnt FROM colleges_master WHERE sat_25 IS NOT NULL AND sat_75 IS NOT NULL AND acceptance_rate IS NOT NULL AND acceptance_rate > 0 AND grad_rate >= 0.30 AND enrollment > 300`);
        const el = await pool.query(`SELECT COUNT(*)::int AS cnt FROM colleges_master WHERE acceptance_rate IS NOT NULL AND acceptance_rate > 0 AND grad_rate >= 0.30 AND enrollment > 300`);
        satCoverage = el.rows[0].cnt > 0 ? Math.round(sc.rows[0].cnt / el.rows[0].cnt * 100) : 0;
      } catch {}
      // Program_Normalized count
      let progNormCount = 0;
      try {
        const pn = await pool.query(`SELECT COUNT(DISTINCT program_normalized)::int AS cnt FROM programs_master WHERE program_normalized IS NOT NULL`);
        progNormCount = pn.rows[0].cnt;
      } catch {}
      return NextResponse.json({ counts, joinedCount, orphanedCount, satCoverage, progNormCount });
    }

    // ── Subscriptions dashboard ──
    if (view === 'subscriptions') {
      const pool = getPool();
      try {
        const tiers = await pool.query(`
          SELECT subscription_status AS tier, COUNT(*)::int AS cnt
          FROM users WHERE role = 'student'
          GROUP BY subscription_status
        `);
        const expiring7 = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE subscription_status IN ('pro','premium') AND subscription_expires_at BETWEEN NOW() AND NOW() + interval '7 days'`);
        const expiring30 = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE subscription_status IN ('pro','premium') AND subscription_expires_at BETWEEN NOW() AND NOW() + interval '30 days'`);
        const expired30 = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE subscription_status IN ('free','cancelled') AND subscription_expires_at BETWEEN NOW() - interval '30 days' AND NOW()`);
        // All subscribers with details including assigned counselor
        const subscribers = await pool.query(`
          SELECT u.id, u.name, u.email, u.subscription_status, u.subscription_expires_at, u.created_at, u.last_login,
                 p.gpa, p.sat, p.final_score,
                 ss.intended_major, ss.high_school_name,
                 ec.display_name AS counselor_name,
                 a.plan AS assignment_plan, a.status AS assignment_status
          FROM users u
          LEFT JOIN profiles p ON p.user_id = u.id
          LEFT JOIN student_settings ss ON ss.user_id = u.id
          LEFT JOIN ep_assignments a ON a.student_id = u.id AND a.status = 'active'
          LEFT JOIN ep_counselors ec ON ec.id = a.counselor_id
          WHERE u.role = 'student'
          ORDER BY
            CASE u.subscription_status WHEN 'premium' THEN 1 WHEN 'pro' THEN 2 ELSE 3 END,
            u.created_at DESC
        `);
        // Payment history
        const payments = await pool.query(`
          SELECT p.id, p.user_id, u.name AS student_name, u.email AS student_email,
                 p.plan_name, p.amount_cents, p.status, p.created_at
          FROM payments p
          LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.created_at DESC LIMIT 100
        `).catch(() => ({ rows: [] }));
        return NextResponse.json({
          tiers: tiers.rows,
          expiring_7d: expiring7.rows[0].cnt,
          expiring_30d: expiring30.rows[0].cnt,
          churned_30d: expired30.rows[0].cnt,
          subscribers: subscribers.rows,
          payments: payments.rows,
        });
      } catch { return NextResponse.json({ tiers: [], expiring_7d: 0, expiring_30d: 0, churned_30d: 0, subscribers: [], payments: [] }); }
    }

    // ── Funnel: derived from user data ──
    if (view === 'funnel') {
      const pool = getPool();
      try {
        const total = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role='student'`);
        const withProfile = await pool.query(`SELECT COUNT(*)::int AS cnt FROM profiles`);
        const withColleges = await pool.query(`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM colleges`);
        const withEssays = await pool.query(`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM essays`);
        const submitted = await pool.query(`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM essays WHERE status='submitted'`);
        const paid = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role='student' AND subscription_status IN ('pro','premium')`);
        return NextResponse.json({
          signups: total.rows[0].cnt,
          profile_done: withProfile.rows[0].cnt,
          ran_engine: withColleges.rows[0].cnt,
          saved_college: withColleges.rows[0].cnt,
          started_essay: withEssays.rows[0].cnt,
          submitted_essay: submitted.rows[0].cnt,
          purchased: paid.rows[0].cnt,
        });
      } catch { return NextResponse.json({ signups:0,profile_done:0,ran_engine:0,saved_college:0,started_essay:0,submitted_essay:0,purchased:0 }); }
    }

    // ── Engine Health: aggregated from colleges + settings ──
    if (view === 'engine_health') {
      const pool = getPool();
      try {
        const bucketDist = await pool.query(`SELECT bucket, COUNT(*)::int AS cnt FROM colleges GROUP BY bucket`);
        const topSchools = await pool.query(`
          SELECT name, bucket, COUNT(*)::int AS times
          FROM colleges
          GROUP BY name, bucket
          ORDER BY times DESC
          LIMIT 20
        `);
        const majorDist = await pool.query(`
          SELECT ss.intended_major AS major, COUNT(*)::int AS cnt
          FROM student_settings ss
          WHERE ss.intended_major IS NOT NULL AND ss.intended_major != ''
          GROUP BY ss.intended_major
          ORDER BY cnt DESC
        `);
        const totalSaved = await pool.query(`SELECT COUNT(*)::int AS cnt FROM colleges`);
        const studentsWithColleges = await pool.query(`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM colleges`);
        return NextResponse.json({
          bucket_distribution: bucketDist.rows,
          top_schools: topSchools.rows,
          major_distribution: majorDist.rows,
          total_saved: totalSaved.rows[0].cnt,
          students_with_colleges: studentsWithColleges.rows[0].cnt,
        });
      } catch { return NextResponse.json({ bucket_distribution:[], top_schools:[], major_distribution:[], total_saved:0, students_with_colleges:0 }); }
    }

    // ── Error Log: from admin_logs table ──
    if (view === 'error_log') {
      const pool = getPool();
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_logs (id SERIAL PRIMARY KEY, level VARCHAR(10) NOT NULL DEFAULT 'info', source VARCHAR(50) NOT NULL, message TEXT NOT NULL, details JSONB, created_at TIMESTAMP DEFAULT NOW())`);
        const logs = await pool.query(`SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100`);
        const counts = await pool.query(`
          SELECT level, COUNT(*)::int AS cnt
          FROM admin_logs WHERE created_at > NOW() - interval '24 hours'
          GROUP BY level
        `);
        return NextResponse.json({ logs: logs.rows, level_counts: counts.rows });
      } catch { return NextResponse.json({ logs: [], level_counts: [] }); }
    }

    // ── Counselor Earnings & Payments ──
    if (view === 'earnings') {
      const pool = getPool();
      try {
        // Get all counselors with earnings data
        const counselorsRes = await pool.query(`
          SELECT ec.id, ec.display_name, ec.hourly_rate_cents, ec.total_earned_cents,
                 COALESCE(ec.status, 'active') AS counselor_status,
                 u.email,
                 COALESCE(a_agg.sessions_used, 0) AS sessions_used,
                 COALESCE(a_agg.sessions_total, 0) AS sessions_total,
                 COALESCE(a_agg.active_students, 0) AS active_students
          FROM ep_counselors ec
          JOIN users u ON u.id = ec.user_id
          LEFT JOIN LATERAL (
            SELECT SUM(sessions_used)::int AS sessions_used, SUM(sessions_total)::int AS sessions_total,
                   COUNT(*) FILTER (WHERE status = 'active')::int AS active_students
            FROM ep_assignments WHERE counselor_id = ec.id AND status != 'cancelled'
          ) a_agg ON true
          WHERE u.role = 'counselor'
          ORDER BY ec.display_name
        `);

        // Get assignments per counselor (include end_date and plan duration for payability/hours)
        const assignmentsRes = await pool.query(`
          SELECT a.id, a.counselor_id, a.plan, a.sessions_total, a.sessions_used, a.status, a.created_at, a.start_date, a.end_date,
                 u.name AS student_name, u.email AS student_email,
                 COALESCE(ep.session_duration_minutes, 60) AS session_duration_minutes,
                 COALESCE(ep.price_cents, 0) AS plan_price_cents
          FROM ep_assignments a
          JOIN users u ON u.id = a.student_id
          LEFT JOIN ep_plans ep ON ep.name = a.plan
          WHERE a.status != 'cancelled'
          ORDER BY a.created_at DESC
        `);

        // Get all payouts
        const payoutsRes = await pool.query(`
          SELECT * FROM counselor_payouts ORDER BY created_at DESC
        `).catch(() => ({ rows: [] }));

        // Build counselor earnings
        // Earnings are only payable when: all sessions done + 1 week after end_date
        const now = new Date();
        const counselors = counselorsRes.rows.map((c: any) => {
          const rate = c.hourly_rate_cents || 5000;
          const cAssignments = assignmentsRes.rows.filter((a: any) => a.counselor_id === c.id);
          const cPayouts = payoutsRes.rows.filter((p: any) => p.counselor_id === c.id);
          const paidCents = cPayouts.filter((p: any) => p.status === 'paid').reduce((s: number, p: any) => s + (p.amount_cents || 0), 0);

          let earnedCents = 0;
          let payableCents = 0;
          let hoursWorked = 0;

          const enrichedAssignments = cAssignments.map((a: any) => {
            const used = a.sessions_used || 0;
            const total = a.sessions_total || 0;
            const durationMin = a.session_duration_minutes || 60;
            const hoursPerSession = durationMin / 60;
            const assignmentHours = used * hoursPerSession;
            const earned = Math.round(assignmentHours * rate);
            const endDate = a.end_date ? new Date(a.end_date) : null;
            const weekAfterEnd = endDate ? new Date(endDate.getTime() + 7 * 86400000) : null;
            const cooldownPassed = weekAfterEnd ? now >= weekAfterEnd : false;
            // Payable when: status is 'completed' OR (end_date + 1 week has passed)
            // Payout is based on actual sessions_used × hourly rate (not sessions_total)
            const payable = (a.status === 'completed' || cooldownPassed) && used > 0;
            // Check if this specific assignment has been paid
            const assignmentPaid = cPayouts.some((p: any) => p.status === 'paid' && p.assignment_id === a.id);

            earnedCents += earned;
            if (payable && !assignmentPaid) payableCents += earned;
            hoursWorked += assignmentHours;

            return { ...a, earned_cents: earned, payable_cents: (payable && !assignmentPaid) ? earned : 0, payable: payable && !assignmentPaid, paid: assignmentPaid, payable_after: weekAfterEnd?.toISOString() || null, hours: assignmentHours, session_duration_minutes: durationMin };
          });

          const owedCents = Math.max(0, payableCents - paidCents);

          return {
            ...c,
            hourly_rate: rate,
            hours_worked: hoursWorked,
            earned_cents: earnedCents,
            payable_cents: payableCents,
            paid_cents: paidCents,
            owed_cents: owedCents,
            assignments: enrichedAssignments,
            payouts: cPayouts,
          };
        });

        const totalEarned = counselors.reduce((s: number, c: any) => s + c.earned_cents, 0);
        const totalPayable = counselors.reduce((s: number, c: any) => s + c.payable_cents, 0);
        const totalPaid = counselors.reduce((s: number, c: any) => s + c.paid_cents, 0);
        const totalOwed = counselors.reduce((s: number, c: any) => s + c.owed_cents, 0);
        const totalHours = counselors.reduce((s: number, c: any) => s + c.hours_worked, 0);
        const activeCounselors = counselors.filter((c: any) => c.active_students > 0).length;

        return NextResponse.json({
          counselors,
          totals: { earned: totalEarned, payable: totalPayable, paid: totalPaid, owed: totalOwed, hours: totalHours, active: activeCounselors },
        });
      } catch (err: any) {
        console.error('[Admin earnings]', err.message);
        return NextResponse.json({ counselors: [], totals: { earned: 0, paid: 0, owed: 0, hours: 0, active: 0 } });
      }
    }

    // ── Activity Log — all expert portal activities ──
    if (view === 'activity') {
      const pool = getPool();
      try {
        // PII detection patterns
        const piiPatterns = [
          { name: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
          { name: 'Phone', regex: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
          { name: 'SSN', regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/ },
        ];
        const detectPII = (text: string) => {
          if (!text) return [];
          return piiPatterns.filter(p => p.regex.test(text)).map(p => p.name);
        };

        // Get all activities across tables
        const [messagesRes, sessionsRes, actionsRes, notesRes, assignmentsRes] = await Promise.all([
          pool.query(`
            SELECT m.id, m.assignment_id, m.sender_role AS type_detail, m.body AS content, m.created_at,
                   'message' AS activity_type,
                   u_s.name AS student_name, ec.display_name AS counselor_name, a.plan
            FROM ep_messages m
            JOIN ep_assignments a ON a.id = m.assignment_id
            JOIN users u_s ON u_s.id = a.student_id
            JOIN ep_counselors ec ON ec.id = a.counselor_id
            ORDER BY m.created_at DESC LIMIT 500
          `),
          pool.query(`
            SELECT s.id, s.assignment_id, s.topic AS content, s.status AS type_detail, s.session_date, s.session_time, s.duration_min, s.created_at,
                   'session' AS activity_type,
                   u_s.name AS student_name, ec.display_name AS counselor_name, a.plan
            FROM ep_sessions s
            JOIN ep_assignments a ON a.id = s.assignment_id
            JOIN users u_s ON u_s.id = a.student_id
            JOIN ep_counselors ec ON ec.id = a.counselor_id
            ORDER BY s.created_at DESC LIMIT 200
          `),
          pool.query(`
            SELECT ac.id, ac.assignment_id, ac.text AS content, ac.is_done AS type_detail, ac.due_date, ac.assigned_by, ac.created_at,
                   'action' AS activity_type,
                   u_s.name AS student_name, ec.display_name AS counselor_name, a.plan
            FROM ep_actions ac
            JOIN ep_assignments a ON a.id = ac.assignment_id
            JOIN users u_s ON u_s.id = a.student_id
            JOIN ep_counselors ec ON ec.id = a.counselor_id
            ORDER BY ac.created_at DESC LIMIT 200
          `),
          pool.query(`
            SELECT n.id, n.assignment_id, n.title, n.content, n.author_role AS type_detail, n.is_pinned, n.created_at,
                   'note' AS activity_type,
                   u_s.name AS student_name, ec.display_name AS counselor_name, a.plan
            FROM ep_notes n
            JOIN ep_assignments a ON a.id = n.assignment_id
            JOIN users u_s ON u_s.id = a.student_id
            JOIN ep_counselors ec ON ec.id = a.counselor_id
            ORDER BY n.created_at DESC LIMIT 200
          `),
          pool.query(`
            SELECT a.id AS assignment_id, a.plan, a.status, a.sessions_used, a.sessions_total, a.start_date, a.end_date, a.created_at,
                   u_s.name AS student_name, ec.display_name AS counselor_name
            FROM ep_assignments a
            JOIN users u_s ON u_s.id = a.student_id
            JOIN ep_counselors ec ON ec.id = a.counselor_id
            ORDER BY a.created_at DESC
          `),
        ]);

        // Combine and add PII flags
        const activities = [
          ...messagesRes.rows.map((r: any) => ({ ...r, pii_flags: detectPII(r.content) })),
          ...sessionsRes.rows.map((r: any) => ({ ...r, pii_flags: detectPII(r.content) })),
          ...actionsRes.rows.map((r: any) => ({ ...r, pii_flags: detectPII(r.content) })),
          ...notesRes.rows.map((r: any) => ({ ...r, pii_flags: detectPII(r.content || r.title) })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const stats = {
          total_messages: messagesRes.rowCount || 0,
          total_sessions: sessionsRes.rowCount || 0,
          total_actions: actionsRes.rowCount || 0,
          total_notes: notesRes.rowCount || 0,
          total_assignments: assignmentsRes.rowCount || 0,
          pii_flagged: activities.filter(a => a.pii_flags.length > 0).length,
        };

        return NextResponse.json({ activities, assignments: assignmentsRes.rows, stats });
      } catch (err: any) {
        console.error('[Admin activity]', err.message);
        return NextResponse.json({ activities: [], assignments: [], stats: {} });
      }
    }

    // Phase 3: the `view=recap` branch was deleted. The Since-Last-Login
    // dashboard was replaced by the ranged Overview Metrics panel
    // (/api/admin/metrics), which covers the same counts with a 24h+
    // window selector. The activity timeline lives on the Activity tab.

    // ── System Status: check API key presence + DB health ──
    if (view === 'system_status') {
      const pool = getPool();
      const mask = (key: string | undefined) => {
        if (!key) return null;
        if (key.length < 10) return key.slice(0, 2) + '•••';
        return key.slice(0, 7) + '•••' + key.slice(-4);
      };

      const services = [
        {
          name: 'Stripe (Secret)',
          env_var: 'STRIPE_SECRET_KEY',
          status: process.env.STRIPE_SECRET_KEY ? 'connected' : 'not_set',
          key_preview: mask(process.env.STRIPE_SECRET_KEY),
          description: 'Payment processing — checkout, subscriptions, refunds',
        },
        {
          name: 'Stripe (Publishable)',
          env_var: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
          status: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? 'connected' : 'not_set',
          key_preview: mask(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
          description: 'Client-side Stripe.js — checkout form rendering',
        },
        {
          name: 'Stripe (Webhook)',
          env_var: 'STRIPE_WEBHOOK_SECRET',
          status: process.env.STRIPE_WEBHOOK_SECRET ? 'connected' : 'not_set',
          key_preview: mask(process.env.STRIPE_WEBHOOK_SECRET),
          description: 'Webhook signature verification — checkout.session.completed events',
        },
        {
          name: 'OpenAI',
          env_var: 'OPENAI_API_KEY',
          status: process.env.OPENAI_API_KEY ? 'connected' : 'not_set',
          key_preview: mask(process.env.OPENAI_API_KEY),
          description: 'LLM API — essay coaching, profile analysis, news generation',
        },
        {
          name: 'Postmark',
          env_var: 'POSTMARK_SERVER_TOKEN',
          status: process.env.POSTMARK_SERVER_TOKEN ? 'connected' : 'not_set',
          key_preview: mask(process.env.POSTMARK_SERVER_TOKEN),
          description: 'Transactional email — notifications, reminders, receipts',
        },
        {
          name: 'NextAuth Secret',
          env_var: 'NEXTAUTH_SECRET',
          status: process.env.NEXTAUTH_SECRET ? 'connected' : 'not_set',
          key_preview: process.env.NEXTAUTH_SECRET ? '••••••••' : null,
          description: 'Session encryption — required for authentication',
        },
      ];

      // Database health
      let dbStatus: any = { connected: false };
      try {
        const testRes = await pool.query('SELECT 1');
        dbStatus.connected = true;
        dbStatus.pool_total = (pool as any).totalCount ?? '—';
        dbStatus.pool_active = (pool as any).waitingCount ?? '—';
        dbStatus.pool_idle = (pool as any).idleCount ?? '—';
        const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
        if (pgUrl) {
          try {
            const u = new URL(pgUrl);
            dbStatus.url_preview = `${u.protocol}//${u.username}:••••@${u.host}${u.pathname}`;
          } catch {
            dbStatus.url_preview = pgUrl.slice(0, 20) + '•••';
          }
        }
      } catch { dbStatus.connected = false; }

      // Runtime info
      const runtime: Record<string, string> = {
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
        nextauth_url: process.env.NEXTAUTH_URL || 'not set',
        admin_emails: process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').length + ' configured' : 'not set',
        platform: process.platform,
        uptime: Math.floor(process.uptime() / 60) + ' minutes',
      };

      return NextResponse.json({ services, database: dbStatus, runtime });
    }

    return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  } catch (err: any) {
    console.error('[Admin GET]', err);
    return NextResponse.json({ error: 'Internal server error', details: err?.message || String(err) }, { status: 500 });
  }
}

// ── POST: create assignment, promote user to counselor ─────────────────────
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const pool = getPool();

  // ── Assign counselor to student ──
  if (body.action === 'assign') {
    const { counselor_id, student_id, plan, plan_id, sessions_total, start_date, end_date, force } = body;
    const total = sessions_total || 1;
    const cCheck = await pool.query('SELECT id FROM ep_counselors WHERE id=$1', [counselor_id]);
    if (!cCheck.rows.length) return NextResponse.json({ error: 'Counselor not found' }, { status: 404 });

    // Check for any active plans for this student (across all counselors)
    if (!force) {
      const activePlans = await pool.query(`
        SELECT a.id, a.plan, a.sessions_total, a.sessions_used, a.status, ec.display_name AS counselor_name
        FROM ep_assignments a
        JOIN ep_counselors ec ON ec.id = a.counselor_id
        WHERE a.student_id = $1 AND a.status = 'active'
      `, [student_id]);
      if (activePlans.rows.length > 0) {
        return NextResponse.json({
          conflict: true,
          active_plans: activePlans.rows,
          message: `Student has ${activePlans.rows.length} active plan(s). Proceed to create a new plan anyway?`,
        });
      }
    }

    // Always create a new assignment (no ON CONFLICT)
    const r = await pool.query(`
      INSERT INTO ep_assignments (counselor_id, student_id, plan, plan_id, sessions_total, sessions_used, status, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, 0, 'active', $6, $7)
      RETURNING *
    `, [counselor_id, student_id, plan || 'Starter', plan_id || null, total, start_date || null, end_date || null]);

    // Upgrade student to premium with expiry = end_date + 2 days
    const endDateVal = end_date ? new Date(end_date) : null;
    const premiumExpiry = endDateVal ? new Date(endDateVal.getTime() + 2 * 86400000) : new Date(Date.now() + 365 * 86400000);
    await pool.query(`UPDATE users SET subscription_status = 'premium', subscription_expires_at = $1 WHERE id = $2`, [premiumExpiry.toISOString(), student_id]);

    // Send assignment emails to both counselor and student
    try {
      const counselorRes = await pool.query(`SELECT ec.display_name, ec.title, u.email FROM ep_counselors ec JOIN users u ON u.id = ec.user_id WHERE ec.id = $1`, [counselor_id]);
      const studentRes = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [student_id]);
      const cslr = counselorRes.rows[0];
      const stdt = studentRes.rows[0];
      if (cslr?.email) {
        sendEmail.assignmentCounselor({
          to: cslr.email, counselorName: cslr.display_name,
          studentName: stdt?.name || 'Student', studentEmail: stdt?.email || '',
          planName: plan || 'Starter', sessions: total, duration: 60,
        }).catch((e) => { console.error('[Admin] Assignment counselor email failed:', e); });
      }
      if (stdt?.email) {
        sendEmail.assignmentStudent({
          to: stdt.email, studentName: stdt.name,
          counselorName: cslr?.display_name || 'Your Counselor',
          counselorTitle: cslr?.title || 'Admissions Counselor',
          planName: plan || 'Starter', sessions: total,
        }).catch((e) => { console.error('[Admin] Assignment student email failed:', e); });
      }
    } catch (e) { console.error('[Admin] Assignment email lookup failed:', e); }

    return NextResponse.json(r.rows[0]);
  }

  // ── Create plan ──
  if (body.action === 'create_plan') {
    const { name, sessions, price_cents, description, features } = body;
    const r = await pool.query(
      `INSERT INTO ep_plans (name, sessions, price_cents, description, features, sort_order) VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort_order),0)+1 FROM ep_plans)) RETURNING *`,
      [name, sessions || 1, price_cents || 0, description || '', features || []]
    );
    return NextResponse.json(r.rows[0]);
  }

  // ── Promote user to counselor ──
  if (body.action === 'promote_counselor') {
    const { user_id } = body;
    // Update role
    await pool.query(`UPDATE users SET role='counselor' WHERE id=$1`, [user_id]);
    // Get user info for display_name
    const userRes = await pool.query('SELECT name FROM users WHERE id=$1', [user_id]);
    const name = userRes.rows[0]?.name || 'Counselor';
    // Create ep_counselors row if not exists
    await pool.query(`
      INSERT INTO ep_counselors (user_id, display_name)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [user_id, name]);
    return NextResponse.json({ ok: true });
  }

  // ── Demote counselor back to student ──
  if (body.action === 'demote_student') {
    const { user_id } = body;
    await pool.query(`UPDATE users SET role='student' WHERE id=$1`, [user_id]);
    return NextResponse.json({ ok: true });
  }

  // ── Send message to a thread (admin → assignment) ──
  if (body.action === 'send_message') {
    const { assignment_id, body: msgBody, sender_role } = body;
    const r = await pool.query(
      `INSERT INTO ep_messages (assignment_id, sender_role, body) VALUES ($1, $2, $3) RETURNING *`,
      [assignment_id, sender_role || 'counselor', msgBody]
    );
    return NextResponse.json(r.rows[0]);
  }

  // ── Admin ↔ Counselor direct messaging ──
  if (body.action === 'admin_msg_send') {
    const { counselor_user_id, message, broadcast_ids } = body;
    // Broadcast: send to multiple counselors
    if (broadcast_ids && Array.isArray(broadcast_ids) && broadcast_ids.length > 0) {
      for (const cid of broadcast_ids) {
        await pool.query(
          `INSERT INTO admin_messages (counselor_user_id, sender_role, body) VALUES ($1, 'admin', $2)`,
          [cid, message]
        );
      }
      return NextResponse.json({ ok: true, sent: broadcast_ids.length });
    }
    // Single message
    if (!counselor_user_id || !message) return NextResponse.json({ error: 'Missing counselor_user_id or message' }, { status: 400 });
    const r = await pool.query(
      `INSERT INTO admin_messages (counselor_user_id, sender_role, body) VALUES ($1, 'admin', $2) RETURNING *`,
      [counselor_user_id, message]
    );
    return NextResponse.json(r.rows[0]);
  }

  if (body.action === 'admin_msg_mark_read') {
    const { counselor_user_id } = body;
    await pool.query(
      `UPDATE admin_messages SET is_read = TRUE WHERE counselor_user_id = $1 AND sender_role = 'counselor' AND is_read = FALSE`,
      [counselor_user_id]
    );
    return NextResponse.json({ ok: true });
  }

  // ── Approve pending counselor ──
  if (body.action === 'approve_counselor') {
    const { user_id } = body;
    const adminUser = await pool.query('SELECT id FROM users WHERE email=$1', [session.user.email]);
    const adminId = adminUser.rows[0]?.id;
    await pool.query(`UPDATE users SET role='counselor' WHERE id=$1 AND role='pending_counselor'`, [user_id]);
    await pool.query(`UPDATE ep_counselors SET reviewed_at=NOW(), reviewed_by=$1 WHERE user_id=$2`, [adminId, user_id]);
    const userRes = await pool.query('SELECT name, email FROM users WHERE id=$1', [user_id]);
    // Send approval email
    if (userRes.rows[0]) {
      sendEmail.counselorApproved({ to: userRes.rows[0].email, name: userRes.rows[0].name }).catch(() => {});
    }
    console.log('[Admin] Counselor approved:', userRes.rows[0]?.email);
    return NextResponse.json({ ok: true, message: 'Counselor approved' });
  }

  // ── Reject pending counselor ──
  if (body.action === 'reject_counselor') {
    const { user_id } = body;
    const adminUser = await pool.query('SELECT id FROM users WHERE email=$1', [session.user.email]);
    const adminId = adminUser.rows[0]?.id;
    await pool.query(`UPDATE users SET role='rejected' WHERE id=$1 AND role='pending_counselor'`, [user_id]);
    await pool.query(`UPDATE ep_counselors SET reviewed_at=NOW(), reviewed_by=$1 WHERE user_id=$2`, [adminId, user_id]);
    // Send rejection email
    try {
      const u = await pool.query('SELECT email, name FROM users WHERE id=$1', [user_id]);
      if (u.rows[0]) sendEmail.counselorRejected({ to: u.rows[0].email, name: u.rows[0].name, reason: body.reason }).catch(() => {});
    } catch {}
    console.log('[Admin] Counselor rejected:', user_id);
    return NextResponse.json({ ok: true, message: 'Counselor rejected' });
  }

  // ── Send email placeholder (wire up with SendGrid/SES/Resend later) ──
  if (body.action === 'send_email') {
    const { to, subject, body: emailBody, recipient_type } = body;
    if (!to || !subject || !emailBody) {
      return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 });
    }
    const sent = await sendEmail.adminManual({ to, subject, body: emailBody });
    if (sent) {
      return NextResponse.json({ ok: true, message: 'Email sent via Postmark' });
    } else {
      console.log('[Admin Email] Postmark not configured or failed — logged:', { to, subject, recipient_type });
      return NextResponse.json({ ok: true, message: 'Email logged (configure POSTMARK_SERVER_TOKEN to send)' });
    }
  }

  // ── Lock / Unlock student ──
  if (body.action === 'toggle_lock') {
    const { student_id, locked } = body;
    const pool = getPool();
    await pool.query('UPDATE users SET is_locked = $1 WHERE id = $2', [!!locked, student_id]);
    if (locked) {
      try {
        const u = await pool.query('SELECT email, name FROM users WHERE id=$1', [student_id]);
        if (u.rows[0]) sendEmail.accountLocked({ to: u.rows[0].email, name: u.rows[0].name }).catch(() => {});
      } catch {}
    }
    return NextResponse.json({ ok: true, locked: !!locked });
  }

  // ── Toggle lock on another admin ──
  // SECURITY: Separate from toggle_lock because the permission rules are
  // different and we don't want the regular lock action to accidentally
  // affect admin users if a client passes an admin's id.
  //
  // Rules:
  //   1. Caller must be admin (already enforced at the top of POST).
  //   2. Target must exist and must itself be an admin — either by DB role
  //      or by being listed in ADMIN_EMAILS. Otherwise this action returns
  //      400 and the caller should use the regular toggle_lock.
  //   3. Target must NOT be the caller themselves. Admins cannot lock
  //      themselves out of their own account.
  //   4. Target must NOT be an ADMIN_EMAILS-defined admin. Env-based admins
  //      are superadmins whose admin status is set by deployment config,
  //      not by DB state. Locking them doesn't remove their admin rights
  //      on their next login (env is re-checked every request), it just
  //      breaks their ability to authenticate at all — a denial-of-service
  //      foot-gun with no legitimate use case.
  if (body.action === 'toggle_admin_lock') {
    const { target_id, locked } = body;
    if (!target_id || typeof target_id !== 'number') {
      return NextResponse.json({ error: 'target_id is required' }, { status: 400 });
    }
    const pool = getPool();

    // Load the target user
    const targetRes = await pool.query(
      'SELECT id, email, name, role, is_locked FROM users WHERE id = $1',
      [target_id]
    );
    if (targetRes.rows.length === 0) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }
    const target = targetRes.rows[0];

    // Determine whether the target is an admin
    const envAdmins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
    const targetEmailLc = (target.email || '').toLowerCase();
    const targetIsDbAdmin = target.role === 'admin';
    const targetIsEnvAdmin = envAdmins.includes(targetEmailLc);
    if (!targetIsDbAdmin && !targetIsEnvAdmin) {
      return NextResponse.json({ error: 'Target is not an admin' }, { status: 400 });
    }

    // Self-lock guard
    const callerEmailLc = (session.user.email || '').toLowerCase();
    if (callerEmailLc === targetEmailLc) {
      return NextResponse.json({ error: 'You cannot lock your own account' }, { status: 403 });
    }

    // Env-admin guard
    if (targetIsEnvAdmin) {
      return NextResponse.json(
        { error: 'Cannot lock an admin defined by ADMIN_EMAILS. Remove them from the env var instead.' },
        { status: 403 }
      );
    }

    // Apply the lock
    await pool.query('UPDATE users SET is_locked = $1 WHERE id = $2', [!!locked, target.id]);

    // Audit trail
    try {
      await pool.query(
        `INSERT INTO admin_logs (level, source, message, details) VALUES ('warn', 'admin', $1, $2)`,
        [
          `Admin ${callerEmailLc} ${locked ? 'locked' : 'unlocked'} admin ${targetEmailLc}`,
          JSON.stringify({ caller: callerEmailLc, target_id: target.id, target_email: targetEmailLc, locked: !!locked }),
        ]
      );
    } catch {}

    // Notify the locked admin so they know what happened
    if (locked) {
      try {
        sendEmail.accountLocked({ to: target.email, name: target.name || 'Admin' }).catch(() => {});
      } catch {}
    }

    return NextResponse.json({ ok: true, locked: !!locked });
  }

  // ── Toggle Premium (manual assignment) ──
  if (body.action === 'grant_pro' && body.student_id) {
    const pool = getPool();
    await pool.query(
      `UPDATE users SET subscription_status='pro', subscription_expires_at=NOW() + INTERVAL '1 year' WHERE id=$1`,
      [body.student_id]
    );
    // Insert courtesy payment record so subscription check routes don't revert to free
    await pool.query(
      `INSERT INTO payments (user_id, stripe_session_id, amount_cents, currency, status, plan_id, plan_name, metadata)
       VALUES ($1, $2, 0, 'usd', 'succeeded', 'pro_admin', 'Pro (admin grant)', $3)`,
      [body.student_id, `admin_grant_${Date.now()}`, JSON.stringify({ granted_by: 'admin' })]
    ).catch(() => {});
    // Log
    try {
      const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [body.student_id]);
      await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`,
        [`Granted Pro to ${rows[0]?.name || body.student_id}`]);
    } catch {}
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'revoke_pro' && body.student_id) {
    const pool = getPool();
    await pool.query(
      `UPDATE users SET subscription_status='free', subscription_expires_at=NULL WHERE id=$1`,
      [body.student_id]
    );
    // Mark only the most recent succeeded pro payment as refunded
    const { rows: latestPro } = await pool.query(
      `SELECT id FROM payments WHERE user_id=$1 AND status='succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') ORDER BY created_at DESC LIMIT 1`,
      [body.student_id]
    );
    if (latestPro[0]) {
      await pool.query(`UPDATE payments SET status='refunded', updated_at=NOW() WHERE id=$1`, [latestPro[0].id]);
    }
    // Log
    try {
      const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [body.student_id]);
      await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`,
        [`Revoked Pro from ${rows[0]?.name || body.student_id}`]);
    } catch {}
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'toggle_premium') {
    const { student_id, premium } = body;
    const pool = getPool();
    if (premium) {
      // Check if an active assignment already exists
      const existing = await pool.query(`SELECT id FROM ep_assignments WHERE student_id = $1 AND status = 'active'`, [student_id]);
      if (!existing.rows.length) {
        const counselorRes = await pool.query(`SELECT id FROM ep_counselors LIMIT 1`);
        const planRes = await pool.query(`SELECT id, name, sessions FROM ep_plans ORDER BY sort_order LIMIT 1`);
        if (counselorRes.rows[0] && planRes.rows[0]) {
          await pool.query(
            `INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, status)
             VALUES ($1, $2, $3, $4, $5, 'active')`,
            [counselorRes.rows[0].id, student_id, planRes.rows[0].id, planRes.rows[0].name, planRes.rows[0].sessions]
          );
        }
      }
    } else {
      await pool.query(`UPDATE ep_assignments SET status = 'cancelled' WHERE student_id = $1 AND status = 'active'`, [student_id]);
    }
    return NextResponse.json({ ok: true, premium: !!premium });
  }

  // ── Grant Premium (from Action Items) ──
  if (body.action === 'grant_premium' && body.student_id) {
    const pool = getPool();
    await pool.query(
      `UPDATE users SET subscription_status = 'premium', subscription_expires_at = NOW() + interval '1 year' WHERE id = $1`,
      [body.student_id]
    );
    return NextResponse.json({ ok: true });
  }

  // ── Revoke Premium (from Action Items) ──
  if (body.action === 'revoke_premium' && body.student_id) {
    const pool = getPool();
    // Revert to pro (not free) — Pro is independent of Premium
    await pool.query(
      `UPDATE users SET subscription_status = 'pro' WHERE id = $1`,
      [body.student_id]
    );
    // Cancel only ACTIVE assignments
    await pool.query(`UPDATE ep_assignments SET status = 'cancelled' WHERE student_id = $1 AND status = 'active'`, [body.student_id]);
    return NextResponse.json({ ok: true });
  }

  // ── Assign counselor to premium student (from Action Items) ──
  if (body.action === 'assign_counselor' && body.student_id && body.counselor_id) {
    const pool = getPool();
    // Get plan (use specified plan_id or default to highest)
    const planRes = body.plan_id
      ? await pool.query(`SELECT id, name, sessions, COALESCE(session_duration_minutes,60) AS duration FROM ep_plans WHERE id = $1`, [body.plan_id])
      : await pool.query(`SELECT id, name, sessions, COALESCE(session_duration_minutes,60) AS duration FROM ep_plans ORDER BY sort_order DESC LIMIT 1`);
    const plan = planRes.rows[0];
    if (!plan) return NextResponse.json({ error: 'No plan found' }, { status: 400 });

    // Create assignment with pending_acceptance status
    const assignRes = await pool.query(
      `INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, status, notified_at)
       VALUES ($1, $2, $3, $4, $5, 'pending_acceptance', NOW())
       RETURNING id`,
      [body.counselor_id, body.student_id, plan.id, plan.name, plan.sessions]
    );

    // Get counselor + student info for email
    const counselorRes = await pool.query(`SELECT ec.display_name, ec.title, u.email FROM ep_counselors ec JOIN users u ON u.id = ec.user_id WHERE ec.id = $1`, [body.counselor_id]);
    const studentRes = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [body.student_id]);
    const counselor = counselorRes.rows[0];
    const student = studentRes.rows[0];

    // Send assignment emails to both counselor and student
    if (counselor?.email) {
      sendEmail.assignmentCounselor({
        to: counselor.email, counselorName: counselor.display_name,
        studentName: student?.name || 'Student', studentEmail: student?.email || '',
        planName: plan.name, sessions: plan.sessions, duration: plan.duration,
      }).catch((e) => { console.error('[Admin] Assignment counselor email failed:', e); });
    } else {
      console.warn('[Admin] No counselor email found for id:', body.counselor_id);
    }
    if (student?.email) {
      sendEmail.assignmentStudent({
        to: student.email, studentName: student.name,
        counselorName: counselor?.display_name || 'Your Counselor',
        counselorTitle: counselor?.title || 'Admissions Counselor',
        planName: plan.name, sessions: plan.sessions,
      }).catch((e) => { console.error('[Admin] Assignment student email failed:', e); });
    } else {
      console.warn('[Admin] No student email found for id:', body.student_id);
    }

    // Log
    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
        `Assigned ${student?.name} to ${counselor?.display_name} (${plan.name}) — pending acceptance`,
        JSON.stringify({ assignment_id: assignRes.rows[0]?.id, counselor_id: body.counselor_id, student_id: body.student_id }),
      ]);
    } catch {}

    return NextResponse.json({ ok: true, status: 'pending_acceptance' });
  }

  // ── Edit assignment ──
  if (body.action === 'edit_assignment' && body.assignment_id) {
    const pool = getPool();

    // ── Counselor Switch: if counselor_id is changing, don't carry over activities ──
    if (body.counselor_id) {
      const { rows: oldRows } = await pool.query(
        `SELECT counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, start_date, end_date, target_schools FROM ep_assignments WHERE id = $1`,
        [body.assignment_id]
      );
      const old = oldRows[0];
      if (old && old.counselor_id !== body.counselor_id) {
        // Mark old assignment as 'switched' — admin-only status, hidden from student/counselor
        await pool.query(`UPDATE ep_assignments SET status = 'switched' WHERE id = $1`, [body.assignment_id]);

        // Create fresh assignment for new counselor — no messages/sessions/actions/notes carry over
        const newPlanId = body.plan_id || old.plan_id;
        const newPlan = body.plan_id
          ? (await pool.query(`SELECT name, sessions FROM ep_plans WHERE id = $1`, [body.plan_id])).rows[0]
          : null;

        const { rows: newAssign } = await pool.query(
          `INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, start_date, end_date, target_schools, notified_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id`,
          [
            body.counselor_id,
            old.student_id,
            newPlanId,
            newPlan?.name || old.plan,
            body.sessions_used !== undefined ? (newPlan?.sessions || old.sessions_total) : old.sessions_total,
            0, // fresh start — no sessions used
            body.status || 'active',
            body.start_date || new Date().toISOString().split('T')[0],
            body.end_date || old.end_date,
            old.target_schools || [],
          ]
        );

        // Log the switch with details
        try {
          const oldCounselor = await pool.query(`SELECT display_name FROM ep_counselors WHERE id = $1`, [old.counselor_id]);
          const newCounselor = await pool.query(`SELECT display_name FROM ep_counselors WHERE id = $1`, [body.counselor_id]);
          const student = await pool.query(`SELECT name FROM users WHERE id = $1`, [old.student_id]);
          await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
            `Counselor switch: ${student.rows[0]?.name} moved from ${oldCounselor.rows[0]?.display_name} to ${newCounselor.rows[0]?.display_name}`,
            JSON.stringify({
              old_assignment_id: body.assignment_id,
              new_assignment_id: newAssign[0]?.id,
              old_counselor_id: old.counselor_id,
              new_counselor_id: body.counselor_id,
              student_id: old.student_id,
              reason: 'counselor_switch',
            }),
          ]);
        } catch {}

        // Sync subscription status
        if (body.status === 'active' || (!body.status && old.status === 'active')) {
          try {
            const endDate = body.end_date ? new Date(body.end_date) : (old.end_date ? new Date(old.end_date) : null);
            const premiumExpiry = endDate ? new Date(endDate.getTime() + 2 * 86400000) : new Date(Date.now() + 365 * 86400000);
            await pool.query(`UPDATE users SET subscription_status = 'premium', subscription_expires_at = $1 WHERE id = $2`, [premiumExpiry.toISOString(), old.student_id]);
          } catch {}
        }

        return NextResponse.json({ ok: true, switched: true, new_assignment_id: newAssign[0]?.id });
      }
    }

    // ── Normal edit (no counselor change) ──
    const updates: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (body.status) {
      updates.push(`status = $${idx++}`);
      vals.push(body.status);
    }
    // Note: counselor_id changes are handled above via the switch logic
    if (body.plan_id) {
      const planRes = await pool.query(`SELECT name, sessions FROM ep_plans WHERE id = $1`, [body.plan_id]);
      if (planRes.rows[0]) {
        updates.push(`plan_id = $${idx++}`);
        vals.push(body.plan_id);
        updates.push(`plan = $${idx++}`);
        vals.push(planRes.rows[0].name);
        updates.push(`sessions_total = $${idx++}`);
        vals.push(planRes.rows[0].sessions);
      }
    }
    if (body.start_date !== undefined) {
      updates.push(`start_date = $${idx++}`);
      vals.push(body.start_date || null);
    }
    if (body.end_date !== undefined) {
      updates.push(`end_date = $${idx++}`);
      vals.push(body.end_date || null);
    }
    if (body.sessions_used !== undefined) {
      updates.push(`sessions_used = $${idx++}`);
      vals.push(body.sessions_used);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    vals.push(body.assignment_id);
    await pool.query(`UPDATE ep_assignments SET ${updates.join(', ')} WHERE id = $${idx}`, vals);

    // Sync subscription status based on new assignment status
    if (body.status) {
      try {
        const { rows: assignRow } = await pool.query(`SELECT student_id, end_date FROM ep_assignments WHERE id = $1`, [body.assignment_id]);
        if (assignRow[0]) {
          const studentId = assignRow[0].student_id;
          if (body.status === 'active' || body.status === 'paused') {
            // Active/paused assignment = premium
            const endDate = assignRow[0].end_date ? new Date(assignRow[0].end_date) : null;
            const premiumExpiry = endDate ? new Date(endDate.getTime() + 2 * 86400000) : new Date(Date.now() + 365 * 86400000);
            await pool.query(`UPDATE users SET subscription_status = 'premium', subscription_expires_at = $1 WHERE id = $2`, [premiumExpiry.toISOString(), studentId]);
          } else if (body.status === 'cancelled' || body.status === 'completed') {
            // Cancelled/completed = revert to pro (not free)
            // Only revert if no other active/paused assignments remain
            const { rows: otherActive } = await pool.query(
              `SELECT id FROM ep_assignments WHERE student_id = $1 AND id != $2 AND status IN ('active','paused') LIMIT 1`,
              [studentId, body.assignment_id]
            );
            if (otherActive.length === 0) {
              await pool.query(`UPDATE users SET subscription_status = 'pro' WHERE id = $1 AND subscription_status = 'premium'`, [studentId]);
            }
          }
        }
      } catch {}
    }

    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
        `Edited assignment #${body.assignment_id}`,
        JSON.stringify({ assignment_id: body.assignment_id, changes: body }),
      ]);
    } catch {}

    // Send email notifications for status changes
    if (body.status && ['cancelled', 'paused', 'completed'].includes(body.status)) {
      try {
        const { rows: aRows } = await pool.query(
          `SELECT a.student_id, a.plan, a.sessions_total, a.sessions_used,
                  u_s.email AS student_email, u_s.name AS student_name,
                  ec.display_name AS counselor_name, u_c.email AS counselor_email
           FROM ep_assignments a
           JOIN users u_s ON u_s.id = a.student_id
           JOIN ep_counselors ec ON ec.id = a.counselor_id
           JOIN users u_c ON u_c.id = ec.user_id
           WHERE a.id = $1`, [body.assignment_id]
        );
        if (aRows[0]) {
          const a = aRows[0];
          if (body.status === 'cancelled') {
            if (a.student_email) sendEmail.assignmentCancelled({ to: a.student_email, name: a.student_name, otherName: a.counselor_name, planName: a.plan, role: 'student', reason: body.reason }).catch(() => {});
            if (a.counselor_email) sendEmail.assignmentCancelled({ to: a.counselor_email, name: a.counselor_name, otherName: a.student_name, planName: a.plan, role: 'counselor' }).catch(() => {});
          } else if (body.status === 'paused') {
            if (a.student_email) sendEmail.assignmentPaused({ to: a.student_email, name: a.student_name, otherName: a.counselor_name, planName: a.plan, role: 'student' }).catch(() => {});
            if (a.counselor_email) sendEmail.assignmentPaused({ to: a.counselor_email, name: a.counselor_name, otherName: a.student_name, planName: a.plan, role: 'counselor' }).catch(() => {});
          } else if (body.status === 'completed') {
            if (a.student_email) sendEmail.assignmentCompleted({ to: a.student_email, name: a.student_name, otherName: a.counselor_name, planName: a.plan, role: 'student' }).catch(() => {});
            if (a.counselor_email) sendEmail.assignmentCompleted({ to: a.counselor_email, name: a.counselor_name, otherName: a.student_name, planName: a.plan, role: 'counselor', sessionsUsed: a.sessions_used, sessionsTotal: a.sessions_total }).catch(() => {});
          }
        }
      } catch (e) { console.error('[Admin] Assignment status email failed:', e); }
    }

    return NextResponse.json({ ok: true });
  }

  // ── Reassign declined assignment to new counselor ──
  if (body.action === 'reassign' && body.assignment_id && body.new_counselor_id) {
    const pool = getPool();
    // Get current assignment
    const { rows: assignRows } = await pool.query(`SELECT * FROM ep_assignments WHERE id = $1`, [body.assignment_id]);
    if (!assignRows[0]) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    const old = assignRows[0];

    // Update to new counselor, reset to pending_acceptance
    await pool.query(`
      UPDATE ep_assignments 
      SET counselor_id = $2, status = 'pending_acceptance', declined_reason = NULL, accepted_at = NULL, notified_at = NOW()
      WHERE id = $1
    `, [body.assignment_id, body.new_counselor_id]);

    // Send email to new counselor (same logic as above, simplified)
    const counselorRes = await pool.query(`SELECT ec.display_name, u.email FROM ep_counselors ec JOIN users u ON u.id = ec.user_id WHERE ec.id = $1`, [body.new_counselor_id]);
    const studentRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [old.student_id]);
    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`, [
        `Reassigned ${studentRes.rows[0]?.name} from declined counselor to ${counselorRes.rows[0]?.display_name}`,
      ]);
    } catch {}

    return NextResponse.json({ ok: true, status: 'pending_acceptance' });
  }

  // ── Get counselor earnings summary ──
  if (body.action === 'get_earnings' && body.counselor_id) {
    const pool = getPool();
    const { rows: assignments } = await pool.query(`
      SELECT a.id, a.plan, a.sessions_total, a.sessions_used, a.status, a.created_at,
             u.name AS student_name,
             p.session_duration_minutes,
             ec.hourly_rate_cents
      FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      LEFT JOIN ep_plans p ON p.id = a.plan_id
      WHERE a.counselor_id = $1
      ORDER BY a.created_at DESC
    `, [body.counselor_id]);

    const { rows: payouts } = await pool.query(`
      SELECT * FROM counselor_payouts WHERE counselor_id = $1 ORDER BY created_at DESC
    `, [body.counselor_id]).catch(() => ({ rows: [] }));

    // Calculate earnings per assignment
    const earnings = assignments.map((a: any) => {
      const duration = a.session_duration_minutes || 60;
      const hours = (a.sessions_used * duration) / 60;
      const earned = Math.round(hours * (a.hourly_rate_cents || 5000) / 100) * 100; // in cents
      const totalHours = (a.sessions_total * duration) / 60;
      const totalPossible = Math.round(totalHours * (a.hourly_rate_cents || 5000) / 100) * 100;
      return { ...a, hours_worked: hours, earned_cents: earned, total_possible_cents: totalPossible };
    });

    const totalEarned = earnings.reduce((s: number, e: any) => s + e.earned_cents, 0);
    const totalPaid = payouts.reduce((s: number, p: any) => s + (p.status === 'paid' ? p.amount_cents : 0), 0);

    return NextResponse.json({ earnings, payouts, total_earned_cents: totalEarned, total_paid_cents: totalPaid, owed_cents: totalEarned - totalPaid });
  }

  // ── Reject premium & refund (from Action Items) ──
  if (body.action === 'reject_premium' && body.student_id) {
    const pool = getPool();
    // Revert to pro
    await pool.query(
      `UPDATE users SET subscription_status = 'pro' WHERE id = $1`,
      [body.student_id]
    );
    // Cancel active AND pending_acceptance assignments
    await pool.query(`UPDATE ep_assignments SET status = 'cancelled' WHERE student_id = $1 AND status IN ('active','pending_acceptance')`, [body.student_id]);

    // Find the premium payment to refund
    const { rows: pmtRows } = await pool.query(
      `SELECT id, stripe_session_id, stripe_payment_intent_id, amount_cents FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'premium%' OR LOWER(plan_name) IN ('full cycle','essay only','starter')) ORDER BY created_at DESC LIMIT 1`,
      [body.student_id]
    );

    let stripeRefundId = null;
    let refundStatus = 'pending';

    if (pmtRows.length > 0 && process.env.STRIPE_SECRET_KEY) {
      const payment = pmtRows[0];
      
      // Skip Stripe refund for zero-amount payments (admin grants)
      if (payment.amount_cents <= 0) {
        refundStatus = 'refunded';
        console.log(`[Admin] Zero-amount payment — skipping Stripe refund for student ${body.student_id}`);
      } else {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

          // Get payment_intent from the checkout session if not stored
          let paymentIntentId = payment.stripe_payment_intent_id;
          if (!paymentIntentId && payment.stripe_session_id) {
            try {
              const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
              paymentIntentId = session.payment_intent as string;
            } catch (sessErr: any) {
              console.warn(`[Admin] Could not retrieve Stripe session:`, sessErr.message);
            }
          }

          if (paymentIntentId) {
            try {
              const refund = await stripe.refunds.create({
                payment_intent: paymentIntentId,
                reason: 'requested_by_customer',
                metadata: { student_id: String(body.student_id), reason: body.reason || 'Admin rejected premium' },
              });
              stripeRefundId = refund.id;
              refundStatus = 'refunded';
              console.log(`[Admin] Stripe refund ${refund.id} created for student ${body.student_id}: $${(payment.amount_cents/100).toFixed(2)}`);
            } catch (refundErr: any) {
              if (refundErr.message?.includes('already been refunded') || refundErr.code === 'charge_already_refunded') {
                refundStatus = 'refunded';
                console.log(`[Admin] Payment already refunded for student ${body.student_id}`);
              } else {
                console.error(`[Admin] Stripe refund failed:`, refundErr.message);
                refundStatus = 'refund_failed';
              }
            }
          } else {
            refundStatus = 'refunded';
            console.log(`[Admin] No payment intent found — marking as refunded (manual)`);
          }
        } catch (stripeErr: any) {
          console.error(`[Admin] Stripe error:`, stripeErr.message);
          refundStatus = 'refund_failed';
        }
      }
    }

    // Mark payment as refunded
    if (pmtRows.length > 0) {
      await pool.query(
        `UPDATE payments SET status = $1, metadata = jsonb_set(COALESCE(metadata::jsonb, '{}'), '{refund_id}', $2::jsonb) WHERE id = $3`,
        [refundStatus, JSON.stringify(stripeRefundId || 'offline'), pmtRows[0].id]
      ).catch(() => {
        // Fallback if metadata column isn't jsonb
        pool.query(`UPDATE payments SET status = $1 WHERE id = $2`, [refundStatus, pmtRows[0].id]);
      });
    }

    // Log
    try {
      const { rows: studentRows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [body.student_id]);
      await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
        `Rejected premium for ${studentRows[0]?.name || body.student_id}${stripeRefundId ? ' — Stripe refund ' + stripeRefundId : ' — manual refund needed'}`,
        JSON.stringify({ student_id: body.student_id, reason: body.reason, refund_id: stripeRefundId, refund_status: refundStatus }),
      ]);
    } catch {}

    return NextResponse.json({ ok: true, refund_status: refundStatus, stripe_refund_id: stripeRefundId, reason: body.reason || '' });
  }

  // ── Sync payments from Stripe ──
  if (body.action === 'sync_stripe_payments') {
    const pool = getPool();
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: 'STRIPE_SECRET_KEY not set' }, { status: 503 });
    
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);
      try { await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text`); } catch {}
      
      const sessions = await stripe.checkout.sessions.list({ limit: 50 });
      let synced = 0;
      
      for (const s of sessions.data) {
        if (s.payment_status !== 'paid') continue;
        const userId = parseInt(s.client_reference_id || s.metadata?.user_id || '0') || null;
        if (!userId) continue;
        
        // Verify user exists in DB (avoid FK constraint violation)
        const { rows: userExists } = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
        if (userExists.length === 0) continue;
        
        // Check if already recorded
        const { rows: existing } = await pool.query(`SELECT id FROM payments WHERE stripe_session_id = $1`, [s.id]);
        if (existing.length > 0) continue;
        
        // Record it
        await pool.query(`
          INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, currency, status, plan_id, plan_name, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9)
        `, [
          userId, s.id, s.payment_intent || null, s.customer || null,
          s.amount_total || 0, s.currency || 'usd',
          s.metadata?.plan_id || null, s.metadata?.plan_name || 'Unknown',
          JSON.stringify(s.metadata || {}),
        ]);
        
        // Also upgrade user if needed
        const planId = s.metadata?.plan_id || '';
        const planName = s.metadata?.plan_name || '';
        const isPremium = planId.startsWith('premium') || ['full cycle', 'essay only', 'starter'].includes(planName.toLowerCase());
        const newStatus = isPremium ? 'premium' : 'pro';
        
        const { rows: userRows } = await pool.query(`SELECT subscription_status FROM users WHERE id = $1`, [userId]);
        if (userRows[0] && userRows[0].subscription_status === 'free') {
          await pool.query(`UPDATE users SET subscription_status = $1, subscription_expires_at = NOW() + INTERVAL '1 year', stripe_customer_id = $2 WHERE id = $3`,
            [newStatus, s.customer || null, userId]);
        }
        
        synced++;
      }
      
      console.log(`[Admin] Synced ${synced} payments from Stripe`);
      return NextResponse.json({ ok: true, synced, total_checked: sessions.data.length });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Re-import colleges_master from CSV ──
  if (body.action === 'reimport_colleges') {
    try {
      const { reloadCollegesMaster } = await import('@/lib/seed-colleges');
      const result = await reloadCollegesMaster();
      return NextResponse.json({ ok: true, message: `Reimported ${result.inserted} colleges`, ...result });
    } catch (err: any) {
      console.error('[Admin] Reimport failed:', err);
      return NextResponse.json({ error: 'Reimport failed', details: err?.message }, { status: 500 });
    }
  }

  // ── Refund / cancel a payment ──
  if (body.action === 'refund_payment' && body.payment_id) {
    const pool = getPool();
    try {
      // Get payment details
      const { rows } = await pool.query(`SELECT * FROM payments WHERE id = $1`, [body.payment_id]);
      if (!rows[0]) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
      const payment = rows[0];

      // Try Stripe refund if we have a real Stripe session ID (not admin grants)
      if (process.env.STRIPE_SECRET_KEY && payment.stripe_session_id && !payment.stripe_session_id.startsWith('admin_grant_')) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
          if (session.payment_intent) {
            await stripe.refunds.create({ payment_intent: session.payment_intent as string, reason: 'requested_by_customer' });
          }
        } catch (stripeErr: any) {
          console.error('[Admin] Stripe refund failed:', stripeErr.message);
        }
      }

      // Update payment status
      await pool.query(`UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1`, [body.payment_id]);

      // Downgrade user based on plan type
      if (payment.user_id) {
        const planId = payment.plan_id || '';
        const planName = (payment.plan_name || '').toLowerCase();
        const isPremiumPayment = planId.startsWith('premium') || ['full cycle','essay only','starter'].includes(planName);

        if (isPremiumPayment) {
          // Premium refund: revert to pro, cancel assignments
          await pool.query(`UPDATE users SET subscription_status = 'pro' WHERE id = $1`, [payment.user_id]);
          await pool.query(`UPDATE ep_assignments SET status = 'cancelled' WHERE student_id = $1 AND status IN ('active','pending_acceptance','paused')`, [payment.user_id]);
        } else {
          // Pro refund: check for active premium assignment
          const { rows: activeAssign } = await pool.query(
            `SELECT id FROM ep_assignments WHERE student_id = $1 AND status IN ('active','paused') LIMIT 1`, [payment.user_id]
          );
          if (activeAssign.length > 0) {
            // Keep premium status since assignment is active
            console.log(`[Admin] Pro refund — user ${payment.user_id} has active premium, keeping premium`);
          } else {
            await pool.query(`UPDATE users SET subscription_status = 'free', subscription_expires_at = NULL WHERE id = $1`, [payment.user_id]);
          }
        }
      }

      // Log
      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`,
          [`Refunded payment #${body.payment_id} — $${(payment.amount_cents/100).toFixed(2)}. Reason: ${body.reason || 'None'}`,
           JSON.stringify({ payment_id: body.payment_id, user_id: payment.user_id, reason: body.reason })]);
      } catch {}

      // Send refund email
      try {
        const u = await pool.query('SELECT email, name FROM users WHERE id=$1', [payment.user_id]);
        if (u.rows[0]) {
          const piId = payment.stripe_payment_intent_id || '';
          sendEmail.refundProcessed({
            to: u.rows[0].email, name: u.rows[0].name,
            planName: payment.plan_name || 'Admitly Plan',
            amount: `$${(payment.amount_cents / 100).toFixed(2)}`,
            date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            invoiceId: `#INV-${new Date(payment.created_at || Date.now()).toISOString().slice(0,10).replace(/-/g,'')}-${String(payment.user_id).padStart(4,'0')}`,
            transactionId: piId ? `${piId.slice(0, 14)}...${piId.slice(-4)}` : undefined,
            reason: body.reason,
          }).catch(() => {});
        }
      } catch {}

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Set user subscription status (admin override — no payment required) ──
  if (body.action === 'set_subscription' && body.user_id && body.status) {
    const pool = getPool();
    const validStatuses = ['free', 'pro', 'premium'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status. Must be: free, pro, or premium' }, { status: 400 });
    }
    try {
      const expiresAt = body.status === 'free' ? null : new Date(Date.now() + 365 * 86400000).toISOString();
      await pool.query(
        `UPDATE users SET subscription_status = $1, subscription_expires_at = $2 WHERE id = $3`,
        [body.status, expiresAt, body.user_id]
      );

      // If upgrading to pro, insert a courtesy payment record so status checks don't revert it
      if (body.status === 'pro' || body.status === 'premium') {
        await pool.query(
          `INSERT INTO payments (user_id, stripe_session_id, amount_cents, currency, status, plan_id, plan_name, metadata)
           VALUES ($1, $2, 0, 'usd', 'succeeded', $3, $4, $5)`,
          [body.user_id, `admin_grant_${Date.now()}`, body.status === 'premium' ? 'premium_admin' : 'pro_admin',
           body.status === 'premium' ? 'Premium (admin grant)' : 'Pro (admin grant)',
           JSON.stringify({ granted_by: 'admin', reason: body.reason || 'Admin override' })]
        );
      }

      // Log
      const { rows: userRow } = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [body.user_id]);
      await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
        `Set ${userRow[0]?.name || body.user_id} to ${body.status}${body.reason ? ' — ' + body.reason : ''}`,
        JSON.stringify({ user_id: body.user_id, new_status: body.status, reason: body.reason }),
      ]).catch(() => {});

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Add counselor manually ──
  if (body.action === 'add_counselor' && body.email && body.name) {
    const pool = getPool();
    try {
      const bcrypt = (await import('bcryptjs')).default;
      const password = body.password || 'counselor123';
      const hashed = await bcrypt.hash(password, 12);

      // Create user
      const userRes = await pool.query(
        `INSERT INTO users (email, name, password, role, subscription_status)
         VALUES ($1, $2, $3, 'counselor', 'free') RETURNING id`,
        [body.email.trim().toLowerCase(), body.name.trim(), hashed]
      );
      const userId = userRes.rows[0]?.id;
      if (!userId) return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });

      // Create counselor profile
      await pool.query(
        `INSERT INTO ep_counselors (user_id, display_name, specialties, years_experience, availability)
         VALUES ($1, $2, $3, $4, 'Available')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, body.name.trim(), body.specialties || [], parseInt(body.years_experience) || 0]
      );

      // Log
      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`,
          [`Counselor added manually: ${body.name} (${body.email})`]);
      } catch {}

      return NextResponse.json({ ok: true, id: userId, password_hint: password });
    } catch (err: any) {
      if (err.code === '23505') return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Set counselor status ──
  if (body.action === 'set_counselor_status' && body.counselor_id && body.status) {
    const pool = getPool();
    const validStatuses = ['active', 'on_leave', 'suspended', 'inactive'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status. Use: ' + validStatuses.join(', ') }, { status: 400 });
    }
    await pool.query(`UPDATE ep_counselors SET status = $1 WHERE id = $2`, [body.status, body.counselor_id]);
    // Sync counselor_settings availability_enabled
    try {
      const userRes = await pool.query(`SELECT user_id FROM ep_counselors WHERE id = $1`, [body.counselor_id]);
      if (userRes.rows[0]) {
        await pool.query(`UPDATE counselor_settings SET availability_enabled = $1 WHERE user_id = $2`, [body.status === 'active', userRes.rows[0].user_id]);
      }
    } catch {}
    if (body.status === 'suspended' || body.status === 'inactive') {
      await pool.query(`UPDATE ep_assignments SET status = 'paused' WHERE counselor_id = $1 AND status = 'active'`, [body.counselor_id]);
    }
    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`,
        [`Counselor #${body.counselor_id} status changed to ${body.status}`]);
    } catch {}
    return NextResponse.json({ ok: true });
  }

  // ── Set counselor hourly rate ──
  if (body.action === 'set_hourly_rate' && body.counselor_id && body.rate_cents !== undefined) {
    const pool = getPool();
    const rate = Math.max(0, parseInt(body.rate_cents) || 0);
    await pool.query(`UPDATE ep_counselors SET hourly_rate_cents = $1 WHERE id = $2`, [rate, body.counselor_id]);
    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message) VALUES ('info', 'admin', $1)`,
        [`Counselor #${body.counselor_id} hourly rate set to $${(rate/100).toFixed(2)}`]);
    } catch {}
    return NextResponse.json({ ok: true, hourly_rate_cents: rate });
  }

  // ── Pay counselor — record payout and zero balance ──
  if (body.action === 'pay_counselor' && body.counselor_id && body.amount_cents) {
    const pool = getPool();
    try {
      const amount = parseInt(body.amount_cents) || 0;
      if (amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

      // Get counselor info including Stripe Connect account
      const { rows: cRows } = await pool.query(
        `SELECT id, display_name, hourly_rate_cents, total_earned_cents, stripe_connect_account_id FROM ep_counselors WHERE id = $1`,
        [body.counselor_id]
      );
      if (!cRows[0]) return NextResponse.json({ error: 'Counselor not found' }, { status: 404 });

      // Try Stripe Connect transfer if counselor has connected account
      let stripeTransferId = null;
      let paymentMethod = body.notes?.split(':')[0] || 'manual';

      if (cRows[0].stripe_connect_account_id && process.env.STRIPE_SECRET_KEY) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

          const transfer = await stripe.transfers.create({
            amount,
            currency: 'usd',
            destination: cRows[0].stripe_connect_account_id,
            description: `Payout to ${cRows[0].display_name}`,
            metadata: {
              counselor_id: String(body.counselor_id),
              notes: body.notes || '',
            },
          });

          stripeTransferId = transfer.id;
          paymentMethod = 'stripe_connect';
          console.log(`[Admin] Stripe transfer ${transfer.id} created for counselor ${cRows[0].display_name}: $${(amount/100).toFixed(2)}`);
        } catch (stripeErr: any) {
          console.error(`[Admin] Stripe transfer failed:`, stripeErr.message);
          // Fall through to manual recording — don't fail the whole operation
        }
      }

      // Record payout
      await pool.query(`
        INSERT INTO counselor_payouts (counselor_id, amount_cents, rate_cents, hours, status, notes, stripe_transfer_id, paid_at)
        VALUES ($1, $2, $3, $4, 'paid', $5, $6, NOW())
      `, [
        body.counselor_id,
        amount,
        cRows[0].hourly_rate_cents || 5000,
        body.hours || 0,
        `${paymentMethod}: ${body.notes || 'Payout by admin'}`,
        stripeTransferId,
      ]);

      // Update total_earned_cents (add to running total) and reset owed
      await pool.query(`UPDATE ep_counselors SET total_earned_cents = total_earned_cents + $1 WHERE id = $2`, [amount, body.counselor_id]);

      // Log
      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
          `Paid ${cRows[0].display_name} $${(amount/100).toFixed(2)}${stripeTransferId ? ' via Stripe Connect' : ''}`,
          JSON.stringify({ counselor_id: body.counselor_id, amount_cents: amount, stripe_transfer_id: stripeTransferId, notes: body.notes }),
        ]);
      } catch {}

      return NextResponse.json({ ok: true, payout_amount: amount, stripe_transfer_id: stripeTransferId, method: paymentMethod });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Pay counselor for specific plans (one payout row per plan) ──
  if (body.action === 'pay_counselor_plans' && body.counselor_id && body.plans?.length > 0) {
    const pool = getPool();
    try {
      const { rows: cRows } = await pool.query(
        `SELECT id, display_name, hourly_rate_cents, total_earned_cents, stripe_connect_account_id FROM ep_counselors WHERE id = $1`,
        [body.counselor_id]
      );
      if (!cRows[0]) return NextResponse.json({ error: 'Counselor not found' }, { status: 404 });

      const totalAmount = body.plans.reduce((s: number, p: any) => s + (p.amount_cents || 0), 0);
      const method = body.method || 'offline';
      const userNotes = body.notes || '';

      let stripeTransferId: string | null = null;
      if (method === 'stripe_connect' && cRows[0].stripe_connect_account_id && process.env.STRIPE_SECRET_KEY) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const transfer = await stripe.transfers.create({
            amount: totalAmount,
            currency: 'usd',
            destination: cRows[0].stripe_connect_account_id,
            description: `Payout to ${cRows[0].display_name} — ${body.plans.length} plan(s)`,
            metadata: { counselor_id: String(body.counselor_id), notes: userNotes, plan_count: String(body.plans.length) },
          });
          stripeTransferId = transfer.id;
        } catch (stripeErr: any) {
          console.error(`[Admin] Stripe transfer failed:`, stripeErr.message);
        }
      }

      const paymentId = stripeTransferId || 'Offline';

      for (const plan of body.plans) {
        await pool.query(`
          INSERT INTO counselor_payouts (counselor_id, amount_cents, rate_cents, hours, status, notes, stripe_transfer_id, assignment_id, paid_at)
          VALUES ($1, $2, $3, $4, 'paid', $5, $6, $7, NOW())
        `, [
          body.counselor_id,
          plan.amount_cents || 0,
          cRows[0].hourly_rate_cents || 5000,
          plan.hours || 0,
          `Student: ${plan.student_name || '—'}, Plan: ${plan.plan_name || '—'}${userNotes ? ' | ' + userNotes : ''}`,
          stripeTransferId,
          plan.assignment_id || null,
        ]);
      }

      await pool.query(`UPDATE ep_counselors SET total_earned_cents = total_earned_cents + $1 WHERE id = $2`, [totalAmount, body.counselor_id]);

      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
          `Paid ${cRows[0].display_name} $${(totalAmount/100).toFixed(2)} for ${body.plans.length} plan(s)${stripeTransferId ? ' via Stripe' : ' offline'}`,
          JSON.stringify({ counselor_id: body.counselor_id, total_cents: totalAmount, plans: body.plans.length, stripe_transfer_id: stripeTransferId }),
        ]);
      } catch {}

      return NextResponse.json({ ok: true, total_amount: totalAmount, plans_paid: body.plans.length, payment_id: paymentId });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Bulk import users from CSV data ──
  if (body.action === 'bulk_import' && body.users) {
    // Ensure schema is up to date (subscription_status, auth_provider columns,
    // etc. may not exist on cold start if this POST is the first DB-touching
    // admin call after deploy).
    try { await ensureSchema(); } catch (e) { console.error('[bulk_import] ensureSchema failed:', e); }

    const bcrypt = (await import('bcryptjs')).default;
    if (!Array.isArray(body.users)) {
      return NextResponse.json({ ok: true, created: 0, skipped: 0, errors: ['users payload is not an array'] });
    }
    const users: { name: string; email: string; role?: string }[] = body.users;
    if (users.length === 0) {
      return NextResponse.json({ ok: true, created: 0, skipped: 0, errors: ['No users provided'] });
    }
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const u of users) {
      const email = u.email?.trim().toLowerCase();
      const name = u.name?.trim();
      const rawRole = (u.role?.trim().toLowerCase() || 'student');
      if (!email || !name) { skipped++; errors.push(`Skipped: missing name or email`); continue; }

      // Check if account already exists
      const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (existing.rows.length > 0) { skipped++; errors.push(`${email}: already exists`); continue; }

      // Create with random password (user will reset via forgot password)
      const tempPw = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
      const role = rawRole === 'counselor' ? 'pending_counselor' : 'student';

      try {
        const res = await pool.query(
          `INSERT INTO users (email, name, password, role, subscription_status, auth_provider) VALUES ($1, $2, $3, $4, 'free', 'credentials') RETURNING id`,
          [email, name, tempPw, role]
        );

        // Create counselor profile if applicable
        if (rawRole === 'counselor' && res.rows[0]) {
          await pool.query(
            `INSERT INTO ep_counselors (user_id, display_name, applied_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO NOTHING`,
            [res.rows[0].id, name]
          ).catch(() => {});
        }

        // Send invite email (non-blocking — don't let email failures count as import failures)
        sendEmail.accountInvite({ to: email, name, role: rawRole }).catch((emailErr) => {
          console.error(`[bulk_import] invite email failed for ${email}:`, emailErr?.message);
        });
        created++;
      } catch (e: any) {
        skipped++;
        // Log full error server-side for diagnosis; surface a short message to the UI.
        console.error(`[bulk_import] INSERT failed for ${email}:`, e);
        errors.push(`${email}: ${e?.message || 'database error'}`);
      }
    }

    // Log
    try {
      await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'admin', $1, $2)`, [
        `Bulk import: ${created} created, ${skipped} skipped`,
        JSON.stringify({ created, skipped, errors: errors.slice(0, 20) }),
      ]);
    } catch {}

    return NextResponse.json({ ok: true, created, skipped, errors: errors.slice(0, 20) });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const pool = getPool();

  if (body.action === 'update_assignment') {
    const { id, plan, sessions_total, sessions_used, status } = body;
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (plan !== undefined)           { sets.push(`plan=$${i++}`); vals.push(plan); }
    if (sessions_total !== undefined) { sets.push(`sessions_total=$${i++}`); vals.push(sessions_total); }
    if (sessions_used !== undefined)  { sets.push(`sessions_used=$${i++}`); vals.push(sessions_used); }
    if (status !== undefined)         { sets.push(`status=$${i++}`); vals.push(status); }
    if (sets.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 });
    vals.push(id);
    const r = await pool.query(`UPDATE ep_assignments SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
    return NextResponse.json(r.rows[0]);
  }

  if (body.action === 'update_plan') {
    const { id, name, sessions, price_cents, discounted_price_cents, description, features } = body;
    const r = await pool.query(
      `UPDATE ep_plans SET name=$1, sessions=$2, price_cents=$3, discounted_price_cents=$4, description=$5, features=$6 WHERE id=$7 RETURNING *`,
      [name, sessions, price_cents, discounted_price_cents ?? null, description || '', features || [], id]
    );
    return NextResponse.json(r.rows[0]);
  }

  if (body.action === 'toggle_plan') {
    const { id, is_active } = body;
    const r = await pool.query('UPDATE ep_plans SET is_active=$1 WHERE id=$2 RETURNING *', [is_active, id]);
    return NextResponse.json(r.rows[0]);
  }

  // ── Update user role directly ──
  if (body.action === 'set_role') {
    const { user_id, role } = body;
    if (!['student','counselor','admin'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    await pool.query(`UPDATE users SET role=$1 WHERE id=$2`, [role, user_id]);
    if (role === 'counselor') {
      const userRes = await pool.query('SELECT name FROM users WHERE id=$1', [user_id]);
      await pool.query(`INSERT INTO ep_counselors (user_id, display_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [user_id, userRes.rows[0]?.name || 'Counselor']);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ── DELETE: remove assignment ───────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const pool = getPool();

  if (body.action === 'remove_assignment' && body.id) {
    await pool.query('DELETE FROM ep_assignments WHERE id=$1', [body.id]);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'delete_user' && body.student_id) {
    const uid = parseInt(body.student_id);
    // Delete all user content first (most have ON DELETE CASCADE but be explicit)
    await pool.query('DELETE FROM essay_drafts      WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM colleges          WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM llm_usage         WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM student_settings  WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM profiles          WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM ep_assignments    WHERE student_id = $1', [uid]);
    await pool.query('DELETE FROM payments          WHERE user_id = $1', [uid]);
    // Finally delete the user row itself
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
    console.log(`[admin] deleted user ${uid}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
