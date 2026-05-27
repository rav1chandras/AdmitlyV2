import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/connect
 * Creates a Stripe Connect Express account for the counselor and returns an onboarding URL.
 * 
 * GET /api/stripe/connect
 * Returns the counselor's Stripe Connect status.
 */

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id as string);
    const role = (session.user as any).role;
    if (role !== 'counselor') return NextResponse.json({ error: 'Counselors only' }, { status: 403 });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });

    const pool = getPool();
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    // Check if counselor already has a Connect account
    const { rows: counselorRows } = await pool.query(
      `SELECT id, stripe_connect_account_id, display_name FROM ep_counselors WHERE user_id = $1`, [userId]
    );
    if (!counselorRows.length) return NextResponse.json({ error: 'Counselor not found' }, { status: 404 });

    const counselor = counselorRows[0];
    let connectAccountId = counselor.stripe_connect_account_id;

    if (!connectAccountId) {
      // Create new Connect Express account
      const account = await stripe.accounts.create({
        type: 'express',
        email: session.user.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          counselor_id: String(counselor.id),
          user_id: String(userId),
        },
      });
      connectAccountId = account.id;

      // Save to DB
      await pool.query(
        `UPDATE ep_counselors SET stripe_connect_account_id = $1 WHERE id = $2`,
        [connectAccountId, counselor.id]
      );
    }

    // Create account link for onboarding
    const origin = req.nextUrl.origin;
    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: `${origin}/settings/counselor?stripe=refresh`,
      return_url: `${origin}/settings/counselor?stripe=success`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err: any) {
    console.error('[StripeConnect] Onboard error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id as string);
    const role = (session.user as any).role;
    if (role !== 'counselor') return NextResponse.json({ error: 'Counselors only' }, { status: 403 });

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT stripe_connect_account_id FROM ep_counselors WHERE user_id = $1`, [userId]
    );
    if (!rows.length) return NextResponse.json({ connected: false });

    const connectId = rows[0].stripe_connect_account_id;
    if (!connectId) return NextResponse.json({ connected: false });

    // Check account status with Stripe
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ connected: false });

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);
    const account = await stripe.accounts.retrieve(connectId);

    const ready = account.charges_enabled && account.payouts_enabled;
    return NextResponse.json({
      connected: true,
      ready,
      account_id: connectId,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    });
  } catch (err: any) {
    console.error('[StripeConnect] Status error:', err.message);
    return NextResponse.json({ connected: false, error: err.message });
  }
}
