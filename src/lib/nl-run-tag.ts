/**
 * The provenance label a synthetic qualification run stamps onto its
 * nl_search_log rows (migration 051), so a sweep's rows can be told from a
 * real reader's permanently rather than by the timestamp window that
 * identified the 2026-08-18 sweep after the fact.
 *
 * Carried as a request header rather than a query parameter: `q` is the
 * question under test and must reach the parser byte-for-byte, and a sweep
 * driving a real browser through /search?q=... has nowhere else to put it.
 */
export const NL_RUN_TAG_HEADER = 'x-afldb-run-tag';

/**
 * Deliberately conservative: a slug, bounded at 64 characters.
 *
 * This value is client-supplied and lands in a column that analysis will
 * later trust to mean "this row was synthetic". postgres.js parameterises,
 * so the risk is not injection -- it is a garbage or absurdly long label
 * becoming permanent, unreadable provenance.
 */
const RUN_TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Gated on an env var, and OFF unless explicitly set.
 *
 * Without this, any visitor could set the header and have their own real
 * searches recorded as belonging to a test run -- mislabelling genuine
 * traffic as synthetic, which corrupts precisely the signal the column
 * exists to protect (and would let someone hide their searches from the
 * tuning pass simply by sending a header). Sweeps only ever run against
 * dev, so dev opts in and production never does.
 */
export function nlRunTagAccepted(): boolean {
  return process.env.AFLDB_NL_RUN_TAG === 'accept';
}

/** Validates a client-supplied run tag, returning null for anything unacceptable. */
export function parseNlRunTag(value: string | undefined | null): string | null {
  if (!nlRunTagAccepted()) return null;
  if (!value) return null;
  const trimmed = value.trim();
  return RUN_TAG_RE.test(trimmed) ? trimmed : null;
}
