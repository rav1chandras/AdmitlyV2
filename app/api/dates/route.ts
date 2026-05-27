import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getKeyDates, upsertKeyDate, updateKeyDate, deleteKeyDate } from '@/lib/db';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// GET — public, returns all active dates
export async function GET() {
  try {
    const dates = await getKeyDates(true);
    return NextResponse.json(dates);
  } catch { return NextResponse.json([]); }
}

// POST — admin only, create new date
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const data = await request.json();
  const result = await upsertKeyDate(data);
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'Failed' }, { status: 500 });
}

// PATCH — admin only, update existing date
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id, ...data } = await request.json();
  const result = await updateKeyDate(id, data);
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'Failed' }, { status: 500 });
}

// DELETE — admin only
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await request.json();
  const ok = await deleteKeyDate(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Failed' }, { status: 500 });
}
