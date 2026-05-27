import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/verify
 * 
 * Fallback for when Stripe webhook doesn't fire (e.g., dev without stripe listen).
 * Checks Stripe API directly for the user's recent checkout sessions and upgrades
 * their subscription if a completed payment is found.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    if (!userId || isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }
    const pool = getPool();

    // Ensure plan_id column is varchar
    try { await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text`); } catch {}

    console.log(`[Stripe verify] Checking user ${userId}`);

    // First check if already upgraded
    const { rows: userRows } = await pool.query(
      `SELECT subscription_status, subscription_expires_at FROM users WHERE id = $1`,
      [userId]
    );
    const currentStatus = userRows[0]?.subscription_status || 'free';
    const currentExpiry = userRows[0]?.subscription_expires_at;

    // Check if we have a payment record from webhook
    const { rows: paymentRows } = await pool.query(
      `SELECT id, plan_id, plan_name, status, created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (paymentRows.length > 0) {
      const planId = paymentRows[0].plan_id || '';
      const planName = paymentRows[0].plan_name || '';
      const isPremiumPayment = planId.startsWith('premium') || planName.toLowerCase().includes('premium') 
        || ['full cycle','essay only','starter'].includes(planName.toLowerCase());
      
      if (isPremiumPayment) {
        // Premium payment: do NOT upgrade to premium yet — wait for admin to assign counselor
        // Just ensure student is at least 'pro'
        if (currentStatus === 'free') {
          await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year' WHERE id = $1`, [userId]);
          console.log(`[Stripe verify] User ${userId} upgraded to pro (premium payment pending assignment)`);
        }
        return NextResponse.json({ status: currentStatus === 'free' ? 'pro' : currentStatus, premium_payment: true, awaiting_assignment: true });
      } else {
        // Pro payment — upgrade from free to pro
        if (currentStatus === 'free') {
          await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year' WHERE id = $1`, [userId]);
          console.log(`[Stripe verify] User ${userId} upgraded to pro`);
          return NextResponse.json({ status: 'pro', source: 'payment_record' });
        }
        return NextResponse.json({ status: currentStatus, already_current: true });
      }
    }

    // No payment record — try Stripe API directly
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ status: 'free', error: 'Stripe not configured' });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    // Look for completed checkout sessions for this user
    const sessions = await stripe.checkout.sessions.list({ limit: 10 });
    console.log(`[Stripe verify] Found ${sessions.data.length} sessions. Looking for client_reference_id=${userId}`);
    sessions.data.forEach((s, i) => {
      console.log(`[Stripe verify]   session[${i}]: client_ref=${s.client_reference_id}, payment_status=${s.payment_status}, plan_id=${s.metadata?.plan_id}`);
    });

    const userSession = sessions.data.find(
      s => String(s.client_reference_id) === String(userId) && s.payment_status === 'paid'
    );

    if (userSession) {
      const planId = userSession.metadata?.plan_id || '';
      const planName = userSession.metadata?.plan_name || '';
      const isPremium = planId.startsWith('premium') || ['full cycle','essay only','starter'].includes(planName.toLowerCase());
      const newStatus = isPremium ? 'premium' : 'pro';

      // Upgrade user
      await pool.query(`
        UPDATE users 
        SET subscription_status = $2,
            subscription_expires_at = NOW() + INTERVAL '1 year',
            stripe_customer_id = $3
        WHERE id = $1
      `, [userId, newStatus, userSession.customer || null]);

      // Also record the payment (check for duplicate by stripe_session_id)
      try {
        const { rows: existing } = await pool.query(`SELECT id FROM payments WHERE stripe_session_id = $1`, [userSession.id]);
        if (existing.length === 0) {
          await pool.query(`
            INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, currency, status, plan_id, plan_name, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9)
          `, [
            userId, userSession.id, userSession.payment_intent || null,
            userSession.customer || null,
            userSession.amount_total || 0, userSession.currency || 'usd',
            planId, planName || 'Unknown',
            JSON.stringify(userSession.metadata || {}),
          ]);
          console.log(`[Stripe verify] Payment recorded for user ${userId}`);
        }
      } catch (payErr: any) {
        console.error('[Stripe verify] Payment INSERT failed:', payErr.message);
      }

      console.log(`[Stripe verify] user ${userId} upgraded to ${newStatus} from Stripe API`);
      return NextResponse.json({ status: newStatus, source: 'stripe_api' });
    }

    return NextResponse.json({ status: 'free', message: 'No completed payment found' });
  } catch (err: any) {
    console.error('[Stripe verify error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
