/**
 * Admin Premium Requests — Phase C.
 *
 *   GET  /api/admin/premium-requests?filter=active|all|paid|cancelled
 *        Returns the list with student/counselor enrichment.
 *
 *   POST /api/admin/premium-requests
 *        Actions:
 *          { action: 'send_invoice', request_id, counselor_user_id?, amount_cents? }
 *            → creates Stripe invoice, finalizes, sends, sets
 *              status='awaiting_payment', invoice_expires_at = NOW() + 72h
 *          { action: 'reject', request_id, reason }
 *            → status='rejected', emails student
 *          { action: 'void', request_id }
 *            → voids Stripe invoice, status='voided'
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

// Reusable join: returns request rows enriched with student + counselor
// names so the admin UI doesn't need a second round trip.
const ENRICH_SELECT = `
  SELECT pr.id, pr.user_id, pr.plan_id, pr.plan_name,
         pr.amount_cents_quoted, pr.amount_cents_invoiced,
         pr.counselor_user_id, pr.status, pr.rejection_reason,
         pr.stripe_invoice_id, pr.hosted_invoice_url,
         pr.invoice_sent_at, pr.invoice_expires_at,
         pr.reminder_sent_at, pr.paid_at,
         pr.created_at, pr.updated_at,
         su.name AS student_name, su.email AS student_email,
         cu.name AS counselor_name, cu.email AS counselor_email
    FROM premium_requests pr
    LEFT JOIN users su ON su.id = pr.user_id
    LEFT JOIN users cu ON cu.id = pr.counselor_user_id
`;

// ─── GET ──────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'active';

  const where = ((): string => {
    switch (filter) {
      case 'active':    return `WHERE pr.status IN ('pending_review','awaiting_payment')`;
      case 'paid':      return `WHERE pr.status = 'paid'`;
      case 'cancelled': return `WHERE pr.status IN ('cancelled_by_student','rejected','voided','expired')`;
      case 'all':       return ``;
      default:          return `WHERE pr.status IN ('pending_review','awaiting_payment')`;
    }
  })();

  try {
    const pool = getPool();
    const result = await pool.query(`${ENRICH_SELECT} ${where} ORDER BY pr.created_at DESC LIMIT 200`);
    return NextResponse.json({ requests: result.rows, filter });
  } catch (err: any) {
    if (err?.code === '42P01') {
      return NextResponse.json({ requests: [], filter, warning: 'premium_requests table missing — run migrations/007_premium_requests.sql' });
    }
    console.error('[admin/premium-requests] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  }
}

// ─── POST: send_invoice / reject / void ──────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const action: string = body.action;
  const requestId = parseInt(body.request_id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `${ENRICH_SELECT} WHERE pr.id = $1 LIMIT 1`,
    [requestId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const req = rows[0];

  if (action === 'send_invoice') {
    return await sendInvoice(pool, req, body);
  }
  if (action === 'resend_invoice') {
    return await resendInvoice(pool, req, body);
  }
  if (action === 'reject') {
    return await rejectRequest(pool, req, body);
  }
  if (action === 'void') {
    return await voidRequest(pool, req);
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ─── Action: send_invoice ─────────────────────────────────────────────────
async function sendInvoice(pool: ReturnType<typeof getPool>, req: any, body: any) {
  if (req.status !== 'pending_review') {
    return NextResponse.json(
      { error: `Cannot send invoice — request is ${req.status}` },
      { status: 409 },
    );
  }
  if (!req.student_email) {
    return NextResponse.json({ error: 'Student email missing' }, { status: 400 });
  }

  const counselorUserId = body.counselor_user_id != null
    ? parseInt(body.counselor_user_id, 10) || null
    : null;
  // Default to the student's quoted price; admin can override before send.
  const amountCents = body.amount_cents != null
    ? Math.max(100, parseInt(body.amount_cents, 10) || req.amount_cents_quoted)
    : req.amount_cents_quoted;

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

  let invoice: any;
  let invoiceItem: any;
  try {
    // Make sure we have a customer to bill. Reuse a stripe_customer_id on
    // the user if present; otherwise create one.
    const userRes = await pool.query(
      `SELECT id, name, email, stripe_customer_id FROM users WHERE id = $1 LIMIT 1`,
      [req.user_id],
    );
    if (userRes.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }
    let customerId: string | null = userRes.rows[0].stripe_customer_id;
    // Verify the cached customer id is still valid in the *current* Stripe
    // account. Stale ids happen routinely in test mode (data wipes, API
    // key rotation, switching between test/live), and they bomb the whole
    // invoice flow with "No such customer". Retrieve first; on
    // `resource_missing`, fall through to create a fresh one.
    if (customerId) {
      try {
        const cached: any = await stripe.customers.retrieve(customerId);
        if (cached?.deleted) {
          customerId = null;
        }
      } catch (err: any) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404) {
          console.warn(`[admin/premium-requests] stale stripe_customer_id ${customerId}, recreating`);
          customerId = null;
        } else {
          throw err;
        }
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userRes.rows[0].email,
        name:  userRes.rows[0].name || undefined,
        metadata: { user_id: String(userRes.rows[0].id) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, req.user_id],
      );
    }

    // Order matters: create invoice first (with collection_method=send),
    // then add the item with `invoice` set so it lands on this invoice
    // rather than auto-billed on the customer's next invoice.
    invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 3,
      auto_advance: false,
      description: `Admitly Premium — ${req.plan_name}`,
      metadata: {
        premium_request_id: String(req.id),
        plan_id: req.plan_id != null ? String(req.plan_id) : '',
        plan_name: req.plan_name,
        user_id: String(req.user_id),
        counselor_user_id: counselorUserId != null ? String(counselorUserId) : '',
      },
    });

    invoiceItem = await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountCents,
      currency: 'usd',
      description: `${req.plan_name} — Premium counselor sessions`,
    });

    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    invoice = await stripe.invoices.sendInvoice(invoice.id);
  } catch (err: any) {
    console.error('[admin/premium-requests] sendInvoice Stripe failed:', err);
    return NextResponse.json(
      { error: `Stripe invoice failed: ${err?.message ?? 'unknown'}` },
      { status: 502 },
    );
  }

  // Persist the invoice id, hosted url, and start the 72h timer.
  await pool.query(
    `UPDATE premium_requests SET
       status                = 'awaiting_payment',
       counselor_user_id     = $2,
       amount_cents_invoiced = $3,
       stripe_invoice_id     = $4,
       stripe_invoice_item_id = $5,
       hosted_invoice_url    = $6,
       invoice_sent_at       = NOW(),
       invoice_expires_at    = NOW() + INTERVAL '${TIMER_HOURS} hours',
       reminder_sent_at      = NULL,
       updated_at            = NOW()
     WHERE id = $1`,
    [
      req.id,
      counselorUserId,
      amountCents,
      invoice.id,
      invoiceItem.id,
      invoice.hosted_invoice_url || null,
    ],
  );

  // Audit
  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium invoice sent — request ${req.id} ($${(amountCents/100).toFixed(2)})`,
        JSON.stringify({ request_id: req.id, invoice_id: invoice.id, amount_cents: amountCents, counselor_user_id: counselorUserId }),
      ],
    );
  } catch {}

  // Branded student email (Stripe also sends a hosted-invoice email; ours
  // owns the call to action — both link to the same payment).
  (sendEmail as any).premiumInvoiceSent({
    to: req.student_email,
    name: req.student_name || 'there',
    planName: req.plan_name,
    amount: `$${(amountCents/100).toFixed(2)}`,
    expiresInHours: TIMER_HOURS,
  }).catch((e: any) => console.error('[admin/premium-requests] student email failed:', e?.message));

  return NextResponse.json({ ok: true, hosted_invoice_url: invoice.hosted_invoice_url });
}

// ─── Action: resend_invoice ──────────────────────────────────────────────
// Phase D — when a Premium hosted-invoice payment fails (card declined,
// expired, blocked by issuer), admin can void the live invoice and send
// a fresh one. Same plan/counselor/amount; resets the 72h timer, clears
// the reminder + failure flags, re-emails the student. The Recoveries
// tab calls this for Premium rows.
async function resendInvoice(pool: ReturnType<typeof getPool>, req: any, body: any) {
  if (req.status !== 'awaiting_payment') {
    return NextResponse.json(
      { error: `Cannot resend — request is ${req.status}` },
      { status: 409 },
    );
  }
  if (!req.student_email) {
    return NextResponse.json({ error: 'Student email missing' }, { status: 400 });
  }

  const counselorUserId = req.counselor_user_id ?? null;
  const amountCents = body.amount_cents != null
    ? Math.max(100, parseInt(body.amount_cents, 10) || req.amount_cents_invoiced || req.amount_cents_quoted)
    : (req.amount_cents_invoiced || req.amount_cents_quoted);

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

  // Void the existing invoice. Tolerate Stripe errors — if it's already
  // void or already paid we still want to roll forward with a fresh one;
  // the new finalize/send will fail loudly if something deeper is wrong.
  if (req.stripe_invoice_id) {
    try {
      await stripe.invoices.voidInvoice(req.stripe_invoice_id);
    } catch (e: any) {
      console.warn('[admin/premium-requests] resend voidInvoice failed (continuing):', e?.message);
    }
  }

  let invoice: any;
  let invoiceItem: any;
  try {
    // Resolve customer (same Phase C logic — handles stale ids).
    const userRes = await pool.query(
      `SELECT id, name, email, stripe_customer_id FROM users WHERE id = $1 LIMIT 1`,
      [req.user_id],
    );
    if (userRes.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }
    let customerId: string | null = userRes.rows[0].stripe_customer_id;
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
        email: userRes.rows[0].email,
        name:  userRes.rows[0].name || undefined,
        metadata: { user_id: String(userRes.rows[0].id) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, req.user_id],
      );
    }

    invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 3,
      auto_advance: false,
      description: `Admitly Premium — ${req.plan_name} (resend)`,
      metadata: {
        premium_request_id: String(req.id),
        plan_id: req.plan_id != null ? String(req.plan_id) : '',
        plan_name: req.plan_name,
        user_id: String(req.user_id),
        counselor_user_id: counselorUserId != null ? String(counselorUserId) : '',
        is_resend: 'true',
      },
    });

    invoiceItem = await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountCents,
      currency: 'usd',
      description: `${req.plan_name} — Premium counselor sessions`,
    });

    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    invoice = await stripe.invoices.sendInvoice(invoice.id);
  } catch (err: any) {
    console.error('[admin/premium-requests] resendInvoice Stripe failed:', err);
    return NextResponse.json(
      { error: `Stripe invoice failed: ${err?.message ?? 'unknown'}` },
      { status: 502 },
    );
  }

  // Refresh the request row: new invoice id + URL, fresh 72h timer,
  // clear reminder + failure flags so the cycle starts clean.
  //
  // We explicitly write status='awaiting_payment' to defeat a webhook
  // race: voiding the old invoice (above) fires invoice.voided
  // asynchronously; that handler updates premium_requests.status to
  // 'voided' WHERE stripe_invoice_id = OLD AND status = 'awaiting_payment'.
  // If that handler runs *before* the UPDATE below, status would be
  // 'voided' and our UPDATE wouldn't touch it. Including it here makes
  // the final state correct regardless of webhook arrival order.
  await pool.query(
    `UPDATE premium_requests SET
       status                 = 'awaiting_payment',
       stripe_invoice_id      = $2,
       stripe_invoice_item_id = $3,
       hosted_invoice_url     = $4,
       amount_cents_invoiced  = $5,
       invoice_sent_at        = NOW(),
       invoice_expires_at     = NOW() + INTERVAL '${TIMER_HOURS} hours',
       reminder_sent_at       = NULL,
       last_attempt_failed_at = NULL,
       last_failure_reason    = NULL,
       updated_at             = NOW()
     WHERE id = $1`,
    [req.id, invoice.id, invoiceItem.id, invoice.hosted_invoice_url || null, amountCents],
  );

  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium invoice resent — request ${req.id} ($${(amountCents/100).toFixed(2)})`,
        JSON.stringify({ request_id: req.id, invoice_id: invoice.id, amount_cents: amountCents, prior_invoice_id: req.stripe_invoice_id }),
      ],
    );
  } catch {}

  (sendEmail as any).premiumInvoiceSent({
    to: req.student_email,
    name: req.student_name || 'there',
    planName: req.plan_name,
    amount: `$${(amountCents/100).toFixed(2)}`,
    expiresInHours: TIMER_HOURS,
  }).catch((e: any) => console.error('[admin/premium-requests] resend student email failed:', e?.message));

  return NextResponse.json({ ok: true, hosted_invoice_url: invoice.hosted_invoice_url });
}

// ─── Action: reject ───────────────────────────────────────────────────────
async function rejectRequest(pool: ReturnType<typeof getPool>, req: any, body: any) {
  if (req.status !== 'pending_review') {
    return NextResponse.json(
      { error: `Cannot reject — request is ${req.status}` },
      { status: 409 },
    );
  }
  const reason = (body.reason ?? '').toString().trim();
  if (!reason) {
    return NextResponse.json({ error: 'Reason required' }, { status: 400 });
  }

  await pool.query(
    `UPDATE premium_requests
        SET status = 'rejected', rejection_reason = $2, updated_at = NOW()
      WHERE id = $1`,
    [req.id, reason],
  );

  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium request rejected — request ${req.id}`,
        JSON.stringify({ request_id: req.id, reason }),
      ],
    );
  } catch {}

  if (req.student_email) {
    (sendEmail as any).premiumRequestRejected({
      to: req.student_email,
      name: req.student_name || 'there',
      planName: req.plan_name,
      reason,
    }).catch((e: any) => console.error('[admin/premium-requests] reject email failed:', e?.message));
  }

  return NextResponse.json({ ok: true });
}

// ─── Action: void ─────────────────────────────────────────────────────────
async function voidRequest(pool: ReturnType<typeof getPool>, req: any) {
  if (req.status !== 'awaiting_payment') {
    return NextResponse.json(
      { error: `Cannot void — request is ${req.status}` },
      { status: 409 },
    );
  }
  if (req.stripe_invoice_id) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      await stripe.invoices.voidInvoice(req.stripe_invoice_id);
    } catch (e: any) {
      console.error('[admin/premium-requests] voidInvoice failed:', e?.message);
    }
  }
  await pool.query(
    `UPDATE premium_requests
        SET status = 'voided', updated_at = NOW()
      WHERE id = $1`,
    [req.id],
  );
  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium invoice voided — request ${req.id}`,
        JSON.stringify({ request_id: req.id, invoice_id: req.stripe_invoice_id }),
      ],
    );
  } catch {}
  return NextResponse.json({ ok: true });
}
