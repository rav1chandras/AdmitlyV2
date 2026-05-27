/**
 * Admin Pro-payment Recoveries — gap fix for failed Pro payments.
 *
 *   GET  /api/admin/recoveries
 *        Lists recent failed payments + their student. Default window:
 *        last 30 days. Used by the Recoveries tab to show what needs
 *        admin attention.
 *
 *   POST /api/admin/recoveries
 *        Action: send_invoice
 *          { action:'send_invoice', payment_id, amount_cents? }
 *          → creates a Stripe invoice tagged
 *            metadata.recovery_type='pro' so the webhook handler
 *            can grant Pro on payment.
 *
 * Why no new table? A recovery attempt is just one Stripe invoice
 * sent on behalf of a known failed payment. We hang the metadata off
 * the existing invoice and don't introduce a separate
 * `pro_recoveries` table — keeps Phase D small.
 *
 * Auth: admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-helpers';
import { getPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const TIMER_HOURS = 72;

// ─── GET ──────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(180, Math.max(1, parseInt(searchParams.get('days') || '30', 10) || 30));

  try {
    const pool = getPool();
    // Two sources, merged and sorted client-side by failure timestamp.
    //
    // Pro source: payments rows where status='failed'. These are
    // self-serve Checkout failures; admin sends a recovery invoice via
    // POST send_invoice on this same route.
    //
    // Premium source: premium_requests rows where last_attempt_failed_at
    // IS NOT NULL — student tried to pay the hosted invoice and the card
    // declined. Admin can resend a fresh invoice via the existing
    // /api/admin/premium-requests POST resend_invoice action.
    const [proRes, premiumRes] = await Promise.all([
      pool.query(
        `SELECT p.id, p.user_id, p.amount_cents, p.plan_id, p.plan_name,
                p.stripe_payment_intent_id, p.metadata, p.created_at,
                u.name AS user_name, u.email AS user_email,
                u.subscription_status,
                EXISTS (
                  SELECT 1 FROM payments p2
                   WHERE p2.user_id = p.user_id
                     AND p2.status = 'succeeded'
                     AND p2.created_at > p.created_at
                ) AS already_recovered
           FROM payments p
           JOIN users u ON u.id = p.user_id
          WHERE p.status = 'failed'
            AND p.created_at >= NOW() - INTERVAL '${days} days'
          ORDER BY p.created_at DESC
          LIMIT 200`,
      ),
      pool.query(
        `SELECT pr.id, pr.user_id,
                COALESCE(pr.amount_cents_invoiced, pr.amount_cents_quoted) AS amount_cents,
                pr.plan_id, pr.plan_name,
                pr.status, pr.stripe_invoice_id, pr.hosted_invoice_url,
                pr.last_attempt_failed_at, pr.last_failure_reason,
                pr.attempt_count, pr.created_at, pr.updated_at,
                u.name AS user_name, u.email AS user_email,
                u.subscription_status
           FROM premium_requests pr
           JOIN users u ON u.id = pr.user_id
          WHERE pr.last_attempt_failed_at IS NOT NULL
            AND pr.last_attempt_failed_at >= NOW() - INTERVAL '${days} days'
          ORDER BY pr.last_attempt_failed_at DESC
          LIMIT 200`,
      ).catch(err => {
        // Tolerate missing column / table on older volumes — the
        // Recoveries tab still works, just shows Pro failures only.
        if (err?.code === '42P01' || err?.code === '42703') {
          console.warn('[admin/recoveries] Premium failure tracking missing — run migrations/008_premium_failure_tracking.sql');
          return { rows: [] };
        }
        throw err;
      }),
    ]);

    // Tag each row with `type` so the UI knows which action to render
    // and unify the shape so the table renders identically.
    const proRows = proRes.rows.map((r: any) => ({
      ...r,
      type: 'pro' as const,
      // Used as the sort key — failed payments don't have a separate
      // "failed at" timestamp; we use created_at as the proxy since
      // payment_intent.payment_failed updates the row in place.
      failed_at: r.created_at,
    }));
    const premiumRows = premiumRes.rows.map((r: any) => ({
      ...r,
      type: 'premium' as const,
      failed_at: r.last_attempt_failed_at,
      // For UI parity with Pro rows.
      stripe_payment_intent_id: null,
      already_recovered: r.status === 'paid', // a fresh payment for this same request wraps the failure
    }));
    const merged = [...proRows, ...premiumRows].sort((a, b) =>
      new Date(b.failed_at).getTime() - new Date(a.failed_at).getTime(),
    );

    return NextResponse.json({
      recoveries: merged,
      window_days: days,
    });
  } catch (err: any) {
    console.error('[admin/recoveries] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load recoveries' }, { status: 500 });
  }
}

// ─── POST send_invoice ────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  if (body.action !== 'send_invoice') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  const paymentId = parseInt(body.payment_id, 10);
  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    return NextResponse.json({ error: 'Invalid payment_id' }, { status: 400 });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.user_id, p.amount_cents, p.plan_id, p.plan_name,
            u.email AS user_email, u.name AS user_name,
            u.stripe_customer_id
       FROM payments p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 LIMIT 1`,
    [paymentId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  const failed = rows[0];

  // Default to the original failed amount; admin can override (e.g. to
  // apply a courtesy discount).
  const amountCents = body.amount_cents != null
    ? Math.max(100, parseInt(body.amount_cents, 10) || failed.amount_cents)
    : failed.amount_cents;
  if (!amountCents || amountCents < 100) {
    return NextResponse.json({ error: 'Amount must be at least $1' }, { status: 400 });
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

  let invoice: any;
  try {
    // Reuse or create a customer (same pattern as Phase C; tolerates
    // stale ids from cleared test data).
    let customerId: string | null = failed.stripe_customer_id;
    if (customerId) {
      try {
        const cached: any = await stripe.customers.retrieve(customerId);
        if (cached?.deleted) customerId = null;
      } catch (err: any) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404) {
          customerId = null;
        } else {
          throw err;
        }
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: failed.user_email,
        name:  failed.user_name || undefined,
        metadata: { user_id: String(failed.user_id) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, failed.user_id],
      );
    }

    invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 3,
      auto_advance: false,
      description: `Admitly Pro — recovery for payment #${failed.id}`,
      metadata: {
        // Webhook handler branches on this — see processInvoicePaid in
        // app/api/webhooks/stripe/route.ts.
        recovery_type: 'pro',
        recovery_for_payment_id: String(failed.id),
        user_id: String(failed.user_id),
        plan_id: failed.plan_id || 'pro',
        plan_name: failed.plan_name || 'Admitly Pro',
      },
    });

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountCents,
      currency: 'usd',
      description: `Admitly Pro — replacement for failed payment`,
    });

    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    invoice = await stripe.invoices.sendInvoice(invoice.id);
  } catch (err: any) {
    console.error('[admin/recoveries] sendInvoice Stripe failed:', err);
    return NextResponse.json(
      { error: `Stripe invoice failed: ${err?.message ?? 'unknown'}` },
      { status: 502 },
    );
  }

  // Stash the recovery invoice id on the failed payments row so the
  // Recoveries tab can show "invoice sent" state without a new table.
  await pool.query(
    `UPDATE payments SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                         updated_at = NOW()
      WHERE id = $1`,
    [
      failed.id,
      JSON.stringify({
        recovery_invoice_id: invoice.id,
        recovery_invoice_url: invoice.hosted_invoice_url,
        recovery_sent_at: new Date().toISOString(),
        recovery_amount_cents: amountCents,
      }),
    ],
  );

  await pool.query(
    `INSERT INTO admin_logs (level, source, message, details)
     VALUES ('info', 'stripe', $1, $2)`,
    [
      `Pro recovery invoice sent — payment ${failed.id} ($${(amountCents/100).toFixed(2)})`,
      JSON.stringify({ payment_id: failed.id, invoice_id: invoice.id, amount_cents: amountCents }),
    ],
  ).catch(() => {});

  // Branded email to the student. Reuses the Phase C "premiumInvoiceSent"
  // copy because it's the right shape (here's a payment link, expires
  // in N hours) — labelled neutrally so it works for both Pro recovery
  // and Premium.
  if (failed.user_email) {
    (sendEmail as any).premiumInvoiceSent({
      to: failed.user_email,
      name: failed.user_name || 'there',
      planName: failed.plan_name || 'Admitly Pro',
      amount: `$${(amountCents/100).toFixed(2)}`,
      expiresInHours: TIMER_HOURS,
    }).catch((e: any) => console.error('[admin/recoveries] student email failed:', e?.message));
  }

  return NextResponse.json({
    ok: true,
    invoice_id: invoice.id,
    hosted_invoice_url: invoice.hosted_invoice_url,
  });
}
