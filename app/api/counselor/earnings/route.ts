import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id as string);
    const role = (session.user as any).role;
    if (role !== 'counselor') return NextResponse.json({ error: 'Counselors only' }, { status: 403 });

    const pool = getPool();

    // Get counselor profile
    const { rows: cRows } = await pool.query(
      `SELECT id, display_name, hourly_rate_cents, total_earned_cents, status FROM ep_counselors WHERE user_id = $1`, [userId]
    );
    if (!cRows.length) return NextResponse.json({ counselor: null, assignments: [], payouts: [] });
    const counselor = cRows[0];

    // Get all assignments with student info and plan duration
    const { rows: assignments } = await pool.query(`
      SELECT a.id, a.plan, a.sessions_total, a.sessions_used, a.status, a.created_at, a.end_date,
             a.accepted_at, a.declined_reason,
             u.name AS student_name, u.email AS student_email,
             COALESCE(ep.session_duration_minutes, 60) AS session_duration_minutes
      FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      LEFT JOIN ep_plans ep ON ep.name = a.plan
      WHERE a.counselor_id = $1
      ORDER BY a.created_at DESC
    `, [counselor.id]);

    // Get payouts
    const { rows: payouts } = await pool.query(`
      SELECT cp.id, cp.amount_cents, cp.hours, cp.rate_cents, cp.status, cp.paid_at, cp.notes, cp.created_at,
             a.plan AS assignment_plan, u.name AS student_name
      FROM counselor_payouts cp
      LEFT JOIN ep_assignments a ON a.id = cp.assignment_id
      LEFT JOIN users u ON u.id = a.student_id
      WHERE cp.counselor_id = $1
      ORDER BY cp.created_at DESC
    `, [counselor.id]).catch(() => ({ rows: [] }));

    // Calculate earnings per assignment
    // Earnings are only payable when:
    //   1. All sessions completed (sessions_used >= sessions_total)
    //   2. 1 week has passed since end_date (or end_date is null and sessions are exhausted)
    const rate = counselor.hourly_rate_cents || 5000;
    const now = new Date();
    const enrichedAssignments = assignments.map((a: any) => {
      const used = a.sessions_used || 0;
      const durationMin = a.session_duration_minutes || 60;
      const hoursPerSession = durationMin / 60;
      const assignmentHours = used * hoursPerSession;
      const earned = Math.round(assignmentHours * rate);
      const endDate = a.end_date ? new Date(a.end_date) : null;
      const weekAfterEnd = endDate ? new Date(endDate.getTime() + 7 * 86400000) : null;
      const cooldownPassed = weekAfterEnd ? now >= weekAfterEnd : false;
      const payable = (a.status === 'completed' || cooldownPassed) && used > 0;

      return {
        ...a,
        earned_cents: earned,
        payable_cents: payable ? earned : 0,
        payable,
        rate_cents: rate,
        hours: assignmentHours,
        payable_after: weekAfterEnd ? weekAfterEnd.toISOString() : null,
      };
    });

    const totalEarned = enrichedAssignments.reduce((s: number, a: any) => s + a.earned_cents, 0);
    const totalPayable = enrichedAssignments.reduce((s: number, a: any) => s + a.payable_cents, 0);
    const totalPaid = payouts.reduce((s: number, p: any) => s + (p.status === 'paid' ? (p.amount_cents || 0) : 0), 0);

    return NextResponse.json({
      counselor: {
        ...counselor,
        hourly_rate: rate,
        total_earned: totalEarned,
        total_payable: totalPayable,
        total_paid: totalPaid,
        balance_owed: Math.max(0, totalPayable - totalPaid),
      },
      assignments: enrichedAssignments,
      payouts,
    });
  } catch (err: any) {
    console.error('[CounselorEarnings]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
