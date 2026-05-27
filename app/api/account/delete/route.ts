import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/account/delete
 * Soft-deletes the user account:
 * - Sets deleted_at timestamp and deletion_reason
 * - Marks user as locked (prevents login)
 * - Logs the action for admin visibility
 * 
 * Data is retained for 30 days, then permanently purged by admin or cron.
 * 
 * Body: { email: string, reason?: string }
 * The email must match the logged-in user's email (confirmation step).
 */
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = parseInt(session.user.id as string);
  if (isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
  }

  // Parse confirmation email from body
  let body: { email?: string; reason?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Verify the email matches
  const confirmEmail = (body.email || '').trim().toLowerCase();
  const userEmail = (session.user.email || '').trim().toLowerCase();
  if (confirmEmail !== userEmail) {
    return NextResponse.json({ error: 'Email does not match. Please type your exact email to confirm.' }, { status: 400 });
  }

  const pool = getPool();

  try {
    const reason = body.reason || 'User requested deletion';

    // Soft-delete: mark account as deleted + lock it
    await pool.query(
      `UPDATE users SET deleted_at = NOW(), deletion_reason = $1, is_locked = true WHERE id = $2`,
      [reason, userId]
    );

    // Log for admin visibility
    try {
      await pool.query(
        `INSERT INTO admin_logs (level, source, message, details) VALUES ('warn', 'account', $1, $2)`,
        [
          `Account deletion requested: ${session.user.name || userEmail}`,
          JSON.stringify({
            user_id: userId,
            email: userEmail,
            name: session.user.name,
            reason,
            deleted_at: new Date().toISOString(),
            purge_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        ]
      );
    } catch {}

    return NextResponse.json({
      ok: true,
      message: 'Account marked for deletion. Data will be permanently removed after 30 days.',
    });
  } catch (err) {
    console.error('[DELETE account] error:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
