/**
 * Stripe webhook handler — Phase B hardened.
 *
 * What's new in Phase B:
 *
 *   1. Idempotency guard.
 *      Every event is keyed on its Stripe id in `processed_events`. A
 *      duplicate (retry, manual resend, network blip) short-circuits
 *      to 200 OK with `{duplicate: true}` so we never re-grant a
 *      subscription, re-email a receipt, or re-downgrade a user.
 *
 *   2. Payment-event audit trail.
 *      Every event that touches a known payment writes a row to
 *      `payment_events`. The admin UI's "Details" timeline reads from
 *      this table — we no longer need to bounce to the Stripe dashboard
 *      to see a payment's full lifecycle.
 *
 *   3. New event types:
 *        refund.updated         — refund state change (e.g. ACH bounce)
 *        charge.dispute.closed  — chargeback resolved (won/lost/warn)
 *
 * Signature verification was already correct and is untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Insert one row into payment_events. ON CONFLICT (stripe_event_id) DO
 * NOTHING is defense in depth: if processed_events ever fails to dedupe
 * (DB hiccup, race), the per-event unique on stripe_event_id still keeps
 * the timeline clean.
 */
async function logPaymentEvent(
  pool: ReturnType<typeof getPool>,
  args: {
    paymentId: number | null;
    stripeEventId: string;
    eventType: string;
    status?: string | null;
    amountCents?: number | null;
    reason?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO payment_events
         (payment_id, stripe_event_id, event_type, status, amount_cents, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [
        args.paymentId,
        args.stripeEventId,
        args.eventType,
        args.status ?? null,
        args.amountCents ?? null,
        args.reason ?? null,
        JSON.stringify(args.details ?? {}),
      ],
    );
  } catch (err: any) {
    // Audit-log failures must never break webhook processing.
    console.error('[Stripe Webhook] payment_events insert failed:', err.message);
  }
}

/**
 * Process a paid invoice — shared between `invoice.paid` (legacy event)
 * and `invoice_payment.paid` (newer event from Stripe API versions that
 * use the Invoice Payments object). Both events ultimately reference the
 * same Stripe invoice; the caller is responsible for resolving its
 * `event.data.object` into an Invoice before calling this.
 *
 * Idempotent at the premium-request level: if the request is already
 * `paid`, we skip side effects so a duplicate event (e.g. both legacy
 * and new fired) doesn't double-grant Premium or create a second
 * ep_assignments row.
 */
