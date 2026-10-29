/**
 * Tiny pure formatters for the operations-centre views. Kept apart from `views.ts` (which imports
 * the `@afldb/admin` and `@afldb/derived` packages) so the Client Component forms can use them
 * without pulling those packages into a browser bundle.
 */

/** `2026-10-19T12:00:00Z` -> `2026-10-19 12:00 UTC`; anything else is shown as written; null is a dash. */
export function formatInstant(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]} UTC` : value;
}

/** The first 12 characters of a checksum, for a table; the full value is in the record. */
export function shortChecksum(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}
