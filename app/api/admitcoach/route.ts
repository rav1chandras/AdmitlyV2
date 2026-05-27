import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admitcoach
 * Returns { assignment: {...} } if the current user has an active expert session,
 * or { assignment: null } if not. Used by the sidebar to check premium status
 * and by the admitcoach page to gate access.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ assignment: null });
    const userId = parseInt(session.user.id);
    const role = (session.user as any)?.role;

    // Counselors and admins always have access
    if (role === 'counselor' || role === 'admin') {
      return NextResponse.json({ assignment: { id: 0, plan: 'Admin', status: 'active' } });
    }

    const pool = getPool();
    const res = await pool.query(
      `SELECT id, plan, status, sessions_total, sessions_used
       FROM ep_assignments
       WHERE student_id = $1 AND status NOT IN ('cancelled','switched')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      assignment: res.rows[0] || null,
    });
  } catch {
    return NextResponse.json({ assignment: null });
  }
}
