/**
 * Minimal RFC 4180 CSV writing.
 *
 * DB-free and dependency-free: the only CSV this application produces is
 * an admin export, and a whole library would be more surface than the
 * ~30 lines it replaces.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *   QUOTING. A field is quoted when it contains a comma, a quote, or any
 *   newline, and an embedded quote is doubled. Skipping this is how an
 *   exported reader question containing a comma silently becomes two
 *   columns and shifts every field after it.
 *
 *   FORMULA INJECTION. A spreadsheet treats a cell beginning with =, +,
 *   -, @, or a leading tab/carriage return as a formula, so a reader who
 *   types `=1+1` into the search box gets that evaluated on the machine
 *   of whoever opens the export. Since every question in these exports is
 *   untrusted text typed by the public, such a cell is prefixed with an
 *   apostrophe, which spreadsheets treat as "the rest is literal text".
 *   The apostrophe is visible in the cell; that is the intended trade --
 *   a visibly odd cell beats an evaluated one.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const RISKY_PREFIX = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  if (RISKY_PREFIX.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Rows as CSV text, with `columns` deciding both the header and the order
 * fields are read in -- so a column added to a query cannot silently
 * reorder an existing export.
 *
 * CRLF line endings, per RFC 4180, and the form Excel is least likely to
 * mangle.
 */
export function toCsv<T extends Record<string, unknown>>(
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A CSV HTTP response that browsers download rather than render.
 *
 * The UTF-8 BOM is deliberate: without it Excel on Windows reads the file
 * as the local ANSI codepage and mis-renders every non-ASCII character --
 * which in AFLDB means player names like Ablett-Bacchus survive but
 * anything accented does not.
 */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Telemetry exports are a point-in-time snapshot of a live table and
      // are admin-only; nothing should hold one in a shared cache.
      'Cache-Control': 'no-store, private',
    },
  });
}
