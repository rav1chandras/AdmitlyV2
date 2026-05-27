/**
 * lib/csv-export.ts — Phase A
 *
 * Browser-side CSV download helper used by the admin tables.
 *
 * Design notes:
 *  • RFC 4180: any field containing a comma, double-quote, CR or LF is wrapped
 *    in double-quotes; embedded double-quotes are doubled up.
 *  • UTF-8 BOM is prepended so Excel correctly renders accented names like
 *    "Sofía Mendes" instead of mojibake.
 *  • Phone-number-like fields lose their leading zero when Excel tries to
 *    coerce them to numbers ("0123" → 123). We support per-column
 *    `preserveLeadingZero: true` which wraps the value as `="..."` — this
 *    forces Excel/Numbers to treat it as a literal string. (We use this
 *    instead of a leading TAB because TAB is fragile across paste
 *    boundaries and breaks for non-Excel consumers.)
 *  • No Node-only APIs — this file runs in the browser only.
 */

export type CsvColumn<T> = {
  /** Column header, written as the first row. */
  header: string;
  /** Cell extractor. Return `null`/`undefined` for empty. */
  value: (row: T) => string | number | boolean | null | undefined;
  /** If true, the cell is wrapped as `="…"` so Excel keeps any leading zero. */
  preserveLeadingZero?: boolean;
};

/** Escape a single field per RFC 4180. */
function escapeField(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Render one cell, applying preserveLeadingZero when requested. */
function renderCell<T>(row: T, col: CsvColumn<T>): string {
  const v = col.value(row);
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s === '') return '';

  if (col.preserveLeadingZero) {
    // Excel-formula trick: ="0123" survives the CSV import as the literal
    // string 0123. We must still escape internal quotes.
    const inner = s.replace(/"/g, '""');
    return `="${inner}"`;
  }
  return escapeField(s);
}

/** Build the CSV body (no BOM). Useful for tests. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map(c => escapeField(c.header)).join(',');
  const body = rows.map(r => columns.map(c => renderCell(r, c)).join(',')).join('\r\n');
  return rows.length ? `${head}\r\n${body}` : head;
}

/**
 * Trigger a browser download of the rows as a CSV file.
 *
 * @param filename  basename without extension (we append `.csv`)
 * @param rows      data array
 * @param columns   ordered column definitions
 */
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  if (typeof window === 'undefined') return; // SSR no-op
  const csv = buildCsv(rows, columns);
  // ﻿ = UTF-8 BOM so Excel detects encoding correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const safe = filename.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so the click has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
