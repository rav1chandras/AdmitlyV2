/**
 * seed-deadlines.ts — Seeds the college_deadlines table from CSV.
 *
 * The college_deadlines table is the single source of truth for
 * application deadline templates. It maps ope6_id → deadline rows,
 * so the deadlines API can JOIN directly against the user's saved
 * colleges (which also carry master_id / ope6_id).
 *
 * Runs once per cold start. Safe to re-run (TRUNCATE + re-insert).
 */

import { getPool } from '@/lib/db';
import * as fs from 'fs';
import * as path from 'path';

let _seeded = false;

export async function ensureCollegeDeadlines(): Promise<void> {
  if (_seeded) return;
  const pool = getPool();

  try {
    // Check if already populated
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM college_deadlines');
    if (parseInt(rows[0].cnt) > 50) {
      _seeded = true;
      return;
    }

    // Read CSV
    const csvPath = path.join(process.cwd(), 'data', 'college_deadlines.csv');
    if (!fs.existsSync(csvPath)) {
      console.warn('[seed-deadlines] CSV not found at', csvPath);
      _seeded = true;
      return;
    }

    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());

    // Parse CSV (format: ope6_id,"name",deadline_type,due_date,"description")
    const rows2: { ope6: number | null; name: string; type: string; date: string; desc: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Handle quoted fields
      const m = line.match(/^(\d*),\"?([^\"]+)\"?,([^,]+),([^,]+),\"?([^\"]+)\"?$/);
      if (!m) continue;
      rows2.push({
        ope6: m[1] ? parseInt(m[1]) : null,
        name: m[2],
        type: m[3],
        date: m[4],
        desc: m[5],
      });
    }

    if (rows2.length === 0) {
      console.warn('[seed-deadlines] No rows parsed from CSV');
      _seeded = true;
      return;
    }

    // Truncate and re-insert (fast, avoids stale data)
    await pool.query('TRUNCATE college_deadlines RESTART IDENTITY');

    // Batch insert in chunks of 50
    const CHUNK = 50;
    for (let i = 0; i < rows2.length; i += CHUNK) {
      const chunk = rows2.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: any[] = [];
      let pi = 1;

      for (const r of chunk) {
        values.push(`($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4})`);
        params.push(r.ope6, r.name, r.type, r.date, r.desc);
        pi += 5;
      }

      await pool.query(
        `INSERT INTO college_deadlines (ope6_id, college_name, deadline_type, due_date, description)
         VALUES ${values.join(',')}`,
        params
      );
    }

    console.log(`[seed-deadlines] Loaded ${rows2.length} deadline rows for ${new Set(rows2.map(r => r.ope6 || r.name)).size} schools`);
    _seeded = true;
  } catch (err: any) {
    console.error('[seed-deadlines] Failed:', err.message);
    // Non-fatal — the API will just not have template deadlines
    _seeded = true;
  }
}
