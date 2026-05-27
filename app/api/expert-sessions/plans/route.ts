import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const pool = getPool();
    const plans = await pool.query(`SELECT id, name, sessions, price_cents, discounted_price_cents, description, features FROM ep_plans WHERE is_active = true ORDER BY sort_order, id`);
    const counselors = await pool.query(`SELECT ec.display_name, ec.title, ec.specialties, ec.years_experience, ec.total_students FROM ep_counselors ec JOIN users u ON u.id = ec.user_id WHERE u.role = 'counselor' ORDER BY ec.years_experience DESC LIMIT 3`);
    return NextResponse.json({ plans: plans.rows, counselors: counselors.rows });
  } catch {
    return NextResponse.json({ plans: [], counselors: [] });
  }
}