async function processInvoicePaid(
  pool: ReturnType<typeof getPool>,
  inv: any,
  stripeEventId: string,
): Promise<void> {
  // Recovery branch — `metadata.recovery_type='pro'` invoices are
  // failed-payment recovery sends, not Premium requests. They take a
  // different code path: grant Pro, no ep_assignments. See the
  // /api/admin/recoveries route where these invoices originate.
  if (inv.metadata?.recovery_type === 'pro') {
    await processProRecovery(pool, inv, stripeEventId);
    return;
  }

  // Find our premium_request via the invoice id we stored at send time.
  // metadata.premium_request_id is a fallback if anything ever creates
  // an invoice out-of-band.
  const reqRes = await pool.query(
    `SELECT pr.id, pr.user_id, pr.plan_id, pr.plan_name,
            pr.amount_cents_invoiced, pr.counselor_user_id, pr.status
       FROM premium_requests pr
      WHERE pr.stripe_invoice_id = $1
         OR pr.id = $2
      LIMIT 1`,
    [inv.id, parseInt(inv.metadata?.premium_request_id || '0', 10) || 0],
  );
  const pr = reqRes.rows[0];
  if (!pr) {
    console.warn('[Stripe Webhook] invoice paid for unknown premium request:', inv.id);
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('warn', 'stripe', $1, $2)`,
      [`invoice paid for unknown premium request — ${inv.id}`, JSON.stringify({ invoice_id: inv.id })],
    ).catch(() => {});
    return;
  }

  // Idempotency at the request level. The processed_events guard at the
  // top of POST stops duplicate event ids; this stops duplicate side
  // effects when Stripe emits both the legacy invoice.paid AND the
  // newer invoice_payment.paid for the same payment (different event ids
  // but same logical "paid" event).
  if (pr.status === 'paid') {
    console.log('[Stripe Webhook] premium_request already paid, skipping side effects:', pr.id);
    await logPaymentEvent(pool, {
      paymentId: null,
      stripeEventId,
      eventType: 'invoice.paid',
      status: 'duplicate_skipped',
      details: { invoice_id: inv.id, premium_request_id: pr.id },
    });
    return;
  }

  const amount = pr.amount_cents_invoiced || inv.amount_paid || 0;
  const piId = typeof inv.payment_intent === 'string'
    ? inv.payment_intent
    : (inv.payment_intent as any)?.id ?? null;

  // ── Insert payments row (invoice id as unique key) ──
  let paymentId: number | null = null;
  try {
    const ins = await pool.query(
      `INSERT INTO payments (
         user_id, stripe_session_id, stripe_payment_intent_id,
         stripe_customer_id, amount_cents, currency, status,
         plan_id, plan_name, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'usd', 'succeeded', $6, $7, $8)
       ON CONFLICT (stripe_session_id) DO UPDATE SET status = 'succeeded'
       RETURNING id`,
      [
        pr.user_id,
        inv.id,
        piId,
        inv.customer || null,
        amount,
        pr.plan_id != null ? `premium_${pr.plan_id}` : 'premium',
        pr.plan_name,
        JSON.stringify({ premium_request_id: pr.id, invoice_id: inv.id }),
      ],
    );
    paymentId = ins.rows[0]?.id ?? null;
  } catch (e: any) {
    console.error('[Stripe Webhook] payments insert failed:', e?.message);
  }

  // ── Grant Premium ──
  await pool.query(
    `UPDATE users
        SET subscription_status = 'premium',
            subscription_expires_at = NOW() + INTERVAL '1 year',
            premium_package = $2
      WHERE id = $1`,
    [pr.user_id, pr.plan_id != null ? `premium_${pr.plan_id}` : null],
  );

  // ── Materialize ep_assignments row ──
  let counselorEpId: number | null = null;
  if (pr.counselor_user_id) {
    const cRes = await pool.query(
      `SELECT id FROM ep_counselors WHERE user_id = $1 LIMIT 1`,
      [pr.counselor_user_id],
    );
    counselorEpId = cRes.rows[0]?.id ?? null;
  }
  let sessionsTotal = 1;
  if (pr.plan_id) {
    const planRow = await pool.query(
      `SELECT sessions FROM ep_plans WHERE id = $1 LIMIT 1`,
      [pr.plan_id],
    );
    if (planRow.rows[0]?.sessions) sessionsTotal = planRow.rows[0].sessions;
  }
  await pool.query(
    `INSERT INTO ep_assignments
       (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [
      counselorEpId,
      pr.user_id,
      pr.plan_id,
      pr.plan_name,
      sessionsTotal,
      counselorEpId ? 'pending_acceptance' : 'pending',
    ],
  ).catch((e: any) => console.error('[Stripe Webhook] ep_assignments insert failed:', e?.message));

  // ── Flip premium_requests.status = paid ──
  await pool.query(
    `UPDATE premium_requests
        SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [pr.id],
  );

  await pool.query(
    `INSERT INTO admin_logs (level, source, message, details)
     VALUES ('info', 'stripe', $1, $2)`,
    [
      `Premium invoice paid — request ${pr.id} ($${(amount/100).toFixed(2)})`,
      JSON.stringify({ request_id: pr.id, invoice_id: inv.id, payment_id: paymentId }),
    ],
  ).catch(() => {});

  await logPaymentEvent(pool, {
    paymentId,
    stripeEventId,
    eventType: 'invoice.paid',
    status: 'paid',
    amountCents: amount,
    details: { invoice_id: inv.id, premium_request_id: pr.id },
  });
}

/**
 * Pro-recovery branch of `invoice.paid` / `invoice_payment.paid`. Fires
 * when a recovery invoice (sent by admin from /admin → Recoveries)
 * gets paid by the student. Grants Pro for 1 year, writes a succeeded
 * payments row, and stamps the original failed payment so the admin
 * UI can show "recovered" state. No ep_assignments creation — this is
 * a Pro purchase, not a Premium one.
 */
async function processProRecovery(
  pool: ReturnType<typeof getPool>,
  inv: any,
  stripeEventId: string,
): Promise<void> {
  const userId = parseInt(inv.metadata?.user_id || '0', 10) || 0;
  const recoveryForPaymentId = parseInt(inv.metadata?.recovery_for_payment_id || '0', 10) || 0;
  if (!userId) {
    console.warn('[Stripe Webhook] Pro recovery invoice paid but no user_id in metadata:', inv.id);
    await pool.query(
      `INSERT INTO admin_logs (level, source, message, details)
       VALUES ('warn', 'stripe', $1, $2)`,
      [
        `Pro recovery invoice paid but missing user_id metadata — ${inv.id}`,
        JSON.stringify({ invoice_id: inv.id, metadata: inv.metadata ?? {} }),
      ],
    ).catch(() => {});
    return;
  }

  const amount = inv.amount_paid || 0;
  const piId = typeof inv.payment_intent === 'string'
    ? inv.payment_intent
    : (inv.payment_intent as any)?.id ?? null;

  // ── Insert payments row for the successful recovery ──
  let paymentId: number | null = null;
  try {
    const ins = await pool.query(
      `INSERT INTO payments (
         user_id, stripe_session_id, stripe_payment_intent_id,
         stripe_customer_id, amount_cents, currency, status,
         plan_id, plan_name, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'usd', 'succeeded', $6, $7, $8)
       ON CONFLICT (stripe_session_id) DO UPDATE SET status = 'succeeded'
       RETURNING id`,
      [
        userId,
        inv.id, // unique key — recovery invoice id
        piId,
        inv.customer || null,
        amount,
        inv.metadata?.plan_id || 'pro',
        inv.metadata?.plan_name || 'Admitly Pro',
        JSON.stringify({
          recovery_type: 'pro',
          recovery_for_payment_id: recoveryForPaymentId,
          invoice_id: inv.id,
        }),
      ],
    );
    paymentId = ins.rows[0]?.id ?? null;
  } catch (e: any) {
    console.error('[Stripe Webhook] Pro recovery payments insert failed:', e?.message);
  }

  // ── Grant Pro for 1 year ──
  // We bump expiry from NOW to be conservative; the original failed
  // payment never granted access so there's no "remaining time" to
  // preserve.
  await pool.query(
    `UPDATE users
        SET subscription_status = 'pro',
            subscription_expires_at = NOW() + INTERVAL '1 year'
      WHERE id = $1`,
    [userId],
  );

  // ── Stamp the original failed payment as recovered, so the
  //     Recoveries tab can hide it without a separate query. ──
  if (recoveryForPaymentId > 0) {
    await pool.query(
      `UPDATE payments
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        recoveryForPaymentId,
        JSON.stringify({
          recovery_completed_at: new Date().toISOString(),
          recovery_payment_id: paymentId,
        }),
      ],
    ).catch(() => {});
  }

  await pool.query(
    `INSERT INTO admin_logs (level, source, message, details)
     VALUES ('info', 'stripe', $1, $2)`,
    [
      `Pro recovery payment succeeded — user ${userId} ($${(amount/100).toFixed(2)})`,
      JSON.stringify({ user_id: userId, invoice_id: inv.id, payment_id: paymentId, recovery_for_payment_id: recoveryForPaymentId }),
    ],
  ).catch(() => {});

  await logPaymentEvent(pool, {
    paymentId,
    stripeEventId,
    eventType: 'invoice.paid',
    status: 'paid',
    amountCents: amount,
    details: { invoice_id: inv.id, recovery_type: 'pro', recovery_for_payment_id: recoveryForPaymentId },
  });
}

