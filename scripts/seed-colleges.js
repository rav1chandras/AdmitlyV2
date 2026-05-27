#!/usr/bin/env node
/**
 * seed-colleges.js
 * ────────────────────────────────────────────────────────────
 * Reads data/colleges_master.csv and loads it into the
 * colleges_master PostgreSQL table. Runs before the Next.js
 * server starts (called from entrypoint.sh).
 *
 * - Pure Node.js, no TypeScript, no build step
 * - Uses the `pg` module already in node_modules
 * - Idempotent: skips if table already has rows
 * - Scales to any number of rows (24 or 3,000+)
 * ────────────────────────────────────────────────────────────
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.log('[seed-colleges] No POSTGRES_URL — skipping');
  process.exit(0);
}

const CSV_PATHS = [
  path.join(process.cwd(), 'data', 'colleges_master.csv'),
  path.join(__dirname, 'data', 'colleges_master.csv'),
  '/app/data/colleges_master.csv',
];

const DB_COLUMNS = [
  'ope6_id','name','city','state','zip','college_url','ownership','locale','carnegie_basic',
  'acceptance_rate','sat_25','sat_75','sat_math_25','sat_math_75','sat_cr_25','sat_cr_75','sat_avg','sat_range','act_25','act_75','act_mid','act_range',
  'enrollment','retention_rate','student_faculty_ratio',
  'pct_men','pct_women','pct_white','pct_black','pct_hispanic','pct_asian','pct_two_or_more',
  'tuition_in_state','tuition_out_state','net_price','cost_attendance',
  'median_debt','pell_rate','loan_rate','grad_rate',
  'earnings_6yr','earnings_8yr','earnings_10yr',
];

const NUMERIC_COLS = new Set([
  'ope6_id','carnegie_basic','sat_25','sat_75','sat_math_25','sat_math_75','sat_cr_25','sat_cr_75','sat_avg','act_25','act_75','act_mid',
  'enrollment','student_faculty_ratio','tuition_in_state','tuition_out_state','net_price',
  'cost_attendance','median_debt','earnings_6yr','earnings_8yr','earnings_10yr',
  'acceptance_rate','retention_rate','pct_men','pct_women','pct_white','pct_black',
  'pct_hispanic','pct_asian','pct_two_or_more','pell_rate','loan_rate','grad_rate',
]);

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else if (ch !== '\r') current += ch;
  }
  fields.push(current);
  return fields;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });

  try {
    // Wait for DB to be ready (retry up to 30 seconds)
    let connected = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        await pool.query('SELECT 1');
        connected = true;
        break;
      } catch {
        console.log(`[seed-colleges] Waiting for database... (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!connected) {
      console.error('[seed-colleges] Could not connect to database');
      process.exit(1);
    }

    // Check if table exists and has data
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM colleges_master');
      if (rows[0].cnt > 0) {
        console.log(`[seed-colleges] colleges_master already has ${rows[0].cnt} rows — skipping`);
        return;
      }
    } catch (err) {
      // Table might not exist yet — create it
      console.log('[seed-colleges] Creating colleges_master table...');
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
    }

    // Find CSV file
    let csvContent = '';
    let csvPath = '';
    for (const p of CSV_PATHS) {
      try {
        if (fs.existsSync(p)) {
          csvContent = fs.readFileSync(p, 'utf-8');
          csvPath = p;
          break;
        }
      } catch {}
    }

    if (!csvContent) {
      console.error('[seed-colleges] CSV not found. Searched:', CSV_PATHS.join(', '));
      // List what's actually in the filesystem for debugging
      try {
        console.log('[seed-colleges] Contents of /app:', fs.readdirSync('/app').join(', '));
        if (fs.existsSync('/app/data')) {
          console.log('[seed-colleges] Contents of /app/data:', fs.readdirSync('/app/data').join(', '));
        }
      } catch {}
      try {
        console.log('[seed-colleges] cwd:', process.cwd());
        console.log('[seed-colleges] Contents of cwd:', fs.readdirSync(process.cwd()).join(', '));
      } catch {}
      return;
    }

    console.log(`[seed-colleges] Loading from: ${csvPath}`);

    // Parse CSV
    const lines = csvContent.split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]);
    const colMap = DB_COLUMNS.map(dc => headers.indexOf(dc));

    // Check all columns found
    const missing = DB_COLUMNS.filter((dc, i) => colMap[i] === -1);
    if (missing.length > 0) {
      console.error('[seed-colleges] CSV missing columns:', missing.join(', '));
      console.log('[seed-colleges] CSV headers:', headers.join(', '));
      return;
    }

    // Build prepared INSERT
    const placeholders = DB_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
    const insertSQL = `INSERT INTO colleges_master (${DB_COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT (ope6_id) DO NOTHING`;

    let inserted = 0;
    let errors = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < headers.length) continue;

      const params = [];
      for (let c = 0; c < DB_COLUMNS.length; c++) {
        const raw = (fields[colMap[c]] || '').trim();
        if (raw === '') {
          params.push(null);
        } else if (NUMERIC_COLS.has(DB_COLUMNS[c])) {
          const n = parseFloat(raw);
          params.push(isNaN(n) ? null : n);
        } else {
          params.push(raw);
        }
      }

      try {
        await pool.query(insertSQL, params);
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 3) {
          console.error(`[seed-colleges] Row ${i} error (${params[1]}):`, err.message);
        }
      }
    }

    console.log(`[seed-colleges] Done: ${inserted} inserted, ${errors} errors, from ${lines.length - 1} CSV rows`);

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[seed-colleges] Fatal:', err);
  process.exit(1);
});
