#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const TRANSACTION_BLOCKLIST = [
  'CREATE INDEX CONCURRENTLY',
  'DROP INDEX CONCURRENTLY',
  'ALTER TYPE',
];

function loadDotEnv(envPath = path.join(__dirname, '..', '.env.local')) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function canRunInTransaction(sql) {
  const upper = sql.toUpperCase();
  return !TRANSACTION_BLOCKLIST.some((needle) => upper.includes(needle));
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(rows.map((row) => row.filename));
}

async function applyMigration(client, filename, sql) {
  const transactional = canRunInTransaction(sql);
  if (transactional) await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [filename]
    );
    if (transactional) await client.query('COMMIT');
  } catch (error) {
    if (transactional) await client.query('ROLLBACK');
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set. Add it to the environment or .env.local.');
  }

  const client = new Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  try {
    await ensureMigrationTable(client);
    const files = listMigrationFiles();
    const applied = await getAppliedMigrations(client);

    if (argv.includes('--status')) {
      for (const file of files) {
        console.log(`${applied.has(file) ? 'applied ' : 'pending '} ${file}`);
      }
      return;
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip    ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`apply   ${file}`);
      await applyMigration(client, file, sql);
    }
    console.log('done');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  canRunInTransaction,
  listMigrationFiles,
  loadDotEnv,
};
