import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json([], { status: 401 });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT score, saved_at FROM score_history WHERE user_id = $1 ORDER BY saved_at DESC LIMIT 30`,
      [parseInt(session.user.id)]
    );

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[score/history] error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