/**
 * Apply the same downgrade logic that charge.refunded uses. Reused by
 * dispute.created and dispute.closed (lost) so the rules stay consistent.
 *
 * Premium refund/dispute → revert to pro and cancel assignments.
 * Pro refund/dispute → revert to free unless an active premium
 * assignment exists (we don't yank counselor access mid-engagement).
 */
async function applyRefundLikeDowngrade(
  pool: ReturnType<typeof getPool>,
  paymentIntentId: string | null,
): Promise<void> {
  if (!paymentIntentId) return;
  const { rows } = await pool.query(
    `SELECT user_id, plan_id, plan_name FROM payments
      WHERE stripe_payment_intent_id = $1 LIMIT 1`,
    [paymentIntentId],
  );
  if (!rows[0]?.user_id) return;
  const uid = rows[0].user_id;
  const planId = rows[0].plan_id || '';
  const planName = (rows[0].plan_name || '').toLowerCase();
  const isPremium = planId.startsWith('premium')
    || ['full cycle', 'essay only', 'starter'].includes(planName);

  if (isPremium) {
    await pool.query(`UPDATE users SET subscription_status = 'pro' WHERE id = $1`, [uid]);
    await pool.query(
      `UPDATE ep_assignments SET status = 'cancelled'
        WHERE student_id = $1 AND status IN ('active','pending_acceptance','paused')`,
      [uid],
    );
  } else {
    const { rows: active } = await pool.query(
      `SELECT id FROM ep_assignments
        WHERE student_id = $1 AND status IN ('active','paused') LIMIT 1`,
      [uid],
    );
    if (active.length === 0) {
      await pool.query(
        `UPDATE users SET subscription_status = 'free', subscription_expires_at = NULL WHERE id = $1`,
        [uid],
      );
    }
  }
}

