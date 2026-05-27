/**
 * POST /api/premium/request/[id]/cancel
 *
 * Phase C — student cancels their own active request. Two phases:
 *
 *   pending_review     → just flip status to cancelled_by_student
 *   awaiting_payment   → flip status AND void the Stripe invoice so the
 *                        hosted payment link stops working
 *
 * Anything else (paid, rejected, voided, expired) → 409 Conflict; the
 * UI shouldn't offer Cancel in those states but the route enforces it.
 *
 * Auth: the request's owning student. Admins use a different route
 * (POST /api/admin/premium-requests with action=void) so we keep audit
 * trails clean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool, getUserByEmail } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const reqId = parseInt(params.id, 10);
  if (!Number.isFinite(reqId) || reqId <= 0) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, status, stripe_invoice_id
       FROM premium_requests WHERE id = $1 LIMIT 1`,
    [reqId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const req = rows[0];
  if (req.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (req.status !== 'pending_review' && req.status !== 'awaiting_payment') {
    return NextResponse.json(
      { error: `Cannot cancel a request with status ${req.status}` },
      { status: 409 },
    );
  }

  // Void the Stripe invoice if one was issued. Stripe rejects voiding an
  // already-void or already-paid invoice, but the only path to those
  // states ends with our own status moving off awaiting_payment — so if
  // we got here with awaiting_payment + a stripe_invoice_id, the invoice
  // is still live and voiding will succeed.
  if (req.status === 'awaiting_payment' && req.stripe_invoice_id) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      await stripe.invoices.voidInvoice(req.stripe_invoice_id);
    } catch (e: any) {
      // Don't block the cancel — log and proceed. Webhook reconciliation
      // (invoice.voided) will still fire if Stripe processed it server-side.
      console.error('[premium/cancel] voidInvoice failed:', e?.message);
    }
  }

  await pool.query(
    `UPDATE premium_requests
        SET status = 'cancelled_by_student', updated_at = NOW()
      WHERE id = $1`,
    [reqId],
  );

  // Audit
  try {
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('info', 'premium', $1, $2)`,
      [
        `Premium request cancelled by student — request ${reqId}`,
        JSON.stringify({ request_id: reqId, user_id: user.id, prior_status: req.status }),
      ],
    );
  } catch {}

  return NextResponse.json({ ok: true });
}
