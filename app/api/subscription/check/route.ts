import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription/check
 * 
 * Single source of truth for subscription status.
 * Checks DB directly. If 'free', checks Stripe for missed payments.
 * Returns: { tier: 'free'|'pro'|'premium', expires_at, synced? }
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ tier: 'free', reason: 'unauthenticated' });
    }
    await ensureSchema();

    const userId = parseInt(session.user.id as string);
    const pool = getPool();

    // Ensure plan_id is varchar
    try { await pool.query(`ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text`); } catch {}

    // Step 1: Check DB
    const { rows } = await pool.query(
      `SELECT subscription_status, subscription_expires_at FROM users WHERE id = $1`, [userId]
    );
    let tier = rows[0]?.subscription_status || 'free';
    let expiresAt = rows[0]?.subscription_expires_at;

    // Step 1b: Derive premium from active/paused assignment
    // Premium is ONLY granted when there's an active or paused assignment
    try {
      const { rows: activeAssign } = await pool.query(
        `SELECT status, end_date FROM ep_assignments WHERE student_id = $1 AND status IN ('active','paused') ORDER BY end_date DESC NULLS LAST LIMIT 1`,
        [userId]
      );
      if (activeAssign.length > 0) {
        // Has active assignment — ensure premium
        if (tier !== 'premium') {
          const endDate = activeAssign[0].end_date ? new Date(activeAssign[0].end_date) : null;
          const newExpiry = endDate ? new Date(endDate.getTime() + 2 * 86400000) : new Date(Date.now() + 365 * 86400000);
          await pool.query(`UPDATE users SET subscription_status = 'premium', subscription_expires_at = $1 WHERE id = $2`, [newExpiry.toISOString(), userId]);
          tier = 'premium';
          expiresAt = newExpiry.toISOString();
        } else if (activeAssign[0].end_date) {
          // Already premium — extend expiry if assignment end_date + 2d is later
          const assignEndGrace = new Date(new Date(activeAssign[0].end_date).getTime() + 2 * 86400000);
          const currentExpiry = expiresAt ? new Date(expiresAt) : new Date(0);
          if (assignEndGrace > currentExpiry) {
            await pool.query(`UPDATE users SET subscription_expires_at = $1 WHERE id = $2`, [assignEndGrace.toISOString(), userId]);
            expiresAt = assignEndGrace.toISOString();
          }
        }
      } else if (tier === 'premium') {
        // No active assignment but marked premium — check if pro payment is still valid
        const { rows: validPro } = await pool.query(
          `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') AND created_at > NOW() - INTERVAL '1 year' ORDER BY created_at DESC LIMIT 1`,
          [userId]
        );
        if (validPro.length > 0) {
          await pool.query(`UPDATE users SET subscription_status = 'pro' WHERE id = $1`, [userId]);
          tier = 'pro';
        } else {
          await pool.query(`UPDATE users SET subscription_status = 'free', subscription_expires_at = NULL WHERE id = $1`, [userId]);
          tier = 'free';
        }
      }
    } catch {}

    // Check expiry
    let expired = false;
    if ((tier === 'pro' || tier === 'premium') && expiresAt && new Date(expiresAt) < new Date()) {
      expired = true;
    }

    // If expired, return the original tier with expired flag
    if (expired) {
      return NextResponse.json({ tier, expired: true, expires_at: expiresAt });
    }

    // If already paid and not expired
    if (tier === 'pro' || tier === 'premium') {
      if (tier === 'premium') {
        return NextResponse.json({ tier, expired: false, expires_at: expiresAt });
      }
      // tier === 'pro' — verify pro payment is actually valid before returning
      const { rows: proCheck } = await pool.query(
        `SELECT status FROM payments WHERE user_id = $1 AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') ORDER BY created_at DESC LIMIT 1`, [userId]
      );
      if (proCheck.length > 0 && (proCheck[0].status === 'refunded' || proCheck[0].status === 'disputed')) {
        // Most recent pro payment was refunded — check for older valid one
        const { rows: olderValid } = await pool.query(
          `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') AND created_at > NOW() - INTERVAL '1 year' ORDER BY created_at DESC LIMIT 1`,
          [userId]
        );
        if (olderValid.length === 0) {
          // No valid pro payment — downgrade to free
          await pool.query(`UPDATE users SET subscription_status = 'free', subscription_expires_at = NULL WHERE id = $1`, [userId]);
          tier = 'free';
          // Don't return — fall through to Step 2
        } else {
          return NextResponse.json({ tier, expires_at: expiresAt });
        }
      } else {
        return NextResponse.json({ tier, expires_at: expiresAt });
      }
    }

    // Step 2: Free user — check for valid pro payment
    // Find the most recent pro payment specifically
    const { rows: proPayRows } = await pool.query(
      `SELECT status, created_at FROM payments WHERE user_id = $1 AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') ORDER BY created_at DESC LIMIT 1`, [userId]
    );
    if (proPayRows.length > 0 && proPayRows[0].status === 'succeeded') {
      // Check if within 1 year
      const payDate = new Date(proPayRows[0].created_at);
      const oneYearLater = new Date(payDate.getTime() + 365 * 86400000);
      if (oneYearLater > new Date()) {
        await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = $2 WHERE id = $1`, [userId, oneYearLater.toISOString()]);
        console.log(`[SubCheck] Upgraded user ${userId} to pro from payment record`);
        return NextResponse.json({ tier: 'pro', synced: true });
      }
    }
    // If most recent pro is refunded/disputed, check for an older valid pro still within 1 year
    if (proPayRows.length > 0 && (proPayRows[0].status === 'refunded' || proPayRows[0].status === 'disputed')) {
      const { rows: olderPro } = await pool.query(
        `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') AND created_at > NOW() - INTERVAL '1 year' ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (olderPro.length > 0) {
        const payDate = new Date(olderPro[0].created_at);
        const oneYearLater = new Date(payDate.getTime() + 365 * 86400000);
        await pool.query(`UPDATE users SET subscription_status = 'pro', subscription_expires_at = $2 WHERE id = $1`, [userId, oneYearLater.toISOString()]);
        console.log(`[SubCheck] Upgraded user ${userId} to pro from older valid payment`);
        return NextResponse.json({ tier: 'pro', synced: true });
      }
      return NextResponse.json({ tier: 'free' });
    }

    // Step 3: Check Stripe API for missed payments
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ tier: 'free' });
    }

    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);
      const sessions = await stripe.checkout.sessions.list({ limit: 20 });

      const match = sessions.data.find(
        s => String(s.client_reference_id) === String(userId) && s.payment_status === 'paid'
      );

      if (match) {
        // Check if this payment was already recorded as refunded/disputed in our DB
        const { rows: existing } = await pool.query(`SELECT id, status FROM payments WHERE stripe_session_id = $1`, [match.id]);
        if (existing.length > 0 && (existing[0].status === 'refunded' || existing[0].status === 'disputed')) {
          // Payment was refunded — don't re-upgrade
          console.log(`[SubCheck] Stripe session ${match.id} found but already ${existing[0].status} — not upgrading`);
          return NextResponse.json({ tier: 'free' });
        }

        // Any Stripe payment makes user at least 'pro' — NOT premium
        await pool.query(
          `UPDATE users SET subscription_status = 'pro', subscription_expires_at = NOW() + INTERVAL '1 year', stripe_customer_id = $2 WHERE id = $1`,
          [userId, match.customer || null]
        );

        // Record payment if missing
        if (existing.length === 0) {
          const planId = match.metadata?.plan_id || '';
          const planName = match.metadata?.plan_name || '';
          await pool.query(`
            INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, currency, status, plan_id, plan_name, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9)
            ON CONFLICT (stripe_session_id) DO NOTHING
          `, [
            userId, match.id, match.payment_intent || null, match.customer || null,
            match.amount_total || 0, match.currency || 'usd',
            planId, planName || 'Unknown', JSON.stringify(match.metadata || {}),
          ]);
        }

        console.log(`[SubCheck] Upgraded user ${userId} to pro from Stripe API`);
        return NextResponse.json({ tier: 'pro', synced: true });
      }
    } catch (e: any) {
      console.error(`[SubCheck] Stripe error:`, e.message);
    }

    return NextResponse.json({ tier: 'free' });
  } catch (err: any) {
    console.error('[SubCheck] Error:', err.message);
    return NextResponse.json({ tier: 'free', error: err.message });
  }
}
