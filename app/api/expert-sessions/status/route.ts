import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ state: 'plans', reason: 'not_authenticated' });
    }

    const userId = parseInt(session.user.id as string);
    const pool = getPool();

    try { await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text`); } catch {}

    // Step 1: Check DB subscription status
    const { rows: userRows } = await pool.query(
      `SELECT subscription_status, subscription_expires_at FROM users WHERE id = $1`, [userId]
    );
    let subStatus = userRows[0]?.subscription_status || 'free';

    // Step 2: Check payments — look at pro and premium separately
    let hasPendingPremiumPayment = false;
    try {
      // Check most recent pro payment
      const { rows: proPayment } = await pool.query(
        `SELECT status, created_at FROM payments WHERE user_id = $1 AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') ORDER BY created_at DESC LIMIT 1`, [userId]
      );
      let proValid = proPayment.length > 0 && proPayment[0].status === 'succeeded';
      const proRefunded = proPayment.length > 0 && (proPayment[0].status === 'refunded' || proPayment[0].status === 'disputed');

      // If most recent pro is succeeded, check 1 year expiry
      if (proValid) {
        const oneYearLater = new Date(new Date(proPayment[0].created_at).getTime() + 365 * 86400000);
        if (oneYearLater <= new Date()) proValid = false; // expired
      }

      // If most recent pro is refunded, check for an older valid pro within 1 year
      if (proRefunded) {
        const { rows: olderPro } = await pool.query(
          `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') AND created_at > NOW() - INTERVAL '1 year' ORDER BY created_at DESC LIMIT 1`,
          [userId]
        );
        if (olderPro.length > 0) proValid = true;
      }

      // If pro is valid and user is free, upgrade to pro
      if (proValid && subStatus === 'free') {
        await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year' WHERE id = $1`, [userId]);
        subStatus = 'pro';
      }

      // Check most recent premium payment
      const { rows: premPayment } = await pool.query(
        `SELECT plan_id, plan_name, created_at, status FROM payments WHERE user_id = $1 AND (plan_id LIKE 'premium%' OR LOWER(plan_name) IN ('full cycle','essay only','starter')) ORDER BY created_at DESC LIMIT 1`, [userId]
      );
      if (premPayment.length > 0 && premPayment[0].status === 'succeeded') {
        const paymentDate = new Date(premPayment[0].created_at);
        const { rows: coveringAssignment } = await pool.query(
          `SELECT id FROM ep_assignments WHERE student_id = $1 AND status IN ('active','completed','pending_acceptance','paused') AND created_at > $2 LIMIT 1`,
          [userId, paymentDate]
        );
        if (coveringAssignment.length === 0) hasPendingPremiumPayment = true;
      }
    } catch (e: any) { console.error('[ExpertStatus] Payment check error:', e.message); }

    // Step 2b: If still not premium, check Stripe API — skip if no valid pro exists
    const { rows: anyValidPro } = await pool.query(
      `SELECT id FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') AND created_at > NOW() - INTERVAL '1 year' LIMIT 1`, [userId]
    ).catch(()=>({rows:[]}));
    const hasValidPro = anyValidPro.length > 0;
    if (subStatus !== 'premium' && process.env.STRIPE_SECRET_KEY && hasValidPro) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const sessions = await stripe.checkout.sessions.list({ limit: 20 });
        const match = sessions.data.find(
          s => String(s.client_reference_id) === String(userId) && s.payment_status === 'paid'
        );
        if (match) {
          const planId = match.metadata?.plan_id || '';
          const planName = match.metadata?.plan_name || '';
          const isPremium = planId.startsWith('premium') || ['full cycle', 'essay only', 'starter'].includes(planName.toLowerCase());
          if (isPremium) {
            // Check if this payment was already recorded and refunded
            const { rows: existing } = await pool.query(`SELECT id, status FROM payments WHERE stripe_session_id = $1`, [match.id]);
            if (existing.length === 0) {
              // Record the payment
              await pool.query(
                `INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, currency, status, plan_id, plan_name, metadata) VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9)
                 ON CONFLICT (stripe_session_id) DO NOTHING`,
                [userId, match.id, match.payment_intent || null, match.customer || null, match.amount_total || 0, match.currency || 'usd', planId, planName || 'Unknown', JSON.stringify(match.metadata || {})]
              );
              hasPendingPremiumPayment = true;
            } else if (existing[0].status === 'succeeded') {
              // Payment exists and not refunded — still pending
              hasPendingPremiumPayment = true;
            }
            // If status is 'refunded' or 'refund_failed', don't set hasPendingPremiumPayment
            if (subStatus === 'free') {
              await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year', stripe_customer_id = $2 WHERE id = $1`, [userId, match.customer || null]);
              subStatus = 'pro';
            }
          } else if (subStatus === 'free') {
            await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year', stripe_customer_id = $2 WHERE id = $1`, [userId, match.customer || null]);
            subStatus = 'pro';
          }
        }
      } catch (stripeErr: any) {
        console.error(`[ExpertStatus] Stripe API error:`, stripeErr.message);
      }
    }

    // ── past_sessions_count (computed once, used by every return path) ──
    // The "View past sessions" link on holding screens reads this. It's
    // the count of assignments in active/completed/paused that AREN'T
    // the student's most-recent assignment-of-any-status. Computed
    // before Step 3 so all paths return it; previously this was only
    // computed inside Step 4, which meant when /expert-portal auto-
    // reverted subscription_status='premium' → 'pro' (after sessions
    // wrap up), Step 3 fired, the field was missing, and the link
    // disappeared on refresh.
    const mostRecentAnyRes = await pool.query(
      `SELECT id FROM ep_assignments
        WHERE student_id = $1
          AND status IN ('active','completed','pending_acceptance','paused')
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as any[] }));
    const currentAssignId = (mostRecentAnyRes as any).rows[0]?.id ?? null;
    const pastCountRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ep_assignments
        WHERE student_id = $1
          AND status IN ('active','completed','paused')
          AND id <> COALESCE($2::int, -1)`,
      [userId, currentAssignId],
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const past_sessions_count = (pastCountRes as any).rows[0]?.cnt ?? 0;

    // Step 3: If not premium and no pending payment, return plans state
    if (subStatus !== 'premium' && !hasPendingPremiumPayment) {
      // Check for existing assignments (past premium user)
      const { rows: anyAssign } = await pool.query(
        `SELECT id, status FROM ep_assignments WHERE student_id = $1 AND status IN ('active','completed','pending_acceptance','paused') ORDER BY created_at DESC LIMIT 1`, [userId]
      );
      if (anyAssign.length > 0) {
        const a = anyAssign[0];
        if (a.status === 'active') return NextResponse.json({ state: 'active', past_sessions_count });
        if (a.status === 'completed') return NextResponse.json({ state: 'completed', past_sessions_count });
        if (a.status === 'pending_acceptance') return NextResponse.json({ state: 'pending', assignment: a, past_sessions_count });
        if (a.status === 'paused') return NextResponse.json({ state: 'active', past_sessions_count });
      }
      return NextResponse.json({ state: 'plans', subscription_status: subStatus, past_sessions_count });
    }

    // Step 4: Check assignments
    const { rows: assignRows } = await pool.query(`
      SELECT a.id, a.plan, a.sessions_total, a.sessions_used, a.status,
             ec.display_name AS counselor_name
      FROM ep_assignments a
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      WHERE a.student_id = $1 AND a.status IN ('active','completed','pending_acceptance','paused')
      ORDER BY a.created_at DESC LIMIT 1
    `, [userId]);

    if (assignRows.length > 0) {
      const a = assignRows[0];
      if (a.status === 'active') return NextResponse.json({ state: 'active', assignment: a, counselor_name: a.counselor_name, past_sessions_count });
      if (a.status === 'completed') return NextResponse.json({ state: 'completed', assignment: a, counselor_name: a.counselor_name, past_sessions_count });
      if (a.status === 'paused') return NextResponse.json({ state: 'active', assignment: a, counselor_name: a.counselor_name, past_sessions_count });
      if (a.status === 'pending_acceptance') return NextResponse.json({ state: 'pending', assignment: a, counselor_name: a.counselor_name, past_sessions_count });
    }

    // Has pending premium payment but no assignment yet
    if (hasPendingPremiumPayment) {
      return NextResponse.json({ state: 'pending', assignment: null, awaiting_assignment: true, past_sessions_count });
    }

    return NextResponse.json({ state: 'plans', subscription_status: subStatus, past_sessions_count });
  } catch (err: any) {
    console.error('[ExpertStatus] Error:', err.message);
    return NextResponse.json({ state: 'plans', error: err.message, past_sessions_count: 0 });
  }
}
