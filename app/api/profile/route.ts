import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getProfile, upsertProfile, logScoreHistory, getScoreHistory } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await ensureSchema();

    const userId = parseInt(session.user.id, 10);
    const { searchParams } = new URL(request.url);

    // ?history=1 → return weekly score history
    if (searchParams.get('history') === '1') {
      const history = await getScoreHistory(userId);
      return NextResponse.json(history);
    }

    const profile = await getProfile(userId);
    return NextResponse.json(profile || {
      gpa: 0, sat: null, act: null, ap_offered: 0, ap_taken: 0,
      ec_tier: 6, leadership_roles: 0, major_multiplier: 1.0,
      is_ed: false, is_athlete: false, is_legacy: false, final_score: 0,
    });
  } catch (error) {
    console.error('[Profile GET] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const numericUserId = parseInt(session.user.id, 10);

    const profile = await upsertProfile(numericUserId, data);
    if (!profile) {
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }

    // Log score history whenever profile is saved with a real score
    if (data.final_score && data.final_score > 0) {
      logScoreHistory(numericUserId, data.final_score).catch(console.error);
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error('[Profile POST] Database Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
