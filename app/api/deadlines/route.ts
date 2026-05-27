import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';
import { ensureCollegeDeadlines } from '@/lib/seed-deadlines';

export const dynamic = 'force-dynamic';

/**
 * GET /api/deadlines
 *
 * Returns the student's personal deadlines (student_deadlines) after
 * auto-syncing from the college_deadlines reference table.
 *
 * Sync logic:
 *   1. JOIN user's saved colleges → college_deadlines via ope6_id (master_id)
 *   2. Insert any missing deadlines into student_deadlines
 *   3. Remove orphaned auto-deadlines for colleges the user removed
 *   4. Always add universal deadlines (FAFSA, CSS)
 *   5. Return all student_deadlines
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureSchema();
    await ensureCollegeDeadlines();

    const userId = parseInt(session.user.id);
    const pool = getPool();

    // ── Ensure dedup index (safe to run repeatedly) ──
    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_student_deadlines_dedup
        ON student_deadlines (user_id, college_name, deadline_type, due_date)
      `);
    } catch {
      // Duplicates exist — clean them up
      await pool.query(`
        DELETE FROM student_deadlines a USING student_deadlines b
        WHERE a.id > b.id
          AND a.user_id = b.user_id AND a.college_name = b.college_name
          AND a.deadline_type = b.deadline_type AND a.due_date = b.due_date
      `).catch(() => {});
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_student_deadlines_dedup
        ON student_deadlines (user_id, college_name, deadline_type, due_date)
      `).catch(() => {});
    }

    // ── Step 1: Find deadlines to sync ──
    // JOIN user's colleges (via master_id = ope6_id) against college_deadlines
    const { rows: toSync } = await pool.query(`
      SELECT cd.college_name, cd.deadline_type, cd.due_date, cd.description
      FROM colleges c
      JOIN college_deadlines cd ON cd.ope6_id = c.master_id
      WHERE c.user_id = $1
        AND c.master_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM student_deadlines sd
          WHERE sd.user_id = $1
            AND sd.college_name = cd.college_name
            AND sd.deadline_type = cd.deadline_type
            AND sd.due_date = cd.due_date
        )
    `, [userId]).catch(() => ({ rows: [] }));

    // ── Step 2: Add universal deadlines (FAFSA, CSS) if missing ──
    const { rows: universals } = await pool.query(`
      SELECT cd.college_name, cd.deadline_type, cd.due_date, cd.description
      FROM college_deadlines cd
      WHERE cd.ope6_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM student_deadlines sd
          WHERE sd.user_id = $1
            AND sd.college_name = cd.college_name
            AND sd.deadline_type = cd.deadline_type
            AND sd.due_date = cd.due_date
        )
    `, [userId]).catch(() => ({ rows: [] }));

    const allToInsert = [...toSync, ...universals];

    // ── Step 3: Batch insert ──
    if (allToInsert.length > 0) {
      try {
        const values: string[] = [];
        const params: any[] = [userId];
        let pi = 2;
        for (const r of allToInsert) {
          values.push(`($1, $${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, 'auto')`);
          params.push(r.college_name, r.deadline_type, r.due_date, r.description || '');
          pi += 4;
        }
        await pool.query(
          `INSERT INTO student_deadlines (user_id, college_name, deadline_type, due_date, description, source)
           VALUES ${values.join(',')}
           ON CONFLICT (user_id, college_name, deadline_type, due_date) DO NOTHING`,
          params
        );
      } catch (e: any) {
        console.error('[Deadlines] batch insert failed (non-fatal):', e.message);
      }
    }

    // ── Step 4: Clean up orphaned auto-deadlines ──
    // Remove auto deadlines whose college is no longer in the user's list
    await pool.query(`
      DELETE FROM student_deadlines sd
      WHERE sd.user_id = $1
        AND sd.source = 'auto'
        AND sd.college_name != 'ALL'
        AND NOT EXISTS (
          SELECT 1 FROM colleges c
          JOIN college_deadlines cd ON cd.ope6_id = c.master_id
          WHERE c.user_id = $1
            AND cd.college_name = sd.college_name
        )
    `, [userId]).catch((e: any) => console.warn('[Deadlines] orphan cleanup failed:', e.message));

    // ── Step 5: Return all ──
    const { rows: all } = await pool.query(
      'SELECT * FROM student_deadlines WHERE user_id = $1 ORDER BY due_date',
      [userId]
    );
    return NextResponse.json(all);

  } catch (err: any) {
    console.error('[Deadlines GET]', err.message);
    // Fallback: return existing deadlines even if sync failed
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.id) {
        const pool = getPool();
        const { rows } = await pool.query(
          'SELECT * FROM student_deadlines WHERE user_id = $1 ORDER BY due_date',
          [parseInt(session.user.id)]
        );
        return NextResponse.json(rows);
      }
    } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — create custom deadline
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const body = await req.json();
    const pool = getPool();

    const source = body.source === 'admin_saved' ? 'admin_saved' : 'custom';
    const { rows } = await pool.query(
      `INSERT INTO student_deadlines (user_id, college_name, deadline_type, due_date, description, source, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, body.college_name || 'Custom', body.deadline_type || 'Custom', body.due_date, body.description || '', source, body.notes || '', body.status || 'upcoming']
    );
    return NextResponse.json(rows[0]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH — update status or notes
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const body = await req.json();
    const pool = getPool();

    if (body.status) {
      const { rows } = await pool.query(
        'UPDATE student_deadlines SET status=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *',
        [body.status, body.id, userId]
      );
      return NextResponse.json(rows[0] || { error: 'Not found' });
    }
    return NextResponse.json({ error: 'No update fields' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — remove a deadline
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const pool = getPool();
    await pool.query('DELETE FROM student_deadlines WHERE id=$1 AND user_id=$2', [parseInt(id), userId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
