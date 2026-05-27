/**
 * /api/profile/activities — CRUD for the Profile Builder's Activities tab.
 *
 *   GET                            → list activities for the signed-in user
 *   POST   { activity fields }     → create
 *   PATCH  { id, ...fields }       → update (partial)
 *   DELETE { id }                  → remove
 *
 * Auth: any signed-in user. Each row is keyed to session.user.id, so a
 * user can only touch their own activities — no admin override needed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set([
  'leadership','community','arts','academic','athletics','work','other',
]);

function normalize(body: any) {
  const name = (body.name ?? '').toString().trim().slice(0, 120);
  const category = VALID_CATEGORIES.has(body.category) ? body.category : 'other';
  const role = body.role ? body.role.toString().slice(0, 80) : null;
  const hpw = Math.max(0, Math.min(40, parseInt(body.hours_per_week, 10) || 0));
  const startG = body.start_grade != null ? Math.max(7, Math.min(13, parseInt(body.start_grade, 10))) : null;
  const endG = body.end_grade != null ? Math.max(7, Math.min(13, parseInt(body.end_grade, 10))) : null;
  const isCurrent = body.is_current === false ? false : true;
  const description = body.description ? body.description.toString().slice(0, 280) : null;
  return { name, category, role, hpw, startG, endG, isCurrent, description };
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
      `SELECT id, name, category, role, hours_per_week, start_grade, end_grade,
              is_current, description, sort_order, created_at, updated_at
         FROM student_activities
        WHERE user_id = $1
        ORDER BY sort_order ASC, created_at ASC`,
      [userId]
    );
    return NextResponse.json({ activities: rows });
  } catch (err: any) {
    // Table may not exist on older DBs — return empty list with a hint
    if (err?.code === '42P01') {
      return NextResponse.json({
        activities: [],
        warning: 'student_activities table missing — run migrations/009_student_activities.sql',
      });
    }
    console.error('[activities GET] error:', err);
    return NextResponse.json({ error: 'Failed to load activities.' }, { status: 500 });
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
  if (!n.name) {
    return NextResponse.json({ error: 'Activity name is required.' }, { status: 400 });
  }
  const pool = getPool();
  try {
    await ensureSchema();
    // Cap at 10 activities per user — keeps Top Themes meaningful
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM student_activities WHERE user_id = $1`, [userId]
    );
    if (countRows[0].c >= 10) {
      return NextResponse.json({ error: 'Maximum 10 activities — remove one to add another.' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO student_activities
         (user_id, name, category, role, hours_per_week, start_grade, end_grade, is_current, description, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, category, role, hours_per_week, start_grade, end_grade,
                 is_current, description, sort_order, created_at, updated_at`,
      [userId, n.name, n.category, n.role, n.hpw, n.startG, n.endG, n.isCurrent, n.description, countRows[0].c],
    );
    return NextResponse.json({ activity: rows[0] });
  } catch (err) {
    console.error('[activities POST] error:', err);
    return NextResponse.json({ error: 'Failed to create activity.' }, { status: 500 });
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
  if (!n.name) {
    return NextResponse.json({ error: 'Activity name is required.' }, { status: 400 });
  }
  const pool = getPool();
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE student_activities SET
         name = $3, category = $4, role = $5, hours_per_week = $6,
         start_grade = $7, end_grade = $8, is_current = $9, description = $10,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, category, role, hours_per_week, start_grade, end_grade,
                 is_current, description, sort_order, created_at, updated_at`,
      [id, userId, n.name, n.category, n.role, n.hpw, n.startG, n.endG, n.isCurrent, n.description],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
    }
    return NextResponse.json({ activity: rows[0] });
  } catch (err) {
    console.error('[activities PATCH] error:', err);
    return NextResponse.json({ error: 'Failed to update activity.' }, { status: 500 });
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
      `DELETE FROM student_activities WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[activities DELETE] error:', err);
    return NextResponse.json({ error: 'Failed to delete activity.' }, { status: 500 });
  }
}
