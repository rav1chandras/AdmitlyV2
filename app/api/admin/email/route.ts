/**
 * Admin "Compose Email" — Phase A
 *
 *   POST /api/admin/email
 *     body: { recipient_type, to?, subject, body }
 *     - recipient_type: 'individual' | 'all_students' | 'all_counselors'
 *     - to: required when recipient_type === 'individual'
 *     - sends one email per resolved recipient via lib/email.ts
 *     - inserts one row per send into sent_emails (success | error)
 *     - returns { sent, failed, total }
 *
 *   GET /api/admin/email?limit=25
 *     - returns recent audit rows for display in the admin Emails tab
 *
 * Auth: admin only (isAdmin) — same gate as the rest of /api/admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-helpers';
import { getPool } from '@/lib/db';
import { sendCustomEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

type RecipientType = 'individual' | 'all_students' | 'all_counselors';

const VALID_TYPES = new Set<RecipientType>(['individual', 'all_students', 'all_counselors']);

/** Render plain-text composer body to safe HTML (preserve paragraphs/newlines). */
function plainToHtml(text: string): string {
  // Minimal HTML escaping — no user-supplied HTML is rendered, just text.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Collapse Windows newlines, then convert blank lines → paragraphs and
  // single newlines → <br>. lib/email's wrap() places this inside a styled
  // container, so we only need inline content here.
  const paragraphs = escaped.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="font-size:15px;color:#1c1917;line-height:1.6;margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function resolveRecipients(
  type: RecipientType,
  individualTo: string | null,
): Promise<string[]> {
  if (type === 'individual') {
    return individualTo ? [individualTo] : [];
  }
  const pool = getPool();
  const role = type === 'all_students' ? 'student' : 'counselor';
  const result = await pool.query(
    `SELECT email FROM users WHERE role = $1 AND COALESCE(is_locked, false) = false`,
    [role],
  );
  return result.rows.map(r => r.email).filter((e: unknown): e is string => typeof e === 'string' && e.length > 0);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const recipient_type: RecipientType = payload.recipient_type;
  const to: string | null = typeof payload.to === 'string' ? payload.to.trim() : null;
  const subject: string = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const body: string = typeof payload.body === 'string' ? payload.body : '';

  if (!VALID_TYPES.has(recipient_type)) {
    return NextResponse.json({ error: 'Invalid recipient_type' }, { status: 400 });
  }
  if (!subject || !body.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }
  if (recipient_type === 'individual' && !to) {
    return NextResponse.json({ error: 'Recipient email required for individual send' }, { status: 400 });
  }

  const recipients = await resolveRecipients(recipient_type, to);
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No matching recipients' }, { status: 400 });
  }

  const html = plainToHtml(body);
  const pool = getPool();
  const senderEmail = (session.user.email as string).toLowerCase();
  // Look up sender id once (best-effort — audit log still works if missing).
  let senderId: number | null = null;
  try {
    const r = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [senderEmail]);
    senderId = r.rows[0]?.id ?? null;
  } catch (e) {
    console.warn('[admin/email] failed to look up sender id:', e);
  }

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    let ok = false;
    let errMsg: string | null = null;
    try {
      ok = await sendCustomEmail(recipient, subject, html);
      if (!ok) errMsg = 'Postmark not configured or returned failure';
    } catch (err: any) {
      ok = false;
      errMsg = err?.message ?? 'Unknown send error';
    }
    if (ok) sent++;
    else failed++;

    // Audit row — never fail the whole request because of an audit insert.
    try {
      await pool.query(
        `INSERT INTO sent_emails
           (sender_user_id, sender_email, recipient_type, recipient_email, subject, body, success, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [senderId, senderEmail, recipient_type, recipient, subject, body, ok, errMsg],
      );
    } catch (auditErr) {
      console.error('[admin/email] audit insert failed:', auditErr);
    }
  }

  return NextResponse.json({ sent, failed, total: recipients.length });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = parseInt(searchParams.get('limit') ?? '25', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 25;

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, sender_email, recipient_type, recipient_email, subject,
              success, error, sent_at
         FROM sent_emails
         ORDER BY sent_at DESC
         LIMIT $1`,
      [limit],
    );
    return NextResponse.json({ emails: result.rows });
  } catch (err: any) {
    // If the table doesn't exist yet (migration not run), return empty
    // instead of 500 so the UI degrades gracefully.
    if (err?.code === '42P01') {
      return NextResponse.json({ emails: [], warning: 'sent_emails table missing — run migrations/005_admin_phase_a.sql' });
    }
    console.error('[admin/email] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 });
  }
}
