/**
 * lib/seed-colleges.ts
 * ────────────────────────────────────────────────────────────
 * Reads data/colleges_master.csv and loads rows into the
 * colleges_master PostgreSQL table. Works on Vercel (serverless)
 * and Docker (local dev).
 *
 * Called from:
 *   - /api/admin/seed-colleges (manual trigger)
 *   - /api/colleges/master (auto-seed on first search)
 * ────────────────────────────────────────────────────────────
 */

import { getPool } from '@/lib/db';
import fs from 'fs';
import path from 'path';

let seeded = false; // In-memory flag — avoids re-checking on every request
let _seedingPromise: Promise<void> | null = null; // mutex — prevents concurrent seed races

const DB_COLUMNS = [
  'ope6_id','name','city','state','zip','college_url','ownership','locale','carnegie_basic',
  'acceptance_rate','sat_25','sat_75','sat_avg','sat_range','act_25','act_75','act_mid','act_range',
  'enrollment','retention_rate','student_faculty_ratio',
  'pct_men','pct_women','pct_white','pct_black','pct_hispanic','pct_asian','pct_two_or_more',
  'tuition_in_state','tuition_out_state','net_price','cost_attendance',
  'median_debt','pell_rate','loan_rate','grad_rate',
  'earnings_6yr','earnings_8yr','earnings_10yr',
];

const NUMERIC = new Set([
  'ope6_id','carnegie_basic','sat_25','sat_75','sat_avg','act_25','act_75','act_mid',
  'enrollment','student_faculty_ratio','tuition_in_state','tuition_out_state','net_price',
  'cost_attendance','median_debt','earnings_6yr','earnings_8yr','earnings_10yr',
  'acceptance_rate','retention_rate','pct_men','pct_women','pct_white','pct_black',
  'pct_hispanic','pct_asian','pct_two_or_more','pell_rate','loan_rate','grad_rate',
]);

function findCSV(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'colleges_master.csv'),
    path.resolve('data', 'colleges_master.csv'),
    '/app/data/colleges_master.csv',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8'); } catch {}
  }
  throw new Error(`CSV not found. Searched: ${candidates.join(', ')}`);
}

function parseRow(line: string, headers: string[], colMap: number[]): (string | number | null)[] {
  const rawFields = line.split(',');
  const params: (string | number | null)[] = [];
  for (let c = 0; c < DB_COLUMNS.length; c++) {
    const raw = (rawFields[colMap[c]] ?? '').trim().replace(/\r/g, '');
    if (raw === '') {
      params.push(null);
    } else if (NUMERIC.has(DB_COLUMNS[c])) {
      const n = parseFloat(raw);
      params.push(isNaN(n) ? null : n);
    } else {
      params.push(raw);
    }
  }
  return params;
}

/**
 * Ensures colleges_master has data. Call from any API route.
 * On first call per server lifecycle: checks table count.
 * If empty, reads CSV and inserts all rows.
 * Subsequent calls are no-ops (in-memory flag).
 */
export async function ensureCollegesMaster(): Promise<void> {
  if (seeded) return;
  if (_seedingPromise) return _seedingPromise;
  _seedingPromise = _doSeedColleges().finally(() => { _seedingPromise = null; });
  return _seedingPromise;
}

async function _doSeedColleges(): Promise<void> {
  if (seeded) return;
  const pool = getPool();

  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS colleges_master (
      id SERIAL PRIMARY KEY,
      ope6_id INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL, city TEXT, state CHAR(2), zip TEXT,
      college_url TEXT, ownership VARCHAR(20), locale VARCHAR(20),
      carnegie_basic INTEGER, acceptance_rate NUMERIC(5,1),
      sat_25 INTEGER, sat_75 INTEGER, sat_math_25 INTEGER, sat_math_75 INTEGER,
      sat_cr_25 INTEGER, sat_cr_75 INTEGER, sat_avg INTEGER, sat_range TEXT,
      act_25 INTEGER, act_75 INTEGER, act_mid INTEGER, act_range TEXT,
      enrollment INTEGER, retention_rate NUMERIC(5,1), student_faculty_ratio INTEGER,
      pct_men NUMERIC(5,1), pct_women NUMERIC(5,1),
      pct_white NUMERIC(5,1), pct_black NUMERIC(5,1), pct_hispanic NUMERIC(5,1),
      pct_asian NUMERIC(5,1), pct_two_or_more NUMERIC(5,1),
      tuition_in_state INTEGER, tuition_out_state INTEGER,
      net_price INTEGER, cost_attendance INTEGER,
      median_debt INTEGER, pell_rate NUMERIC(5,1), loan_rate NUMERIC(5,1),
      grad_rate NUMERIC(5,1),
      earnings_6yr INTEGER, earnings_8yr INTEGER, earnings_10yr INTEGER,
      last_refreshed TIMESTAMP DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM colleges_master');
  if (rows[0].cnt > 0) {
    seeded = true;
    return;
  }

  console.log('[seed-colleges] colleges_master is empty — loading from CSV...');
  const result = await loadCSVIntoTable(pool);
  console.log(`[seed-colleges] Done: ${result.inserted} colleges loaded`);
  seeded = true;
}

/**
 * Wipe and reload from CSV. Used by admin reimport action.
 */
export async function reloadCollegesMaster(): Promise<{ inserted: number; errors: string[] }> {
  const pool = getPool();
  await pool.query('DELETE FROM colleges_master');
  seeded = false;
  return loadCSVIntoTable(pool);
}

/**
 * Core loader — reads CSV and inserts into an existing (empty) table.
 */
async function loadCSVIntoTable(pool: any): Promise<{ inserted: number; errors: string[] }> {
  const csvContent = findCSV();
  const lines = csvContent.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));
  const colMap = DB_COLUMNS.map(dc => headers.indexOf(dc));
  const missing = DB_COLUMNS.filter((_, i) => colMap[i] === -1);
  if (missing.length > 0) throw new Error(`CSV missing columns: ${missing.join(', ')}`);

  const placeholders = DB_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
  const sql = `INSERT INTO colleges_master (${DB_COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT (ope6_id) DO NOTHING`;

  let inserted = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const params = parseRow(lines[i], headers, colMap);
    if (params.length !== DB_COLUMNS.length) { errors.push(`Row ${i}: wrong field count`); continue; }
    try {
      const res = await pool.query(sql, params);
      if (res.rowCount > 0) inserted++;
    } catch (err: any) {
      errors.push(`Row ${i} (${params[1]}): ${err.message}`);
    }
  }

  return { inserted, errors };
}
