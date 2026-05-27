/**
 * POST /api/cron/premium-timers
 *
 * Phase C — runs every 15 min (recommended). Two passes:
 *
 *   1. 48h reminder — for requests still awaiting_payment, where
 *      reminder_sent_at IS NULL and the invoice has ≤24h before it
 *      auto-voids. Sends one branded email per request and stamps
 *      reminder_sent_at so re-runs are no-ops.
 *
 *   2. 72h auto-void — for requests still awaiting_payment whose
 *      invoice_expires_at is in the past. Voids the Stripe invoice and
 *      flips status to 'expired'.
 *
 * Auth: bearer-token CRON_SECRET. Falls back to ?token= so it's easy to
 * curl manually for testing. Refuses to run if CRON_SECRET is unset (we
 * don't want this fire-and-forget endpoint open to the internet).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const REMINDER_THRESHOLD_HOURS = 48; // i.e. send when ≤24h remaining of a 72h timer

function checkAuth(request: NextRequest): { ok: true } | { ok: false; reason: string; status: number } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, reason: 'CRON_SECRET not configured — refusing to run', status: 503 };
  }
  const authHeader = request.headers.get('authorization') || '';
  const fromHeader = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  const fromQuery = new URL(request.url).searchParams.get('token') || '';
  const provided = fromHeader || fromQuery;
  if (!provided || provided !== secret) {
    return { ok: false, reason: 'Invalid token', status: 401 };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const pool = getPool();
  const errors: string[] = [];
  let remindersSent = 0;
  let voided = 0;

  // ── Pass 1: 48h reminders ─────────────────────────────────────────────
  // We send when ≤(72−48)=24h remaining: invoice_expires_at − NOW() <= 24h
  // AND > 0 (don't send a reminder for already-expired ones; pass 2 voids
  // those instead).
  try {
    const due = await pool.query(`
      SELECT pr.id, pr.user_id, pr.plan_name, pr.amount_cents_invoiced,
             pr.invoice_expires_at,
             u.name AS student_name, u.email AS student_email
        FROM premium_requests pr
        JOIN users u ON u.id = pr.user_id
       WHERE pr.status = 'awaiting_payment'
         AND pr.reminder_sent_at IS NULL
         AND pr.invoice_expires_at IS NOT NULL
         AND pr.invoice_expires_at > NOW()
         AND pr.invoice_expires_at <= NOW() + INTERVAL '24 hours'
    `);

    for (const row of due.rows) {
      try {
        const hoursRemaining = Math.max(
          1,
          Math.round((new Date(row.invoice_expires_at).getTime() - Date.now()) / 3600_000),
        );
        await (sendEmail as any).premiumInvoiceReminder({
          to: row.student_email,
          name: row.student_name || 'there',
          planName: row.plan_name,
          amount: `$${((row.amount_cents_invoiced || 0) / 100).toFixed(2)}`,
          hoursRemaining,
        });
        // Stamp reminder_sent_at so we don't send again on the next cron tick.
        await pool.query(
          `UPDATE premium_requests
              SET reminder_sent_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [row.id],
        );
        remindersSent++;
      } catch (e: any) {
        errors.push(`reminder ${row.id}: ${e?.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`reminders pass: ${e?.message}`);
  }

  // ── Pass 2: 72h auto-void ─────────────────────────────────────────────
  // Anything still awaiting_payment whose timer has elapsed gets voided
  // both at Stripe and on our row.
  try {
    const expired = await pool.query(`
      SELECT id, stripe_invoice_id
        FROM premium_requests
       WHERE status = 'awaiting_payment'
         AND invoice_expires_at IS NOT NULL
         AND invoice_expires_at <= NOW()
    `);

    if (expired.rowCount && expired.rowCount > 0) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

      for (const row of expired.rows) {
        if (row.stripe_invoice_id) {
          try {
            await stripe.invoices.voidInvoice(row.stripe_invoice_id);
          } catch (e: any) {
            // Stripe error doesn't block the status flip — webhook
            // (invoice.voided) will reconcile if Stripe processed it
            // anyway, and admin can clean up if not.
            errors.push(`stripe void ${row.id}: ${e?.message}`);
          }
        }
        try {
          await pool.query(
            `UPDATE premium_requests
                SET status = 'expired', updated_at = NOW()
              WHERE id = $1`,
            [row.id],
          );
          voided++;
        } catch (e: any) {
          errors.push(`status flip ${row.id}: ${e?.message}`);
        }
      }
    }
  } catch (e: any) {
    if (e?.code === '42P01') {
      // Table missing — probably migration not applied. Don't fail the route.
      errors.push('premium_requests table missing — run migrations/007_premium_requests.sql');
    } else {
      errors.push(`void pass: ${e?.message}`);
    }
  }

  return NextResponse.json({
    reminders_sent: remindersSent,
    voided,
    errors,
    threshold_hours: REMINDER_THRESHOLD_HOURS,
  });
}
