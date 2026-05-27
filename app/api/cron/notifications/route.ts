/**
 * /api/cron/notifications — Process batched notification queue
 * 
 * Runs every 15 minutes (via Vercel Cron or external cron).
 * Groups unsent notifications by user, then sends a single digest email per user.
 * 
 * Vercel cron config in vercel.json:
 *   { "crons": [{ "path": "/api/cron/notifications", "schedule": "every 15 minutes" }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // SECURITY: CRON_SECRET is mandatory. Previously `if (cronSecret && ...)`
  // meant that if the env var was unset, anyone on the internet could hit
  // this endpoint, drain the notification queue, and spam emails.
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/notifications] CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getPool();
  let processed = 0;

  try {
    // Fetch all unsent notifications
    const { rows: unsent } = await pool.query(
      `SELECT nq.id, nq.user_id, nq.type, nq.data, nq.created_at,
              u.email, u.name, u.role
       FROM notification_queue nq
       JOIN users u ON u.id = nq.user_id
       WHERE nq.sent_at IS NULL
       ORDER BY nq.user_id, nq.created_at`
    );

    if (unsent.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: 'No pending notifications' });
    }

    // Group by user_id
    const byUser: Record<number, typeof unsent> = {};
    for (const row of unsent) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      byUser[row.user_id].push(row);
    }

    // Process each user's notifications
    for (const [userIdStr, notifications] of Object.entries(byUser)) {
      const userId = parseInt(userIdStr);
      const user = notifications[0];
      const isStudent = user.role === 'student' || user.role === 'free';

      // Determine sender name(s) from notification data
      const senderNames = new Set<string>();
      const items: { type: string; text: string; time?: string }[] = [];

      for (const n of notifications) {
        const d = typeof n.data === 'string' ? JSON.parse(n.data) : n.data;
        const sName = d.sender_name || d.counselor_name || d.assigned_by || 'Admitly';
        senderNames.add(sName);

        if (n.type === 'message') {
          const time = new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          items.push({ type: 'message', text: d.preview || '', time });
        } else if (n.type === 'action') {
          items.push({ type: 'action', text: `${d.text}${d.due_date ? ` (due ${d.due_date})` : ''}` });
        } else if (n.type === 'session_booked') {
          items.push({ type: 'session_booked', text: `${d.date} at ${d.time} — ${d.topic}` });
        } else if (n.type === 'session_completed') {
          items.push({ type: 'session_completed', text: `${d.topic} — ${d.date}` });
        }
      }

      if (items.length === 0) continue;

      try {
        if (isStudent || senderNames.size === 1) {
          // Student receiving from counselor, or single-sender scenario
          const senderName = Array.from(senderNames)[0] || 'Your Counselor';
          await sendEmail.digest({
            to: user.email,
            recipientName: user.name,
            senderName,
            count: items.length,
            items,
          });
        } else {
          // Counselor receiving from multiple students — group by student
          // For now, use single digest (multi-student grouping requires assignment lookups)
          const senderName = senderNames.size === 1
            ? Array.from(senderNames)[0]
            : `${senderNames.size} students`;
          await sendEmail.digest({
            to: user.email,
            recipientName: user.name,
            senderName,
            count: items.length,
            items,
          });
        }

        // Mark all as sent
        const ids = notifications.map(n => n.id);
        await pool.query(
          `UPDATE notification_queue SET sent_at = NOW() WHERE id = ANY($1)`,
          [ids]
        );
        processed += notifications.length;
      } catch (err) {
        console.error(`[cron/notifications] Failed to send digest for user ${userId}:`, err);
      }
    }

    // Cleanup: delete sent notifications older than 7 days
    await pool.query(`DELETE FROM notification_queue WHERE sent_at IS NOT NULL AND sent_at < NOW() - INTERVAL '7 days'`).catch(() => {});

    return NextResponse.json({ ok: true, processed, users: Object.keys(byUser).length });
  } catch (err: any) {
    console.error('[cron/notifications] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
