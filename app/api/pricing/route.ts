import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// GET — public, returns current pricing
export async function GET() {
  try {
    const pool = getPool();
    const res = await pool.query('SELECT pro_full_price, pro_discount_price FROM pricing_config WHERE id = 1');
    if (res.rows.length === 0) return NextResponse.json({ pro_full_price: 129, pro_discount_price: 89 });
    return NextResponse.json(res.rows[0]);
  } catch {
    return NextResponse.json({ pro_full_price: 129, pro_discount_price: 89 });
  }
}

// PUT — admin only, update pricing
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { pro_full_price, pro_discount_price } = await request.json();
  const full = Math.max(1, parseInt(pro_full_price) || 129);
  const disc = Math.max(1, parseInt(pro_discount_price) || 89);

  const pool = getPool();
  await pool.query(
    'INSERT INTO pricing_config (id, pro_full_price, pro_discount_price, updated_at) VALUES (1, $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET pro_full_price = $1, pro_discount_price = $2, updated_at = NOW()',
    [full, disc]
  );
  return NextResponse.json({ pro_full_price: full, pro_discount_price: disc });
}
