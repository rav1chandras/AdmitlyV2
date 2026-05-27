/**
 * db_essays.ts
 * Database functions for the Essays feature.
 * Uses the same pg Pool from db.ts (re-exported via pool getter).
 */

import { Pool } from 'pg';

// ── Reuse the same pool logic as db.ts ──────────────────────────────────────
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('POSTGRES_URL environment variable is not set');
    pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface EssayDraft {
  id: number;
  user_id: number;
  college_id: number | null;
  college_name: string | null;
  essay_type: string;
  topic: string;
  draft_text: string;
  word_count: number;
  prompt_source: string;
  audience: string;
  tone_chips: string;
  formality: number;
  word_limit: number;
  narrative_focus: number;
  status: 'draft' | 'submitted';
  created_at: Date;
  updated_at: Date;
}

export interface CreateEssayData {
  college_id?: number | null;
  college_name?: string | null;
  essay_type: string;
  topic: string;
  draft_text: string;
  word_count: number;
  prompt_source?: string;
  audience?: string;
  tone_chips?: string;
  formality?: number;
  word_limit?: number;
  narrative_focus?: number;
  status?: 'draft' | 'submitted';
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function getEssays(userId: number): Promise<EssayDraft[]> {
  const db = getPool();
  const res = await db.query(
    `SELECT ed.*, c.name AS college_name_live
     FROM essay_drafts ed
     LEFT JOIN colleges c ON c.id = ed.college_id AND c.user_id = $1
     WHERE ed.user_id = $1
     ORDER BY ed.updated_at DESC`,
    [userId]
  );
  return res.rows.map(r => ({
    ...r,
    // Prefer live college name from join; fall back to cached college_name
    college_name: r.college_name_live ?? r.college_name ?? null,
  }));
}

export async function getEssayById(id: number, userId: number): Promise<EssayDraft | null> {
  const db = getPool();
  const res = await db.query(
    'SELECT * FROM essay_drafts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return res.rows[0] ?? null;
}

export async function createEssay(userId: number, data: CreateEssayData): Promise<EssayDraft | null> {
  const db = getPool();
  const res = await db.query(
    `INSERT INTO essay_drafts
       (user_id, college_id, college_name, essay_type, topic, draft_text,
        word_count, prompt_source, audience, tone_chips, formality,
        word_limit, narrative_focus, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      userId,
      data.college_id ?? null,
      data.college_name ?? null,
      data.essay_type,
      (data.topic || '').slice(0, 3000),
      data.draft_text,
      data.word_count,
      data.prompt_source ?? 'Common App',
      data.audience ?? 'Admissions Officer',
      data.tone_chips ?? 'Reflective',
      data.formality ?? 3,
      data.word_limit ?? 650,
      data.narrative_focus ?? 2,
      data.status ?? 'draft',
    ]
  );
  return res.rows[0] ?? null;
}

export async function updateEssay(
  id: number,
  userId: number,
  data: Partial<CreateEssayData>
): Promise<EssayDraft | null> {
  const db = getPool();
  const res = await db.query(
    `UPDATE essay_drafts SET
       college_id       = COALESCE($1, college_id),
       college_name     = COALESCE($2, college_name),
       essay_type       = COALESCE($3, essay_type),
       topic            = COALESCE($4, topic),
       draft_text       = COALESCE($5, draft_text),
       word_count       = COALESCE($6, word_count),
       prompt_source    = COALESCE($7, prompt_source),
       audience         = COALESCE($8, audience),
       tone_chips       = COALESCE($9, tone_chips),
       formality        = COALESCE($10, formality),
       word_limit       = COALESCE($11, word_limit),
       narrative_focus  = COALESCE($12, narrative_focus),
       status           = COALESCE($13, status),
       updated_at       = CURRENT_TIMESTAMP
     WHERE id = $14 AND user_id = $15
     RETURNING *`,
    [
      data.college_id,
      data.college_name,
      data.essay_type,
      data.topic === undefined ? undefined : (data.topic || '').slice(0, 3000),
      data.draft_text,
      data.word_count,
      data.prompt_source,
      data.audience,
      data.tone_chips,
      data.formality,
      data.word_limit,
      data.narrative_focus,
      data.status,
      id,
      userId,
    ]
  );
  return res.rows[0] ?? null;
}

export async function deleteEssay(id: number, userId: number): Promise<boolean> {
  const db = getPool();
  await db.query('DELETE FROM essay_drafts WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
}
