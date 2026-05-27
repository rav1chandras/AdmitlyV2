import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  const search = searchParams.get('search');
  const roleFilter = searchParams.get('role') || 'all'; // all | student | counselor

  const pool = getPool();

  // ── Search mode: return matching users ──
  if (search && !userId) {
    const q = `%${search.toLowerCase()}%`;
    let roleWhere = '';
    if (roleFilter === 'student') roleWhere = `AND role = 'student'`;
    else if (roleFilter === 'counselor') roleWhere = `AND role = 'counselor'`;
    else roleWhere = `AND role IN ('student','counselor')`;

    const { rows } = await pool.query(
      `SELECT id, name, email, role, subscription_status, created_at, last_login
       FROM users WHERE (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1) ${roleWhere}
       ORDER BY created_at DESC LIMIT 20`,
      [q]
    );
    return NextResponse.json({ users: rows });
  }

  // ── Journey mode: return full timeline for a user ──
  if (!userId) return NextResponse.json({ error: 'user_id or search required' }, { status: 400 });
  const uid = parseInt(userId);

  try {
    // User info
    const { rows: userRows } = await pool.query(
      `SELECT id, name, email, role, subscription_status, subscription_expires_at, created_at, last_login, stripe_customer_id
       FROM users WHERE id = $1`, [uid]
    );
    if (!userRows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const user = userRows[0];

    const events: { date: string; type: string; title: string; detail: string; icon: string; color: string }[] = [];

    // Account created
    events.push({
      date: user.created_at,
      type: 'account',
      title: 'Account Created',
      detail: `${user.name} joined as ${user.role}`,
      icon: 'fa-user-plus',
      color: '#059669',
    });

    if (user.role === 'student') {
      // ── STUDENT JOURNEY ──

      // Profile
      const { rows: profile } = await pool.query(
        `SELECT gpa, sat, act, final_score, created_at FROM profiles WHERE user_id = $1`, [uid]
      );
      if (profile[0]) {
        events.push({
          date: profile[0].created_at,
          type: 'profile',
          title: 'Profile Completed',
          detail: `GPA ${profile[0].gpa || '—'} · SAT ${profile[0].sat || '—'} · ACT ${profile[0].act || '—'} · Score ${profile[0].final_score || '—'}`,
          icon: 'fa-id-card',
          color: '#2563eb',
        });
      }

      // Payments
      const { rows: payments } = await pool.query(
        `SELECT id, plan_id, plan_name, amount_cents, status, stripe_session_id, created_at FROM payments WHERE user_id = $1 ORDER BY created_at`, [uid]
      );
      for (const p of payments) {
        const amt = `$${((p.amount_cents || 0) / 100).toFixed(2)}`;
        const isGrant = p.stripe_session_id?.startsWith('admin_grant_');
        const statusLabel = p.status === 'succeeded' ? 'Paid' : p.status === 'refunded' ? 'Refunded' : p.status === 'disputed' ? 'Disputed' : p.status;
        events.push({
          date: p.created_at,
          type: 'payment',
          title: `${p.plan_name || p.plan_id || 'Payment'} — ${statusLabel}`,
          detail: isGrant ? `${amt} (Admin grant)` : `${amt} via Stripe`,
          icon: p.status === 'succeeded' ? 'fa-credit-card' : p.status === 'refunded' ? 'fa-rotate-left' : 'fa-triangle-exclamation',
          color: p.status === 'succeeded' ? '#059669' : p.status === 'refunded' ? '#7c3aed' : '#dc2626',
        });
      }

      // Colleges added
      const { rows: colleges } = await pool.query(
        `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS first_added FROM colleges WHERE user_id = $1`, [uid]
      );
      if (colleges[0]?.cnt > 0) {
        events.push({
          date: colleges[0].first_added,
          type: 'colleges',
          title: `${colleges[0].cnt} Colleges Added`,
          detail: 'Started building college list',
          icon: 'fa-university',
          color: '#ca8a04',
        });
      }

      // Essays
      const { rows: essays } = await pool.query(
        `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS first FROM essays WHERE user_id = $1`, [uid]
      );
      if (essays[0]?.cnt > 0) {
        events.push({
          date: essays[0].first,
          type: 'essays',
          title: `${essays[0].cnt} Essays Created`,
          detail: 'Started writing essays',
          icon: 'fa-pen-nib',
          color: '#6366f1',
        });
      }

      // Assignments
      const { rows: assignments } = await pool.query(
        `SELECT a.id, a.plan, a.status, a.sessions_used, a.sessions_total, a.start_date, a.end_date, a.created_at,
                ec.display_name AS counselor_name
         FROM ep_assignments a
         JOIN ep_counselors ec ON ec.id = a.counselor_id
         WHERE a.student_id = $1 ORDER BY a.created_at`, [uid]
      );
      for (const a of assignments) {
        events.push({
          date: a.created_at,
          type: 'assignment',
          title: `Assigned to ${a.counselor_name}`,
          detail: `${a.plan} · ${a.sessions_used}/${a.sessions_total} sessions · Status: ${a.status}`,
          icon: a.status === 'active' ? 'fa-handshake' : a.status === 'completed' ? 'fa-flag-checkered' : a.status === 'cancelled' ? 'fa-ban' : a.status === 'switched' ? 'fa-shuffle' : 'fa-clock',
          color: a.status === 'active' ? '#059669' : a.status === 'completed' ? '#2563eb' : a.status === 'cancelled' ? '#dc2626' : '#78716c',
        });
      }

      // Sessions
      const { rows: sessions } = await pool.query(
        `SELECT s.topic, s.status, s.session_date, s.created_at, ec.display_name AS counselor_name
         FROM ep_sessions s
         JOIN ep_assignments a ON a.id = s.assignment_id
         JOIN ep_counselors ec ON ec.id = a.counselor_id
         WHERE a.student_id = $1 ORDER BY s.session_date`, [uid]
      );
      for (const s of sessions) {
        events.push({
          date: s.session_date || s.created_at,
          type: 'session',
          title: s.topic || 'Session',
          detail: `With ${s.counselor_name} · ${s.status}`,
          icon: s.status === 'completed' ? 'fa-video' : 'fa-calendar-check',
          color: s.status === 'completed' ? '#7c3aed' : '#f59e0b',
        });
      }

    } else if (user.role === 'counselor') {
      // ── COUNSELOR JOURNEY ──

      // Counselor profile
      const { rows: cProfile } = await pool.query(
        `SELECT id, display_name, status, hourly_rate_cents, total_students, years_experience, specialties
         FROM ep_counselors WHERE user_id = $1`, [uid]
      );
      if (cProfile[0]) {
        const c = cProfile[0];
        if (c.status === 'active') {
          events.push({
            date: user.created_at,
            type: 'approved',
            title: 'Counselor Approved',
            detail: `${c.display_name} · $${((c.hourly_rate_cents || 0) / 100).toFixed(0)}/hr · ${c.years_experience || 0}yr exp · ${(c.specialties || []).join(', ')}`,
            icon: 'fa-check-circle',
            color: '#059669',
          });
        }

        // Students assigned
        const { rows: assignments } = await pool.query(
          `SELECT a.id, a.plan, a.status, a.sessions_used, a.sessions_total, a.created_at,
                  u.name AS student_name, u.email AS student_email
           FROM ep_assignments a
           JOIN users u ON u.id = a.student_id
           WHERE a.counselor_id = $1 ORDER BY a.created_at`, [c.id]
        );
        for (const a of assignments) {
          events.push({
            date: a.created_at,
            type: 'assignment',
            title: `Student Assigned — ${a.student_name}`,
            detail: `${a.plan} · ${a.sessions_used}/${a.sessions_total} sessions · ${a.status}`,
            icon: 'fa-user-graduate',
            color: a.status === 'active' ? '#059669' : a.status === 'completed' ? '#2563eb' : '#78716c',
          });
        }

        // Sessions delivered
        const { rows: sessions } = await pool.query(
          `SELECT s.topic, s.status, s.session_date, s.created_at, u.name AS student_name
           FROM ep_sessions s
           JOIN ep_assignments a ON a.id = s.assignment_id
           JOIN users u ON u.id = a.student_id
           WHERE a.counselor_id = $1 ORDER BY s.session_date`, [c.id]
        );
        for (const s of sessions) {
          events.push({
            date: s.session_date || s.created_at,
            type: 'session',
            title: s.topic || 'Session',
            detail: `With ${s.student_name} · ${s.status}`,
            icon: 'fa-video',
            color: s.status === 'completed' ? '#7c3aed' : '#f59e0b',
          });
        }

        // Payouts
        const { rows: payouts } = await pool.query(
          `SELECT cp.amount_cents, cp.hours, cp.status, cp.paid_at, cp.created_at, cp.notes
           FROM counselor_payouts cp
           WHERE cp.counselor_id = $1 ORDER BY cp.created_at`, [c.id]
        );
        for (const p of payouts) {
          events.push({
            date: p.paid_at || p.created_at,
            type: 'payout',
            title: `Payout — $${((p.amount_cents || 0) / 100).toFixed(2)}`,
            detail: `${p.hours || 0}hr · ${p.status}${p.notes ? ' · ' + p.notes : ''}`,
            icon: p.status === 'paid' ? 'fa-money-bill-wave' : 'fa-clock',
            color: p.status === 'paid' ? '#059669' : '#f59e0b',
          });
        }
      }
    }

    // Last login
    if (user.last_login) {
      events.push({
        date: user.last_login,
        type: 'login',
        title: 'Last Login',
        detail: new Date(user.last_login).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
        icon: 'fa-right-to-bracket',
        color: '#78716c',
      });
    }

    // Sort chronologically
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({ user, events });
  } catch (err: any) {
    console.error('[Journey API]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
