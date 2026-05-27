import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool } from '@/lib/db';
import { validatePassword } from '@/lib/auth-validation';


export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { action, email, password } = await request.json();
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const pool = getPool();

    if (action === 'check') {
      // SECURITY: Never reveal whether an account exists or is locked.
      // Previously the locked-account branch returned a distinct 403, which
      // leaked account state despite the comment claiming otherwise. Now we
      // always return ok — if the account exists and is not locked, the
      // email-verify 'send' step will dispatch the code; if not, the user
      // simply never receives one.
      return NextResponse.json({ ok: true });
    }

    if (action === 'reset') {
      if (!password) {
        return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
      }
      const pwCheck = validatePassword(password);
      if (!pwCheck.ok) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }

      // SECURITY: Atomically consume a verified RESET code for this email.
      // Previously we only checked (email, verified=true, created_at>NOW()-15m)
      // which meant any verified code — including one from a signup or
      // password-change flow — could be used to reset the password. We now
      // require purpose='reset' and mark the row consumed in the same UPDATE
      // so it can't be replayed.
      const consume = await pool.query(
        `UPDATE email_verification_codes
         SET consumed_at = NOW()
         WHERE id = (
           SELECT id FROM email_verification_codes
           WHERE email = $1
             AND purpose = 'reset'
             AND verified = true
             AND consumed_at IS NULL
             AND created_at > NOW() - INTERVAL '15 minutes'
           ORDER BY created_at DESC
           LIMIT 1
         )
         RETURNING id`,
        [cleanEmail]
      );
      if (consume.rows.length === 0) {
        return NextResponse.json({ error: 'Verification expired. Please start over.' }, { status: 400 });
      }

      // Update password
      const hashed = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `UPDATE users SET password=$1 WHERE email=$2 AND is_locked=false RETURNING id`,
        [hashed, cleanEmail]
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Account not found or is locked.' }, { status: 400 });
      }

      // Invalidate any remaining unconsumed reset codes for this email
      await pool.query(
        `UPDATE email_verification_codes SET consumed_at = NOW()
         WHERE email=$1 AND purpose='reset' AND consumed_at IS NULL`,
        [cleanEmail]
      );

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    console.error('[reset-password] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
