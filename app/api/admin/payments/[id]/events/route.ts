/**
 * GET /api/admin/payments/[id]/events
 *
 * Returns the Stripe-event timeline for a single payment, in chronological
 * order. Powers the "Details" modal on the admin Payments tab so admins
 * can see refund issued / refund failed / dispute opened / dispute won-lost
 * without bouncing to the Stripe dashboard.
 *
 * Auth: admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-helpers';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const paymentId = parseInt(params.id, 10);
  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, payment_id, stripe_event_id, event_type, status,
              amount_cents, reason, details, created_at
         FROM payment_events
        WHERE payment_id = $1
        ORDER BY created_at ASC`,
      [paymentId],
    );
    return NextResponse.json({ events: result.rows });
  } catch (err: any) {
    // Degrade gracefully if the migration hasn't been applied yet.
    if (err?.code === '42P01') {
      return NextResponse.json({
        events: [],
        warning: 'payment_events table missing — run migrations/006_phase_b.sql',
      });
    }
    console.error('[admin/payments/events] failed:', err);
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
  }
}
