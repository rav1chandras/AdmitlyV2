import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireScript = createRequire(import.meta.url);
const SCAN_ROOTS = ['app/api', 'lib'];
const DDL_PATTERN = /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX|DROP\s+TABLE|CREATE\s+EXTENSION)\b/i;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['migrations', 'docker', 'scripts', 'tests', 'node_modules', '.next'].includes(entry.name)) {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('runtime schema changes', () => {
  it('keeps DDL out of request/runtime source files', () => {
    const offenders = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(REPO_ROOT, root)))
      .flatMap((file) => {
        const content = fs.readFileSync(file, 'utf8');
        return content.split(/\r?\n/).flatMap((line, index) => (
          DDL_PATTERN.test(line)
            ? [`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`]
            : []
        ));
      });

    expect(offenders).toEqual([]);
  });
});

describe('migration script helpers', () => {
  it('lists migration files in filename order', () => {
    const tempDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-migrations-'));
    try {
      fs.writeFileSync(path.join(tempDir, '010_ten.sql'), '');
      fs.writeFileSync(path.join(tempDir, '001_one.sql'), '');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '');

      const { listMigrationFiles } = requireScript('../scripts/migrate.js');
      expect(listMigrationFiles(tempDir)).toEqual(['001_one.sql', '010_ten.sql']);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects migrations that should not run in a transaction', () => {
    const { canRunInTransaction } = requireScript('../scripts/migrate.js');

    expect(canRunInTransaction('SELECT 1;')).toBe(true);
    expect(canRunInTransaction('CREATE INDEX CONCURRENTLY idx_test ON things(id);')).toBe(false);
  });
});
