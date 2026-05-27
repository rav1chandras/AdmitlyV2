import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/counselor/respond
 * Counselor accepts or declines an assignment.
 * Body: { assignment_id, action: 'accept' | 'decline', reason?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assignment_id, action, reason } = await request.json();
    if (!assignment_id || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request. Need assignment_id and action (accept/decline).' }, { status: 400 });
    }

    const pool = getPool();

    // Verify this assignment belongs to this counselor
    const { rows } = await pool.query(`
      SELECT a.id, a.student_id, a.status, a.plan, a.sessions_total,
             ec.id AS counselor_id, ec.user_id, ec.display_name,
             u_s.name AS student_name, u_s.email AS student_email
      FROM ep_assignments a
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      JOIN users u_s ON u_s.id = a.student_id
      WHERE a.id = $1 AND ec.user_id = $2
    `, [assignment_id, parseInt(session.user.id)]);

    if (!rows[0]) {
      return NextResponse.json({ error: 'Assignment not found or not yours' }, { status: 404 });
    }

    const assignment = rows[0];

    if (assignment.status !== 'pending_acceptance') {
      return NextResponse.json({ error: `Cannot respond — assignment is already '${assignment.status}'` }, { status: 400 });
    }

    if (action === 'accept') {
      await pool.query(`
        UPDATE ep_assignments 
        SET status = 'active', accepted_at = NOW() 
        WHERE id = $1
      `, [assignment_id]);

      // Log
      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'counselor', $1, $2)`, [
          `${assignment.display_name} accepted assignment for ${assignment.student_name} (${assignment.plan})`,
          JSON.stringify({ assignment_id, counselor_id: assignment.counselor_id, student_id: assignment.student_id }),
        ]);
      } catch {}

      // TODO: Send notification email to student that counselor accepted

      return NextResponse.json({ ok: true, status: 'active' });
    }

    if (action === 'decline') {
      await pool.query(`
        UPDATE ep_assignments 
        SET status = 'declined', declined_reason = $2 
        WHERE id = $1
      `, [assignment_id, reason || null]);

      // Log
      try {
        await pool.query(`INSERT INTO admin_logs (level, source, message, details) VALUES ('warn', 'counselor', $1, $2)`, [
          `${assignment.display_name} declined assignment for ${assignment.student_name}. Reason: ${reason || 'None given'}`,
          JSON.stringify({ assignment_id, counselor_id: assignment.counselor_id, student_id: assignment.student_id, reason }),
        ]);
      } catch {}

      // TODO: Send notification email to admin about declined assignment

      return NextResponse.json({ ok: true, status: 'declined' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[counselor/respond] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/counselor/respond
 * Returns pending assignments for the current counselor.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pool = getPool();
    // SECURITY: Respect the student's allow_counselor_access toggle.
    // Previously this query returned GPA, SAT, final_score, intended_major,
    // high_school_name, and graduation_year for every pending assignment
    // regardless of whether the student had enabled sharing.
    const { rows } = await pool.query(`
      SELECT a.id, a.student_id, a.plan, a.sessions_total, a.status, a.created_at,
             u_s.name AS student_name, u_s.email AS student_email,
             COALESCE(ss.allow_counselor_access, true) AS allow_counselor_access,
             p.gpa, p.sat, p.final_score,
             ss.intended_major, ss.high_school_name, ss.graduation_year
      FROM ep_assignments a
      JOIN users u_s ON u_s.id = a.student_id
      JOIN ep_counselors ec ON ec.id = a.counselor_id AND ec.user_id = $1
      LEFT JOIN profiles p ON p.user_id = a.student_id
      LEFT JOIN student_settings ss ON ss.user_id = a.student_id
      WHERE a.status = 'pending_acceptance'
      ORDER BY a.created_at DESC
    `, [parseInt(session.user.id)]);

    // Redact sensitive academic fields for students who have sharing disabled.
    const pending = rows.map(r => {
      if (r.allow_counselor_access === false) {
        return {
          id: r.id,
          student_id: r.student_id,
          plan: r.plan,
          sessions_total: r.sessions_total,
          status: r.status,
          created_at: r.created_at,
          student_name: r.student_name,
          student_email: r.student_email,
          allow_counselor_access: false,
          // Academic fields redacted
          gpa: null,
          sat: null,
          final_score: null,
          intended_major: null,
          high_school_name: null,
          graduation_year: null,
          sharing_restricted: true,
        };
      }
      return r;
    });

    return NextResponse.json({ pending });
  } catch (err: any) {
    console.error('[counselor/respond GET] Error:', err);
    return NextResponse.json({ pending: [] });
  }
}
