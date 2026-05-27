import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { sendEmail } from '@/lib/email';
import { validatePassword } from '@/lib/auth-validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const pool = getPool();
    const userId = parseInt(session.user.id);
    const { action, current_password, new_password } = await request.json();

    // Step 1: Verify current password (called before sending code)
    if (action === 'verify_current') {
      if (!current_password) {
        return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
      }

      const { rows } = await pool.query('SELECT password, auth_provider FROM users WHERE id=$1', [userId]);
      if (!rows[0]) {
        return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
      }
      if (rows[0].auth_provider === 'google') {
        return NextResponse.json({ error: 'Your account uses Google sign-in. Password is managed by Google.' }, { status: 400 });
      }

      const valid = await bcrypt.compare(current_password, rows[0].password);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 });
      }

      return NextResponse.json({ ok: true });
    }

    // Step 2: Change password (called after code is verified)
    if (!current_password || !new_password) {
      return NextResponse.json({ error: 'Both current and new passwords are required.' }, { status: 400 });
    }
    const pwCheck = validatePassword(new_password);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Verify current password again
    const { rows } = await pool.query('SELECT password, auth_provider, name, email FROM users WHERE id=$1', [userId]);
    if (!rows[0]) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }
    if (rows[0].auth_provider === 'google') {
      return NextResponse.json({ error: 'Your account uses Google sign-in.' }, { status: 400 });
    }

    const valid = await bcrypt.compare(current_password, rows[0].password);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 });
    }

    // SECURITY: Atomically consume a verified PASSWORD_CHANGE code.
    // Previously any verified code for this email could authorize a change.
    const consume = await pool.query(
      `UPDATE email_verification_codes
       SET consumed_at = NOW()
       WHERE id = (
         SELECT id FROM email_verification_codes
         WHERE email = $1
           AND purpose = 'password_change'
           AND verified = true
           AND consumed_at IS NULL
           AND created_at > NOW() - INTERVAL '15 minutes'
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING id`,
      [session.user.email.toLowerCase()]
    );
    if (consume.rows.length === 0) {
      return NextResponse.json({ error: 'Verification expired. Please try again.' }, { status: 400 });
    }

    // Update password
    const hashed = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, userId]);

    // Invalidate any remaining unconsumed change codes
    await pool.query(
      `UPDATE email_verification_codes SET consumed_at = NOW()
       WHERE email=$1 AND purpose='password_change' AND consumed_at IS NULL`,
      [session.user.email.toLowerCase()]
    );

    // Send confirmation email
    try {
      sendEmail.passwordChanged({
        to: rows[0].email,
        name: rows[0].name || 'User',
      }).catch(() => { });
    } catch { }

    // Log
    try {
      await pool.query(
        `INSERT INTO admin_logs (level, source, message, details) VALUES ('info', 'security', $1, $2)`,
        [`Password changed for ${rows[0].email}`, JSON.stringify({ user_id: userId })]
      );
    } catch { }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[change-password] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
