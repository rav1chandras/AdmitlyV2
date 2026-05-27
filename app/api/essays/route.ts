import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEssays, getEssayById, createEssay, updateEssay, deleteEssay } from '@/lib/db_essays';
import { ensureSchema } from '@/lib/db_schema';

export const dynamic = 'force-dynamic';

// ── GET: list all essays OR fetch single by ?id= ───────────────────────────
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const action = searchParams.get('action');

    // Voice samples
    if (action === 'voice_samples') {
      const pool = (await import('@/lib/db')).getPool();
      try {
        await pool.query(`ALTER TABLE student_settings ADD COLUMN IF NOT EXISTS voice_samples JSONB DEFAULT '[]'`).catch(()=>{});
        const { rows } = await pool.query(`SELECT voice_samples FROM student_settings WHERE user_id = $1`, [userId]);
        const samples = rows[0]?.voice_samples || [];
        return NextResponse.json({ samples });
      } catch {
        return NextResponse.json({ samples: [] });
      }
    }

    if (id) {
      // Single essay by ID
      const essay = await getEssayById(parseInt(id), userId);
      if (!essay) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(essay);
    }

    // All essays for user
    const essays = await getEssays(userId);
    return NextResponse.json(essays);
  } catch (error) {
    console.error('[Essays GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST: create a new essay draft ────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const data = await request.json();

    // Save voice samples
    if (data.action === 'save_voice_samples') {
      const pool = (await import('@/lib/db')).getPool();
      try {
        await pool.query(`ALTER TABLE student_settings ADD COLUMN IF NOT EXISTS voice_samples JSONB DEFAULT '[]'`).catch(()=>{});
        await pool.query(
          `INSERT INTO student_settings (user_id, voice_samples) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET voice_samples = $2`,
          [userId, JSON.stringify(data.samples || [])]
        );
        return NextResponse.json({ ok: true });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
    }

    const essay = await createEssay(userId, {
      college_id:      data.college_id ?? null,
      college_name:    data.college_name ?? null,
      essay_type:      data.essay_type ?? 'personal_statement',
      topic:           data.topic ?? '',
      draft_text:      data.draft_text ?? '',
      word_count:      data.word_count ?? 0,
      prompt_source:   data.prompt_source ?? 'Common App',
      audience:        data.audience ?? 'Admissions Officer',
      tone_chips:      data.tone_chips ?? 'Reflective',
      formality:       data.formality ?? 3,
      word_limit:      data.word_limit ?? 650,
      narrative_focus: data.narrative_focus ?? 2,
      status:          data.status ?? 'draft',
    });

    if (!essay) return NextResponse.json({ error: 'Failed to create essay' }, { status: 500 });
    return NextResponse.json(essay, { status: 201 });
  } catch (error) {
    console.error('[Essays POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PUT: update an existing essay draft ───────────────────────────────────
export async function PUT(request: NextRequest) {
  try {
    await ensureSchema();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const { id, ...data } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const essay = await updateEssay(parseInt(id), userId, data);
    if (!essay) return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 });
    return NextResponse.json(essay);
  } catch (error) {
    console.error('[Essays PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE: remove an essay draft ─────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await deleteEssay(parseInt(id), userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Essays DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH: toggle share or update specific fields ─────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    await ensureSchema();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const body = await request.json();
    const { id, shared_with_counselor } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const res = await pool.query(
      'UPDATE essay_drafts SET shared_with_counselor = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [!!shared_with_counselor, parseInt(id), userId]
    );
    if (!res.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(res.rows[0]);
  } catch (error) {
    console.error('[Essays PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
