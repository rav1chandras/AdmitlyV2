import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSettings, upsertSettings, SETTINGS_DEFAULTS } from '@/lib/db_settings';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureSchema();
    const userId = parseInt(session.user.id);
    const settings = await getSettings(userId);
    return NextResponse.json(settings ?? { ...SETTINGS_DEFAULTS });
  } catch (err) {
    console.error('[Settings GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureSchema();
    const userId = parseInt(session.user.id);
    const data = await request.json();
    const saved = await upsertSettings(userId, data);
    return NextResponse.json(saved);
  } catch (err: any) {
    console.error('[Settings PUT]', err?.message, err?.detail);
    return NextResponse.json({ error: 'Save failed', detail: err?.message }, { status: 500 });
  }
}