export async function POST(request: NextRequest) {
  const pool = getPool();

  try {
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: any;

    // SECURITY: Signature verification is MANDATORY. (Pre-Phase-B; unchanged.)
    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured — refusing to process webhook');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }
    if (!sig) {
      console.error('[Stripe Webhook] Missing stripe-signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // ── Phase B step 0: idempotency guard ─────────────────────────────────
    // Try to claim this event id. If the row already exists, this is a
    // duplicate delivery — return 200 immediately so Stripe stops retrying,
    // and skip every side effect below.
    try {
      const claim = await pool.query(
        `INSERT INTO processed_events (stripe_event_id, event_type, outcome)
         VALUES ($1, $2, 'processed')
         ON CONFLICT (stripe_event_id) DO NOTHING
         RETURNING stripe_event_id`,
        [event.id, event.type],
      );
      if (claim.rowCount === 0) {
        console.log('[Stripe Webhook] Duplicate event, skipping:', event.id, event.type);
        return NextResponse.json({ received: true, duplicate: true });
      }
    } catch (err: any) {
      // If processed_events doesn't exist yet (migration not run) we'd
      // rather process the event than silently drop it. Log and continue.
      if (err?.code !== '42P01') {
        console.error('[Stripe Webhook] processed_events insert failed:', err.message);
      } else {
        console.warn('[Stripe Webhook] processed_events table missing — run migrations/006_phase_b.sql');
      }
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { client_reference_id, customer_email, amount_total, metadata } = session;
        const userId = parseInt(client_reference_id || metadata?.user_id || '0') || null;

        console.log('[Stripe Webhook] checkout.session.completed:', {
          session_id: session.id,
          user_id: userId,
          plan_id: metadata?.plan_id,
          plan_name: metadata?.plan_name,
          amount: amount_total,
        });

        // ── Step 1: Record payment (non-blocking) ──
        try {
          // Ensure payments table has varchar plan_id column (safe for both new and existing DBs)
          await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text`).catch(() => {});

          // Check for duplicate first
          const existing = await pool.query(`SELECT id FROM payments WHERE stripe_session_id = $1`, [session.id]);
          if (existing.rows.length === 0) {
            await pool.query(`
              INSERT INTO payments (
                user_id, stripe_session_id, stripe_payment_intent_id, stripe_customer_id,
                amount_cents, currency, status,
                plan_id, plan_name, metadata
              ) VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9)
              ON CONFLICT (stripe_session_id) DO NOTHING
            `, [
              userId,
              session.id,
              session.payment_intent || null,
              session.customer || null,
              amount_total || 0,
              session.currency || 'usd',
              metadata?.plan_id || null,
              metadata?.plan_name || 'Unknown',
              JSON.stringify(metadata || {}),
            ]);
            console.log('[Stripe Webhook] Payment recorded, pi:', session.payment_intent, 'plan:', metadata?.plan_id);
          } else {
            console.log('[Stripe Webhook] Payment already exists for session:', session.id);
          }
        } catch (payErr: any) {
          // Don't block subscription update if payment record fails
          console.error('[Stripe Webhook] Payment INSERT failed (continuing):', payErr.message);
        }

        // ── Step 2: Update subscription status (critical) ──
        // Phase C: Premium is no longer self-serve via Stripe Checkout.
        // The Premium branch is preserved as a safety net — if a stale
        // session somehow completes (someone bookmarked a checkout URL,
        // a webhook retry from before the cutover, etc.) we explicitly
        // refuse to grant and log loud so admin can reconcile manually.
        // The Pro branch is byte-for-byte unchanged.
        if (userId) {
          try {
            const planId = metadata?.plan_id ?? '';
            const planName = metadata?.plan_name ?? '';
            const isPremium = planId.startsWith('premium') || ['full cycle','essay only','starter'].includes(planName.toLowerCase());

            if (isPremium) {
              console.error('[Stripe Webhook] Stale Premium Checkout session — refusing to grant. Use the Premium Match flow.');
              await pool.query(
                `INSERT INTO admin_logs (level, source, message, details)
                 VALUES ('error', 'stripe', $1, $2)`,
                [
                  `⚠️ Stale Premium Checkout completed — refused to grant subscription`,
                  JSON.stringify({ session_id: session.id, user_id: userId, plan_id: planId, plan_name: planName }),
                ],
              ).catch(() => {});
            } else {
              // Pro: 1 year from payment date — unchanged.
              await pool.query(`
                UPDATE users
                SET subscription_status = 'pro',
                    subscription_expires_at = NOW() + INTERVAL '1 year',
                    stripe_customer_id = $2
                WHERE id = $1
              `, [userId, session.customer || null]);
              console.log(`[Stripe Webhook] User ${userId} upgraded to pro`);
            }
          } catch (subErr: any) {
            console.error('[Stripe Webhook] Subscription UPDATE failed:', subErr.message);
          }
        } else {
          console.warn('[Stripe Webhook] No user_id — cannot update subscription');
        }

        // ── Step 3: Activate assignment if exists ──
        if (userId && metadata?.plan_id) {
          try {
            await pool.query(`
              UPDATE ep_assignments SET status = 'active'
              WHERE student_id = $1 AND status = 'pending'
            `, [userId]);
          } catch {}
        }

        // ── Step 4: Log to admin_logs ──
        try {
          await pool.query(`
            INSERT INTO admin_logs (level, source, message, details)
            VALUES ('info', 'stripe', $1, $2)
          `, [
            `Checkout completed — ${metadata?.plan_name || 'Unknown plan'} for user ${userId}`,
            JSON.stringify({ session_id: session.id, user_id: userId, amount: amount_total, plan: metadata?.plan_id }),
          ]);
        } catch {}

        // ── Step 5: Send payment receipt email ──
        if (userId && customer_email) {
          try {
            const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
            const userName = userRes.rows[0]?.name || 'Student';
            const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
            const invId = session.invoice ? `#INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(userId).padStart(4,'0')}` : undefined;
            sendEmail.paymentReceipt({
              to: customer_email,
              name: userName,
              planName: metadata?.plan_name || 'Admitly Plan',
              amount: `$${((amount_total || 0) / 100).toFixed(2)}`,
              date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
              invoiceId: invId || `#INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(userId).padStart(4,'0')}`,
              transactionId: piId ? `${piId.slice(0, 14)}...${piId.slice(-4)}` : undefined,
            }).catch(() => {});
          } catch {}
        }

        // ── Phase B: timeline row ──
        try {
          const { rows } = await pool.query(
            `SELECT id FROM payments WHERE stripe_session_id = $1 LIMIT 1`,
            [session.id],
          );
          await logPaymentEvent(pool, {
            paymentId: rows[0]?.id ?? null,
            stripeEventId: event.id,
            eventType: 'checkout.completed',
            status: 'succeeded',
            amountCents: amount_total ?? null,
            details: { plan_id: metadata?.plan_id, plan_name: metadata?.plan_name },
          });
        } catch {}

        break;
      }

      case 'checkout.session.expired': {
        // Stripe fires this ~24h after a Checkout session goes unpaid.
        // Treat it as an abandoned Pro purchase: write a `failed`
        // payments row tagged with metadata.abandoned so the Recoveries
        // tab surfaces it. Email the student a retry link and admin
        // an alert. (Premium uses Stripe Invoice flow, not Checkout —
        // those have their own expiry path via cron/premium-timers.)
        const session = event.data.object;
        const userId = parseInt(session.client_reference_id || session.metadata?.user_id || '0') || null;
        if (!userId) {
          console.log('[Stripe Webhook] checkout.session.expired without user_id, skipping:', session.id);
          break;
        }
        try {
          const ins = await pool.query(
            `INSERT INTO payments
               (user_id, stripe_session_id, amount_cents, currency, status,
                plan_id, plan_name, metadata)
             VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7)
             ON CONFLICT (stripe_session_id) DO UPDATE SET
               status = CASE WHEN payments.status IN ('succeeded','refunded','disputed')
                             THEN payments.status
                             ELSE 'failed' END,
               metadata = COALESCE(payments.metadata, '{}'::jsonb) || EXCLUDED.metadata,
               updated_at = NOW()
             RETURNING id, status`,
            [
              userId,
              session.id,
              session.amount_total || 0,
              session.currency || 'usd',
              session.metadata?.plan_id || 'pro',
              session.metadata?.plan_name || 'Admitly Pro',
              JSON.stringify({ ...(session.metadata || {}), abandoned: true, expired_at: new Date().toISOString() }),
            ],
          );
          const paymentRow = ins.rows[0];
          // If ON CONFLICT short-circuited (already succeeded), don't
          // bother emailing — the customer already paid.
          if (paymentRow?.status !== 'failed') {
            console.log('[Stripe Webhook] checkout.session.expired but payment already succeeded:', session.id);
            break;
          }
          const paymentId = paymentRow.id;

          const { rows: userRows } = await pool.query(
            `SELECT name, email FROM users WHERE id = $1 LIMIT 1`,
            [userId],
          );
          const user = userRows[0];

          await pool.query(
            `INSERT INTO admin_logs (level, source, message, details)
             VALUES ('warn', 'stripe', $1, $2)`,
            [
              `Pro checkout abandoned — ${session.metadata?.plan_name || 'Pro'} ${user?.email ? `(${user.email})` : `(session ${session.id})`}`,
              JSON.stringify({ session_id: session.id, user_id: userId, amount: session.amount_total, plan: session.metadata?.plan_id }),
            ],
          ).catch(() => {});

          if (user?.email) {
            const amountStr = `$${((session.amount_total || 0) / 100).toFixed(2)}`;
            (sendEmail as any).proPaymentFailed({
              to: user.email,
              name: user.name || 'there',
              amount: amountStr,
              reason: 'Your payment session expired without being completed',
            }).catch((e: any) => console.error('[Stripe Webhook] expired student email failed:', e?.message));

            const adminTo = process.env.ADMIN_NOTIFY_EMAIL
              || process.env.SMTP_FROM
              || process.env.POSTMARK_FROM_EMAIL;
            if (adminTo) {
              (sendEmail as any).adminPaymentFailedAlert({
                to: adminTo,
                studentName: user.name || 'Unknown',
                studentEmail: user.email,
                amount: amountStr,
                reason: 'Checkout session expired (abandoned)',
                paymentId,
              }).catch((e: any) => console.error('[Stripe Webhook] expired admin email failed:', e?.message));
            }
          }

          await logPaymentEvent(pool, {
            paymentId,
            stripeEventId: event.id,
            eventType: 'checkout.session.expired',
            status: 'expired',
            amountCents: session.amount_total ?? null,
            reason: 'abandoned',
            details: { session_id: session.id, user_id: userId, plan_id: session.metadata?.plan_id },
          });
        } catch (err: any) {
          console.error('[Stripe Webhook] checkout.session.expired handler failed:', err?.message);
        }
        console.log('[Stripe Webhook] checkout.session.expired:', session.id);
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        try {
          await pool.query(`
            UPDATE payments SET status = 'succeeded', updated_at = NOW()
            WHERE stripe_session_id = $1 OR stripe_payment_intent_id = $2
          `, [pi.metadata?.session_id, pi.id]);
        } catch {}
        console.log('[Stripe Webhook] payment_intent.succeeded:', pi.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const reason: string | null = pi.last_payment_error?.message ?? null;
        try {
          await pool.query(`
            UPDATE payments SET status = 'failed', updated_at = NOW()
            WHERE stripe_session_id = $1 OR stripe_payment_intent_id = $2
          `, [pi.metadata?.session_id, pi.id]);
          // Look up the payment + student so we can email both sides.
          const { rows } = await pool.query(
            `SELECT p.id AS payment_id, p.amount_cents,
                    u.id AS user_id, u.name AS user_name, u.email AS user_email
               FROM payments p
               LEFT JOIN users u ON u.id = p.user_id
              WHERE p.stripe_payment_intent_id = $1 LIMIT 1`,
            [pi.id],
          );
          const payment = rows[0];

          await logPaymentEvent(pool, {
            paymentId: payment?.payment_id ?? null,
            stripeEventId: event.id,
            eventType: 'payment_intent.failed',
            status: 'failed',
            reason,
          });

          // Recovery emails — one to the student with a retry link, one
          // to admin pointing at the Recoveries tab. Both sends are
          // fire-and-forget; the webhook returns 200 either way.
          if (payment?.user_email) {
            await pool.query(
              `INSERT INTO admin_logs (level, source, message, details)
               VALUES ('warn', 'stripe', $1, $2)`,
              [
                `Pro payment failed — ${payment.user_email}`,
                JSON.stringify({ payment_intent: pi.id, amount_cents: payment.amount_cents, reason }),
              ],
            ).catch(() => {});

            const amountStr = `$${((payment.amount_cents ?? 0) / 100).toFixed(2)}`;

            (sendEmail as any).proPaymentFailed({
              to: payment.user_email,
              name: payment.user_name || 'there',
              amount: amountStr,
              reason: reason ?? undefined,
            }).catch((e: any) => console.error('[Stripe Webhook] proPaymentFailed email failed:', e?.message));

            const adminTo = process.env.ADMIN_NOTIFY_EMAIL
              || process.env.SMTP_FROM
              || process.env.POSTMARK_FROM_EMAIL;
            if (adminTo) {
              (sendEmail as any).adminPaymentFailedAlert({
                to: adminTo,
                studentName: payment.user_name || 'Unknown',
                studentEmail: payment.user_email,
                amount: amountStr,
                reason: reason ?? undefined,
                paymentId: payment.payment_id,
              }).catch((e: any) => console.error('[Stripe Webhook] adminPaymentFailedAlert email failed:', e?.message));
            }
          }
        } catch {}
        console.log('[Stripe Webhook] payment_intent.payment_failed:', pi.id);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        try {
          await pool.query(`
            UPDATE payments SET status = 'refunded', updated_at = NOW()
            WHERE stripe_payment_intent_id = $1
          `, [charge.payment_intent]);

          await applyRefundLikeDowngrade(pool, charge.payment_intent);

          // Log to admin_logs (existing behavior, kept).
          await pool.query(
            `INSERT INTO admin_logs (level, source, message, details)
             VALUES ('info', 'stripe', $1, $2)`,
            [
              `Stripe refund processed — charge ${charge.id}`,
              JSON.stringify({ charge_id: charge.id, payment_intent: charge.payment_intent, amount_refunded: charge.amount_refunded }),
            ],
          ).catch(() => {});

          // Phase B: timeline row.
          const { rows } = await pool.query(
            `SELECT id FROM payments WHERE stripe_payment_intent_id = $1 LIMIT 1`,
            [charge.payment_intent],
          );
          await logPaymentEvent(pool, {
            paymentId: rows[0]?.id ?? null,
            stripeEventId: event.id,
            eventType: 'refund.issued',
            status: 'succeeded',
            amountCents: charge.amount_refunded ?? null,
            details: { charge_id: charge.id, payment_intent: charge.payment_intent },
          });
        } catch {}
        console.log('[Stripe Webhook] charge.refunded:', charge.id);
        break;
      }

      case 'refund.updated': {
        // Stripe's refund object references `charge` but not
        // `payment_intent` directly. We pay the cost of one extra Stripe
        // API call to find the payment_intent — this event is rare
        // (usually hours to days after the initial refund).
        const refund = event.data.object;
        let paymentIntentId: string | null = null;
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
          if (refund.charge) {
            const ch = await stripe.charges.retrieve(refund.charge);
            paymentIntentId = typeof ch.payment_intent === 'string'
              ? ch.payment_intent
              : (ch.payment_intent as any)?.id ?? null;
          }
        } catch (e: any) {
          console.error('[Stripe Webhook] refund.updated charge fetch failed:', e?.message);
        }

        const refundFailed = refund.status === 'failed';
        try {
          const { rows } = paymentIntentId
            ? await pool.query(
                `SELECT id FROM payments WHERE stripe_payment_intent_id = $1 LIMIT 1`,
                [paymentIntentId],
              )
            : { rows: [] as any[] };

          await logPaymentEvent(pool, {
            paymentId: rows[0]?.id ?? null,
            stripeEventId: event.id,
            eventType: refundFailed ? 'refund.failed' : 'refund.updated',
            status: refund.status ?? null,
            amountCents: refund.amount ?? null,
            reason: refund.failure_reason ?? null,
            details: { refund_id: refund.id, charge_id: refund.charge, payment_intent: paymentIntentId },
          });

          if (refundFailed) {
            // Don't change subscription state — the original refund event
            // already handled the user-facing side. Just alert.
            await pool.query(
              `INSERT INTO admin_logs (level, source, message, details)
               VALUES ('warn', 'stripe', $1, $2)`,
              [
                `⚠️ Refund failed — ${refund.failure_reason ?? 'unknown'} (refund ${refund.id})`,
                JSON.stringify({ refund_id: refund.id, charge_id: refund.charge, payment_intent: paymentIntentId, failure_reason: refund.failure_reason }),
              ],
            ).catch(() => {});
          }
        } catch (err: any) {
          console.error('[Stripe Webhook] refund.updated handler failed:', err?.message);
        }
        console.log('[Stripe Webhook] refund.updated:', refund.id, 'status:', refund.status);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        try {
          await pool.query(`
            UPDATE payments SET status = 'disputed', updated_at = NOW()
            WHERE stripe_payment_intent_id = $1
          `, [dispute.payment_intent]);

          await applyRefundLikeDowngrade(pool, dispute.payment_intent);

          await pool.query(
            `INSERT INTO admin_logs (level, source, message, details)
             VALUES ('warn', 'stripe', $1, $2)`,
            [
              `⚠️ Stripe dispute opened — $${((dispute.amount || 0) / 100).toFixed(2)}`,
              JSON.stringify({ dispute_id: dispute.id, payment_intent: dispute.payment_intent, reason: dispute.reason, amount: dispute.amount }),
            ],
          ).catch(() => {});

          const { rows } = await pool.query(
            `SELECT id FROM payments WHERE stripe_payment_intent_id = $1 LIMIT 1`,
            [dispute.payment_intent],
          );
          await logPaymentEvent(pool, {
            paymentId: rows[0]?.id ?? null,
            stripeEventId: event.id,
            eventType: 'dispute.created',
            status: dispute.status ?? null,
            amountCents: dispute.amount ?? null,
            reason: dispute.reason ?? null,
            details: { dispute_id: dispute.id, payment_intent: dispute.payment_intent },
          });
        } catch {}
        console.log('[Stripe Webhook] charge.dispute.created:', dispute.id);
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        const status: string = dispute.status; // 'won' | 'lost' | 'warning_closed' | ...
        try {
          const { rows: payRows } = await pool.query(
            `SELECT id, user_id, plan_id, plan_name FROM payments
              WHERE stripe_payment_intent_id = $1 LIMIT 1`,
            [dispute.payment_intent],
          );
          const paymentId = payRows[0]?.id ?? null;
          const uid = payRows[0]?.user_id;
          const planId: string = payRows[0]?.plan_id || '';
          const planName: string = (payRows[0]?.plan_name || '').toLowerCase();
          const isPremium = planId.startsWith('premium')
            || ['full cycle', 'essay only', 'starter'].includes(planName);

          let logLevel: 'info' | 'warn' = 'info';
          let logMessage = '';
          let timelineEvent = 'dispute.closed';

          if (status === 'won') {
            // Restore: roll the payment back to succeeded and re-grant
            // whichever subscription tier the original payment bought.
            await pool.query(
              `UPDATE payments SET status = 'succeeded', updated_at = NOW()
                WHERE stripe_payment_intent_id = $1`,
              [dispute.payment_intent],
            );
            if (uid) {
              if (isPremium) {
                await pool.query(
                  `UPDATE users SET subscription_status = 'premium',
                                    subscription_expires_at = NOW() + INTERVAL '1 year'
                    WHERE id = $1`,
                  [uid],
                );
              } else {
                await pool.query(
                  `UPDATE users SET subscription_status = 'pro',
                                    subscription_expires_at = NOW() + INTERVAL '1 year'
                    WHERE id = $1`,
                  [uid],
                );
              }
            }
            logMessage = `✓ Dispute won — ${dispute.id}`;
            timelineEvent = 'dispute.won';
          } else if (status === 'lost') {
            // Treat as a refund: payment becomes 'refunded', user gets
            // the same downgrade as charge.refunded.
            await pool.query(
              `UPDATE payments SET status = 'refunded', updated_at = NOW()
                WHERE stripe_payment_intent_id = $1`,
              [dispute.payment_intent],
            );
            await applyRefundLikeDowngrade(pool, dispute.payment_intent);
            logLevel = 'warn';
            logMessage = `✗ Dispute lost — ${dispute.id}`;
            timelineEvent = 'dispute.lost';
          } else if (status === 'warning_closed') {
            // Stripe-internal warning resolution; no side effects.
            logMessage = `Dispute warning closed — ${dispute.id}`;
            timelineEvent = 'dispute.warning_closed';
          } else {
            // Unknown / future status — record but don't act.
            logMessage = `Dispute closed (${status}) — ${dispute.id}`;
            timelineEvent = `dispute.${status}`;
          }

          await pool.query(
            `INSERT INTO admin_logs (level, source, message, details)
             VALUES ($1, 'stripe', $2, $3)`,
            [
              logLevel,
              logMessage,
              JSON.stringify({ dispute_id: dispute.id, payment_intent: dispute.payment_intent, status }),
            ],
          ).catch(() => {});

          await logPaymentEvent(pool, {
            paymentId,
            stripeEventId: event.id,
            eventType: timelineEvent,
            status,
            amountCents: dispute.amount ?? null,
            reason: dispute.reason ?? null,
            details: { dispute_id: dispute.id, payment_intent: dispute.payment_intent },
          });
        } catch (err: any) {
          console.error('[Stripe Webhook] charge.dispute.closed handler failed:', err?.message);
        }
        console.log('[Stripe Webhook] charge.dispute.closed:', dispute.id, 'status:', status);
        break;
      }

      // ── Phase C: invoice.* events for the manual-matching flow ────────
      case 'invoice.finalized': {
        // Stripe finalized the invoice; we already store the hosted URL
        // when admin sends it, so this is purely informational. Useful as
        // a timeline marker if anyone debugs a stuck request.
        const inv = event.data.object;
        try {
          const { rows } = await pool.query(
            `SELECT id FROM premium_requests WHERE stripe_invoice_id = $1 LIMIT 1`,
            [inv.id],
          );
          await logPaymentEvent(pool, {
            paymentId: null,
            stripeEventId: event.id,
            eventType: 'invoice.finalized',
            status: inv.status ?? null,
            amountCents: inv.amount_due ?? null,
            details: { invoice_id: inv.id, premium_request_id: rows[0]?.id ?? null },
          });
        } catch {}
        console.log('[Stripe Webhook] invoice.finalized:', inv.id);
        break;
      }

      case 'invoice.paid': {
        // Legacy event name. Older Stripe API versions still emit this.
        const inv = event.data.object;
        try {
          await processInvoicePaid(pool, inv, event.id);
        } catch (err: any) {
          console.error('[Stripe Webhook] invoice.paid handler failed:', err?.message);
        }
        console.log('[Stripe Webhook] invoice.paid:', inv.id);
        break;
      }

      case 'invoice_payment.paid': {
        // Newer event from Stripe API versions that use the Invoice
        // Payments object (2026-02-25.clover and later). The
        // event.data.object is an InvoicePayment, not an Invoice — its
        // `invoice` field holds the Stripe invoice id, which we retrieve
        // so the existing handler can run unchanged.
        const ip = event.data.object;
        const invoiceId: string | null = typeof ip.invoice === 'string'
          ? ip.invoice
          : (ip.invoice as any)?.id ?? null;
        if (!invoiceId) {
          console.warn('[Stripe Webhook] invoice_payment.paid missing invoice id:', ip.id);
          break;
        }
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
          const inv = await stripe.invoices.retrieve(invoiceId);
          await processInvoicePaid(pool, inv as any, event.id);
        } catch (err: any) {
          console.error('[Stripe Webhook] invoice_payment.paid handler failed:', err?.message);
        }
        console.log('[Stripe Webhook] invoice_payment.paid:', ip.id, '→ invoice', invoiceId);
        break;
      }

      case 'invoice.voided': {
        const inv = event.data.object;
        try {
          // If our row is still awaiting_payment, flip to 'voided'. If
          // it's already 'expired' or 'cancelled_by_student' (caused by
          // our own admin/cancel/cron action), leave it — the previous
          // status is more informative than a generic 'voided'.
          await pool.query(
            `UPDATE premium_requests
                SET status = 'voided', updated_at = NOW()
              WHERE stripe_invoice_id = $1
                AND status = 'awaiting_payment'`,
            [inv.id],
          );
          const { rows } = await pool.query(
            `SELECT id FROM premium_requests WHERE stripe_invoice_id = $1 LIMIT 1`,
            [inv.id],
          );
          await logPaymentEvent(pool, {
            paymentId: null,
            stripeEventId: event.id,
            eventType: 'invoice.voided',
            status: 'voided',
            details: { invoice_id: inv.id, premium_request_id: rows[0]?.id ?? null },
          });
        } catch {}
        console.log('[Stripe Webhook] invoice.voided:', inv.id);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const reason: string | null = inv.last_finalization_error?.message
          ?? inv.last_payment_error?.message
          ?? null;
        try {
          // Find the premium_request driving this invoice + the student
          // info we need for the email + Recoveries surface.
          const { rows } = await pool.query(
            `SELECT pr.id AS request_id, pr.amount_cents_invoiced,
                    pr.plan_name, pr.attempt_count,
                    u.id AS user_id, u.name AS user_name, u.email AS user_email
               FROM premium_requests pr
               JOIN users u ON u.id = pr.user_id
              WHERE pr.stripe_invoice_id = $1 LIMIT 1`,
            [inv.id],
          );
          const pr = rows[0];

          // Stamp the request with the failure so the Recoveries tab
          // can surface it. Increments attempt_count so admin can tell
          // "first try" from "fifth try".
          if (pr?.request_id) {
            await pool.query(
              `UPDATE premium_requests
                  SET last_attempt_failed_at = NOW(),
                      last_failure_reason = $2,
                      attempt_count = COALESCE(attempt_count, 0) + 1,
                      updated_at = NOW()
                WHERE id = $1`,
              [pr.request_id, reason],
            );
          }

          await pool.query(
            `INSERT INTO admin_logs (level, source, message, details)
             VALUES ('warn', 'stripe', $1, $2)`,
            [
              pr?.user_email
                ? `Premium invoice payment failed — ${pr.user_email} (request ${pr.request_id})`
                : `Invoice payment failed — invoice ${inv.id}`,
              JSON.stringify({ invoice_id: inv.id, customer: inv.customer, attempt: inv.attempt_count, reason }),
            ],
          ).catch(() => {});

          await logPaymentEvent(pool, {
            paymentId: null,
            stripeEventId: event.id,
            eventType: 'invoice.payment_failed',
            status: 'failed',
            amountCents: inv.amount_due ?? null,
            reason,
            details: { invoice_id: inv.id, premium_request_id: pr?.request_id ?? null, attempt: inv.attempt_count },
          });

          // Email both sides — same templates as Pro recovery so the
          // copy and CTA stay consistent. Student gets a retry link
          // (the same hosted invoice URL still works); admin gets
          // pointed at Recoveries.
          if (pr?.user_email) {
            const amountStr = `$${((pr.amount_cents_invoiced ?? inv.amount_due ?? 0) / 100).toFixed(2)}`;
            (sendEmail as any).proPaymentFailed({
              to: pr.user_email,
              name: pr.user_name || 'there',
              amount: amountStr,
              reason: reason ?? undefined,
            }).catch((e: any) => console.error('[Stripe Webhook] premium proPaymentFailed email failed:', e?.message));

            const adminTo = process.env.ADMIN_NOTIFY_EMAIL
              || process.env.SMTP_FROM
              || process.env.POSTMARK_FROM_EMAIL;
            if (adminTo) {
              (sendEmail as any).adminPaymentFailedAlert({
                to: adminTo,
                studentName: pr.user_name || 'Unknown',
                studentEmail: pr.user_email,
                amount: amountStr,
                reason: reason ?? undefined,
                paymentId: pr.request_id, // re-using paymentId field for the request id is fine here
              }).catch((e: any) => console.error('[Stripe Webhook] premium adminPaymentFailedAlert email failed:', e?.message));
            }
          }
        } catch {}
        console.log('[Stripe Webhook] invoice.payment_failed:', inv.id);
        break;
      }

      default:
        console.log('[Stripe Webhook] Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[Stripe Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
