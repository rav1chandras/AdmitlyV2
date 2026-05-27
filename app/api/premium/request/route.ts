/**
 * POST /api/premium/request
 *
 * Phase C — student submits a Premium Match request. Creates one row in
 * `premium_requests` (status pending_review) and notifies the admin.
 *
 * Body: { plan_id: number }
 *
 * Auth: any authenticated user (Pro tier check is enforced — see below).
 *
 * Conflict semantics: at most one active request per student. The DB has
 * a unique partial index on user_id WHERE status IN
 * ('pending_review','awaiting_payment'); a concurrent second submit will
 * surface as 409 Conflict here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool, getUserByEmail } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * GET /api/premium/request
 *
 * Returns one of three shapes for the student-facing /expert-sessions page:
 *
 *   { request: <PremiumRequest>, type: 'premium' }  — most recent
 *     premium_requests row, used to drive Reviewing / Pay Now / Paid
 *     screens.
 *
 *   { request: <SyntheticRecovery>, type: 'pro_recovery' }  — the
 *     student has a Pro Checkout failure with an admin-sent recovery
 *     invoice that hasn't been paid yet. Synthesized to look enough
 *     like a premium_request that the page's existing
 *     awaiting_payment screen can render it. The `type` field lets
 *     the UI swap to Pro-shaped copy.
 *
 *   { request: null }  — no in-flight Premium request, no pending Pro
 *     recovery; page falls through to plans (or upgrade gate).
 *
 * Premium takes precedence over Pro recovery: if the student has both,
 * the Premium flow is more important to surface.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ request: null });
  }
  try {
    const pool = getPool();

    // 1) Premium request (any status; most recent).
    const premiumRes = await pool.query(
      `SELECT id, plan_id, plan_name,
              amount_cents_quoted, amount_cents_invoiced,
              status, hosted_invoice_url,
              invoice_sent_at, invoice_expires_at, paid_at, created_at
         FROM premium_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [user.id],
    ).catch((err: any) => {
      if (err?.code === '42P01') return { rows: [] };
      throw err;
    });
    const premium = premiumRes.rows[0];

    // If the latest Premium request is in an actionable state, return it
    // — Premium always wins over a Pro recovery.
    if (premium && (premium.status === 'pending_review' || premium.status === 'awaiting_payment')) {
      return NextResponse.json({ request: premium, type: 'premium' });
    }

    // 2) Pro recovery — failed payment that admin has invoiced for
    //    recovery, where the recovery hasn't completed yet. We use the
    //    metadata stamped onto the failed payment row in the
    //    /api/admin/recoveries POST handler.
    const recoveryRes = await pool.query(
      `SELECT id, amount_cents,
              metadata->>'recovery_invoice_id'  AS recovery_invoice_id,
              metadata->>'recovery_invoice_url' AS recovery_invoice_url,
              metadata->>'recovery_amount_cents' AS recovery_amount_cents,
              metadata->>'recovery_sent_at'     AS recovery_sent_at,
              created_at
         FROM payments
        WHERE user_id = $1
          AND status = 'failed'
          AND metadata ? 'recovery_invoice_id'
          AND NOT (metadata ? 'recovery_completed_at')
        ORDER BY created_at DESC
        LIMIT 1`,
      [user.id],
    );
    const recovery = recoveryRes.rows[0];
    if (recovery) {
      const amount = parseInt(recovery.recovery_amount_cents || '0', 10) || recovery.amount_cents || 0;
      // Synthesize a request-shaped object so the page's awaiting_payment
      // branch can render it without further branching. id is namespaced
      // negative to avoid collision with real premium_requests.id values.
      return NextResponse.json({
        request: {
          id: -recovery.id,
          plan_id: null,
          plan_name: 'Admitly Pro',
          amount_cents_quoted: amount,
          amount_cents_invoiced: amount,
          status: 'awaiting_payment',
          hosted_invoice_url: recovery.recovery_invoice_url,
          invoice_sent_at: recovery.recovery_sent_at,
          invoice_expires_at: null,
          paid_at: null,
          created_at: recovery.created_at,
        },
        type: 'pro_recovery',
      });
    }

    // 3) Fall through to the most-recent premium_request even if it's
    //    not actionable — the page still uses it for context (e.g.
    //    showing "you previously had Full Cycle" copy).
    return NextResponse.json({ request: premium ?? null, type: 'premium' });
  } catch (err: any) {
    if (err?.code === '42P01') return NextResponse.json({ request: null });
    console.error('[premium/request] GET failed:', err);
    return NextResponse.json({ request: null });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Premium plans are gated on Pro: students must already be Pro to
  // request manual matching. Free users hit the upgrade screen first.
  if (user.subscription_status !== 'pro' && user.subscription_status !== 'premium') {
    return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 });
  }

  let payload: any;
  try { payload = await request.json(); } catch { payload = {}; }
  const planId = parseInt(payload.plan_id, 10);
  if (!Number.isFinite(planId) || planId <= 0) {
    return NextResponse.json({ error: 'Invalid plan_id' }, { status: 400 });
  }

  const pool = getPool();
  // Resolve the plan so we can record name + quoted amount as a snapshot
  // (admin can override the amount later, but the request's quoted price
  // freezes here so we have an audit of "what the student saw").
  const planRes = await pool.query(
    `SELECT id, name, COALESCE(discounted_price_cents, price_cents) AS price_cents
       FROM ep_plans WHERE id = $1 AND is_active = true LIMIT 1`,
    [planId],
  );
  if (planRes.rowCount === 0) {
    return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
  }
  const plan = planRes.rows[0];

  let requestId: number;
  try {
    const inserted = await pool.query(
      `INSERT INTO premium_requests
         (user_id, plan_id, plan_name, amount_cents_quoted, status)
       VALUES ($1, $2, $3, $4, 'pending_review')
       RETURNING id`,
      [user.id, plan.id, plan.name, plan.price_cents],
    );
    requestId = inserted.rows[0].id;
  } catch (err: any) {
    // Postgres 23505 = unique_violation — the partial index says the
    // student already has an active request.
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: 'You already have an active request. Cancel it before starting a new one.' },
        { status: 409 },
      );
    }
    console.error('[premium/request] insert failed:', err);
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
  }

  // Audit log — admin sees this in the existing logs feed.
  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium request — ${plan.name} from ${user.email}`,
        JSON.stringify({ request_id: requestId, user_id: user.id, plan_id: plan.id }),
      ],
    );
  } catch {}

  // Admin notification email. ADMIN_NOTIFY_EMAIL → SMTP_FROM →
  // POSTMARK_FROM_EMAIL fallback chain so the email always has somewhere
  // to land in any environment.
  const adminTo = process.env.ADMIN_NOTIFY_EMAIL
    || process.env.SMTP_FROM
    || process.env.POSTMARK_FROM_EMAIL;
  if (adminTo) {
    (sendEmail as any).adminNewPremiumRequest({
      to: adminTo,
      studentName: user.name || user.email,
      studentEmail: user.email,
      planName: plan.name,
      amount: `$${(plan.price_cents / 100).toFixed(0)}`,
      requestId,
    }).catch((e: any) => console.error('[premium/request] admin email failed:', e?.message));
  }

  return NextResponse.json({ ok: true, request_id: requestId });
}
