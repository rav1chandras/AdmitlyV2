import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ADMITLY_PLANS = [
  {
    id: 'pro_onetime',
    name: 'Admitly Pro',
    price_cents: 12900,   // $129 regular price
    stripe_price_id: process.env.STRIPE_PRICE_PRO ?? '',
  },
];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plan_id } = await request.json();

    let planName = '';
    let priceCents = 0;
    let resolvedPlanId = plan_id;

    // Check if it's a premium plan (from expert-sessions checkout)
    if (plan_id?.startsWith('premium_')) {
      // ── Gate: student must be pro to purchase premium ──
      try {
        const { getPool } = await import('@/lib/db');
        const pool = getPool();
        const { rows: userCheck } = await pool.query(
          `SELECT subscription_status FROM users WHERE id = $1`, [parseInt(session.user.id as string)]
        );
        const status = userCheck[0]?.subscription_status || 'free';
        // Also check if pro payment was refunded
        const { rows: proPayment } = await pool.query(
          `SELECT status FROM payments WHERE user_id = $1 AND (plan_id LIKE 'pro%' OR LOWER(plan_name) LIKE '%pro%') ORDER BY created_at DESC LIMIT 1`,
          [parseInt(session.user.id as string)]
        );
        const proRefunded = proPayment.length > 0 && (proPayment[0].status === 'refunded' || proPayment[0].status === 'disputed');
        if (status === 'free' || proRefunded) {
          return NextResponse.json({ error: 'Pro subscription required to purchase premium plans. Please upgrade to Pro first.' }, { status: 403 });
        }
      } catch {}

      const dbPlanId = plan_id.replace('premium_', '');
      try {
        const { getPool } = await import('@/lib/db');
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT id, name, price_cents, discounted_price_cents FROM ep_plans WHERE id = $1`,
          [parseInt(dbPlanId)]
        );
        if (rows[0]) {
          planName = rows[0].name;
          priceCents = rows[0].discounted_price_cents || rows[0].price_cents;
          resolvedPlanId = plan_id;
        }
      } catch {}
    }

    // Fallback to static plans
    if (!planName) {
      const plan = ADMITLY_PLANS.find(p => p.id === plan_id) ?? ADMITLY_PLANS[0];
      planName = plan.name;
      priceCents = plan.price_cents;
      resolvedPlanId = plan.id;
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured.', dev: true }, { status: 503 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

    console.log('[Stripe checkout] Creating session for user:', {
      id: session.user.id,
      email: session.user.email,
      plan: resolvedPlanId,
      price: priceCents,
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: session.user.email ?? undefined,
      client_reference_id: String(session.user.id),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: priceCents,
            product_data: {
              name: planName,
              description: resolvedPlanId.startsWith('premium_')
                ? `Expert counselor sessions — ${planName} plan`
                : 'Full access to Admitly — AI college matching, essay scoring, expert counselor portal, and more.',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        plan_id: resolvedPlanId,
        plan_name: planName,
        user_id: String(session.user.id),
      },
      allow_promotion_codes: !resolvedPlanId.startsWith('premium_'),  // coupons for Pro only, not premium plans
      success_url: resolvedPlanId.startsWith('premium_')
        ? `${appUrl}/expert-sessions?payment=success`
        : `${appUrl}/dashboard?payment=success`,
      cancel_url: resolvedPlanId.startsWith('premium_')
        ? `${appUrl}/expert-sessions?cancelled=1`
        : `${appUrl}/subscribe?cancelled=1`,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error('[Stripe checkout error]', err);
    return NextResponse.json({ error: err.message ?? 'Failed to create checkout session.' }, { status: 500 });
  }
}
