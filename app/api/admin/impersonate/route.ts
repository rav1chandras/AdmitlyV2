/**
 * /api/admin/impersonate — Admin-only: sign in as any student for testing.
 *
 * How it works:
 *   1. Admin POSTs { student_id }
 *   2. We verify caller is admin
 *   3. We look up the target user
 *   4. We call signIn with a special one-time token stored server-side
 *      — but since NextAuth credentials need a password, we use a temporary
 *        token approach: store a short-lived impersonation token in DB,
 *        then call signIn with that token as the password.
 *
 * Simpler approach used here: update a temp_impersonate_token column,
 * then trigger signIn client-side with that token. The authorize function
 * accepts it and clears it immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';
import { isAdmin } from '@/lib/auth-helpers';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // SECURITY: Use shared isAdmin() which checks both role='admin' and
    // ADMIN_EMAILS env var. Previously this route only checked the env var,
    // so a DB-only admin couldn't impersonate.
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { student_id } = await req.json();
    const targetId = parseInt(String(student_id));
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return NextResponse.json({ error: 'student_id required' }, { status: 400 });
    }

    await ensureSchema();
    const pool = getPool();

    // Ensure impersonation token column exists
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS impersonate_token VARCHAR(64)`).catch(()=>{});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS impersonate_expires_at TIMESTAMP`).catch(()=>{});

    // Fetch target user
    const { rows } = await pool.query('SELECT id, email, role FROM users WHERE id=$1', [targetId]);
    if (!rows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // SECURITY: Refuse to impersonate other admins — prevents an admin whose
    // account is compromised from pivoting to every other admin via this
    // endpoint. Admins should still be able to impersonate students/counselors.
    if (rows[0].role === 'admin') {
      return NextResponse.json({ error: 'Cannot impersonate another admin' }, { status: 403 });
    }

    // Generate a short-lived token (60 seconds)
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `UPDATE users SET impersonate_token=$1, impersonate_expires_at=NOW() + INTERVAL '60 seconds' WHERE id=$2`,
      [token, targetId]
    );

    // SECURITY: Audit log every impersonation start so admin activity is
    // traceable. Previously there was no server-side record of who
    // impersonated whom.
    try {
      await pool.query(
        `INSERT INTO admin_logs (level, source, message, details) VALUES ('warn', 'impersonate', $1, $2)`,
        [
          `Admin ${session.user.email} started impersonating user ${rows[0].email}`,
          JSON.stringify({
            admin_id: session.user.id,
            admin_email: session.user.email,
            target_id: targetId,
            target_email: rows[0].email,
            target_role: rows[0].role,
            started_at: new Date().toISOString(),
          }),
        ]
      );
    } catch {}

    return NextResponse.json({
      ok: true,
      email: rows[0].email,
      token,
    });
  } catch (err) {
    console.error('[impersonate] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
