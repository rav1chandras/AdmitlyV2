/**
 * /api/profile/stories — CRUD for Profile Builder Phase 2 personal stories.
 *
 *   GET                          → list stories for signed-in user
 *   POST   { story fields }      → create
 *   PATCH  { id, ...fields }     → partial update
 *   DELETE { id }                → remove
 *
 * Auth: any signed-in user. Rows are keyed to session.user.id.
 * Cap: 6 stories per user — the LLM analysis prompt is sized for this.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

function normalize(body: any) {
  const title = (body.title ?? '').toString().trim().slice(0, 120);
  const summary = (body.summary ?? '').toString().trim().slice(0, 2000);
  const grade = body.grade != null ? Math.max(7, Math.min(13, parseInt(body.grade, 10))) : null;
  const tags = Array.isArray(body.theme_tags)
    ? body.theme_tags
        .map((t: any) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
        .filter((t: string) => t.length > 0 && t.length <= 30)
        .slice(0, 6)
    : [];
  return { title, summary, grade, tags };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const pool = getPool();
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, title, summary, grade, theme_tags, sort_order, created_at, updated_at
         FROM personal_stories
        WHERE user_id = $1
        ORDER BY sort_order ASC, created_at ASC`,
      [userId]
    );
    return NextResponse.json({ stories: rows });
  } catch (err: any) {
    if (err?.code === '42P01') {
      return NextResponse.json({
        stories: [],
        warning: 'personal_stories table missing — run migrations/010_profile_phase2.sql',
      });
    }
    console.error('[stories GET] error:', err);
    return NextResponse.json({ error: 'Failed to load stories.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const body = await request.json();
  const n = normalize(body);
  if (!n.title) {
    return NextResponse.json({ error: 'Story title is required.' }, { status: 400 });
  }
  const pool = getPool();
  try {
    await ensureSchema();
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM personal_stories WHERE user_id = $1`,
      [userId]
    );
    if (countRows[0].c >= 6) {
      return NextResponse.json({ error: 'Maximum 6 stories — remove one to add another.' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO personal_stories (user_id, title, summary, grade, theme_tags, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, summary, grade, theme_tags, sort_order, created_at, updated_at`,
      [userId, n.title, n.summary, n.grade, n.tags, countRows[0].c]
    );
    return NextResponse.json({ story: rows[0] });
  } catch (err) {
    console.error('[stories POST] error:', err);
    return NextResponse.json({ error: 'Failed to create story.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const body = await request.json();
  const id = parseInt(body.id, 10);
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  const n = normalize(body);
  if (!n.title) {
    return NextResponse.json({ error: 'Story title is required.' }, { status: 400 });
  }
  const pool = getPool();
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE personal_stories
          SET title = $3, summary = $4, grade = $5, theme_tags = $6, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title, summary, grade, theme_tags, sort_order, created_at, updated_at`,
      [id, userId, n.title, n.summary, n.grade, n.tags]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Story not found.' }, { status: 404 });
    }
    return NextResponse.json({ story: rows[0] });
  } catch (err) {
    console.error('[stories PATCH] error:', err);
    return NextResponse.json({ error: 'Failed to update story.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id as string, 10);
  const body = await request.json();
  const id = parseInt(body.id, 10);
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  const pool = getPool();
  try {
    await ensureSchema();
    const { rowCount } = await pool.query(
      `DELETE FROM personal_stories WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: 'Story not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[stories DELETE] error:', err);
    return NextResponse.json({ error: 'Failed to delete story.' }, { status: 500 });
  }
}
