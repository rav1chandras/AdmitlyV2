import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getJourney, upsertJourney, JOURNEY_DEFAULTS } from '@/lib/db_journey';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureSchema();
    const journey = await getJourney(parseInt(session.user.id));
    return NextResponse.json(journey ?? JOURNEY_DEFAULTS);
  } catch (err) {
    console.error('[Journey GET]', err);
    return NextResponse.json(JOURNEY_DEFAULTS);
  }
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureSchema();
    const data = await request.json();
    const saved = await upsertJourney(parseInt(session.user.id), data);
    return NextResponse.json(saved);
  } catch (err) {
    console.error('[Journey PUT]', err);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
}
