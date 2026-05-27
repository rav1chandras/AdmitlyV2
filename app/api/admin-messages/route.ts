import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin-messages — Fetch admin↔counselor messages for the current counselor
 * POST /api/admin-messages — Counselor sends a message to admin
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const role = (session.user as any)?.role;
    if (role !== 'counselor') return NextResponse.json({ error: 'Counselor only' }, { status: 403 });

    await ensureSchema();
    const pool = getPool();

    const res = await pool.query(
      `SELECT id, sender_role, body, is_read, created_at FROM admin_messages WHERE counselor_user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    // Mark admin messages as read (counselor is viewing them)
    await pool.query(
      `UPDATE admin_messages SET is_read = true WHERE counselor_user_id = $1 AND sender_role = 'admin' AND is_read = false`,
      [userId]
    );

    // Get unread count for badge
    const unreadRes = await pool.query(
      `SELECT COUNT(*)::int AS unread FROM admin_messages WHERE counselor_user_id = $1 AND sender_role = 'admin' AND is_read = false`,
      [userId]
    );

    return NextResponse.json({
      messages: res.rows,
      unread: unreadRes.rows[0]?.unread || 0,
    });
  } catch (err) {
    console.error('[admin-messages] GET error:', err);
    return NextResponse.json({ messages: [], unread: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const role = (session.user as any)?.role;
    if (role !== 'counselor') return NextResponse.json({ error: 'Counselor only' }, { status: 403 });

    const { message } = await request.json();
    if (!message?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

    await ensureSchema();
    const pool = getPool();

    const res = await pool.query(
      `INSERT INTO admin_messages (counselor_user_id, sender_role, body) VALUES ($1, 'counselor', $2) RETURNING *`,
      [userId, message.trim()]
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('[admin-messages] POST error:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
