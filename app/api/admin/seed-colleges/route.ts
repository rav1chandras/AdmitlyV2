import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureCollegesMaster, reloadCollegesMaster } from '@/lib/seed-colleges';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST: seed or force-reload colleges_master */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const force = new URL(request.url).searchParams.get('force') === 'true';

    if (force) {
      const result = await reloadCollegesMaster();
      return NextResponse.json({ ok: true, ...result, force: true });
    }

    await ensureCollegesMaster();
    const pool = getPool();
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM colleges_master');
    return NextResponse.json({ ok: true, count: rows[0].cnt });
  } catch (err: any) {
    console.error('[seed-colleges API]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** GET: check current count */
export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM colleges_master');
    return NextResponse.json({ count: rows[0].cnt });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
