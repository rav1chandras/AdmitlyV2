/**
 * lib/seed-programs.ts
 * ────────────────────────────────────────────────────────────
 * Reads data/programs_master.csv and loads rows into the
 * programs_master PostgreSQL table. Follows the same pattern
 * as seed-colleges.ts.
 *
 * Called from:
 *   - /api/colleges/recommend (auto-seed on first recommendation)
 * ────────────────────────────────────────────────────────────
 */

import { getPool } from '@/lib/db';
import fs from 'fs';
import path from 'path';

let seeded = false;
let _seedingPromise: Promise<void> | null = null;

const DB_COLUMNS = [
  'ope6_id', 'institution_name', 'control', 'cip4', 'cipcode', 'cipdesc', 'program_normalized',
  'credlev', 'ipedscount2', 'earn_mdn_1yr', 'earn_mdn_4yr',
  'earn_mdn_5yr', 'earn_gt_threshold_5yr', 'debt_all_stgp_eval_mdn',
];

// Map CSV headers → DB column names
const CSV_TO_DB: Record<string, string> = {
  'OPE6_ID': 'ope6_id',
  'INSTNM': 'institution_name',
  'CONTROL': 'control',
  'CIP4': 'cip4',
  'CIPCODE': 'cipcode',
  'CIPDESC': 'cipdesc',
  'Program_Normalized': 'program_normalized',
  'CREDLEV': 'credlev',
  'IPEDSCOUNT2': 'ipedscount2',
  'EARN_MDN_1YR': 'earn_mdn_1yr',
  'EARN_MDN_4YR': 'earn_mdn_4yr',
  'EARN_MDN_5YR': 'earn_mdn_5yr',
  'EARN_GT_THRESHOLD_5YR': 'earn_gt_threshold_5yr',
  'DEBT_ALL_STGP_EVAL_MDN': 'debt_all_stgp_eval_mdn',
};

const NUMERIC = new Set([
  'ope6_id', 'cipcode', 'credlev', 'ipedscount2',
  'earn_mdn_1yr', 'earn_mdn_4yr', 'earn_mdn_5yr',
  'earn_gt_threshold_5yr', 'debt_all_stgp_eval_mdn',
]);

function findCSV(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'programs_master.csv'),
    path.resolve('data', 'programs_master.csv'),
    '/app/data/programs_master.csv',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8'); } catch {}
  }
  throw new Error(`programs_master.csv not found. Searched: ${candidates.join(', ')}`);
}

/**
 * Parses a CSV line that may contain quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim().replace(/\r/g, ''));
  return fields;
}

/**
 * Ensures programs_master table has data.
 */
export async function ensureProgramsMaster(): Promise<void> {
  if (seeded) return;
  if (_seedingPromise) return _seedingPromise;
  _seedingPromise = _doSeedPrograms().finally(() => { _seedingPromise = null; });
  return _seedingPromise;
}

async function _doSeedPrograms(): Promise<void> {
  if (seeded) return;
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programs_master (
      id SERIAL PRIMARY KEY,
      ope6_id INTEGER NOT NULL,
      institution_name TEXT,
      control VARCHAR(20),
      cip4 VARCHAR(10) NOT NULL,
      cipcode INTEGER,
      cipdesc TEXT,
      program_normalized TEXT,
      credlev INTEGER,
      ipedscount2 INTEGER,
      earn_mdn_1yr INTEGER,
      earn_mdn_4yr INTEGER,
      earn_mdn_5yr INTEGER,
      earn_gt_threshold_5yr INTEGER,
      debt_all_stgp_eval_mdn INTEGER,
      UNIQUE (ope6_id, cip4, credlev)
    )
  `);

  // Safe: add unique constraint if not already present (handles existing DBs)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE programs_master ADD CONSTRAINT programs_master_ope6_id_cip4_credlev_key UNIQUE (ope6_id, cip4, credlev);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_ope6_id ON programs_master(ope6_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_cip4   ON programs_master(cip4)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pm_prog_norm ON programs_master(program_normalized)`);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM programs_master');
  if (rows[0].cnt > 0) {
    seeded = true;
    return;
  }

  console.log('[seed-programs] programs_master is empty — loading from CSV...');
  const result = await loadCSVIntoTable(pool);
  console.log(`[seed-programs] Done: ${result.inserted} programs loaded, ${result.errors.length} errors`);
  seeded = true;
}

async function loadCSVIntoTable(pool: any): Promise<{ inserted: number; errors: string[] }> {
  const csvContent = findCSV();
  const lines = csvContent.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = parseCSVLine(lines[0]);
  // Build column index map: for each DB_COLUMN, find the CSV header position
  const colMap: number[] = DB_COLUMNS.map(dbCol => {
    const csvHeader = Object.entries(CSV_TO_DB).find(([_, v]) => v === dbCol)?.[0] ?? '';
    return headers.indexOf(csvHeader);
  });

  const missing = DB_COLUMNS.filter((_, i) => colMap[i] === -1);
  if (missing.length > 0) throw new Error(`CSV missing columns: ${missing.join(', ')}`);

  const placeholders = DB_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
  const sql = `INSERT INTO programs_master (${DB_COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT (ope6_id, cip4, credlev) DO NOTHING`;

  let inserted = 0;
  const errors: string[] = [];

  // Batch insert for performance
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      const params: (string | number | null)[] = [];

      for (let c = 0; c < DB_COLUMNS.length; c++) {
        const raw = (fields[colMap[c]] ?? '').trim().replace(/\r/g, '');
        // Strip trailing .0 from OPE6_ID etc
        const cleaned = raw.replace(/\.0$/, '');
        if (cleaned === '' || cleaned === 'PrivacySuppressed' || cleaned === 'NULL') {
          params.push(null);
        } else if (NUMERIC.has(DB_COLUMNS[c])) {
          const n = parseFloat(cleaned);
          params.push(isNaN(n) ? null : Math.round(n));
        } else {
          params.push(cleaned);
        }
      }

      if (params.length !== DB_COLUMNS.length) { errors.push(`Row ${i}: wrong field count`); continue; }
      // Skip rows with null ope6_id
      if (params[0] == null) { continue; }

      try {
        await client.query(sql, params);
        inserted++;
      } catch (err: any) {
        errors.push(`Row ${i}: ${err.message}`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { inserted, errors };
}
