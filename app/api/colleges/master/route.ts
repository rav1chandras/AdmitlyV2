import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchMasterCollegesDB, getMasterCollegeById } from '@/lib/db';
import { ensureCollegesMaster } from '@/lib/seed-colleges';

export const dynamic = 'force-dynamic';

// GET /api/colleges/master?q=harvard       — typeahead search
// GET /api/colleges/master?id=123          — single college by ope6_id
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Auto-seed colleges_master from CSV if empty (works on Vercel + Docker)
    await ensureCollegesMaster();

    const { searchParams } = new URL(request.url);
    const q  = searchParams.get('q') ?? '';
    const id = searchParams.get('id');

    if (id) {
      const college = await getMasterCollegeById(parseInt(id, 10));
      return NextResponse.json(college ?? null);
    }

    if (!q.trim()) return NextResponse.json([]);

    const results = await searchMasterCollegesDB(q.trim(), 10);
    return NextResponse.json(results);
  } catch (error) {
    console.error('[Master GET] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
