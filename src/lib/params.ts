/**
 * Safe parsing of URL query parameters.
 *
 * Every public page is reachable with arbitrary query strings, so all
 * values are clamped and defaulted here rather than trusted.
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/search/constants';

export function parsePage(value: string | undefined): number {
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  // Deep paging is an abuse vector and useless to readers.
  return Math.min(page, 10_000);
}

/**
 * Parse page size bounded by MAX_PAGE_SIZE (configurable via AFLDB_MAX_PAGE_SIZE; see changeLog.md).
 */
export function parsePageSize(value: string | undefined): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}

/** The largest value a PostgreSQL `integer` (int4) id column can hold. */
export const MAX_INT4_ID = 2_147_483_647;

/**
 * The one canonical spelling of a numeric id or season in a URL (AFLDB-ISSUE-357):
 * digits only, no sign, no leading zero, no exponent, no decimal point, no hex.
 *
 * `Number()` accepts `011724`, `1e0`, `0x1`, `1.0` and `2.024e3`, so every one
 * of those used to render the full page at a second URL, and each distinct
 * spelling of an ISR route is persisted to disk by Next. Anything that is not
 * the canonical spelling is "not a valid id" here, so callers 404 (or redirect)
 * before any query is built from it.
 */
const CANONICAL_NUMBER = /^[1-9][0-9]*$/;

/**
 * A canonical positive id that fits a PostgreSQL `integer`, or undefined.
 *
 * The range check is part of the parse (AFLDB-ISSUE-359): an id above 2^31-1 is
 * well-formed but can never exist, and binding it to an int4 comparison raises
 * `22003` (a 500) instead of finding nothing.
 */
export function parseCanonicalId(value: string | undefined): number | undefined {
  if (value === undefined || !CANONICAL_NUMBER.test(value)) return undefined;
  if (value.length > 10) return undefined;
  const id = Number(value);
  return id <= MAX_INT4_ID ? id : undefined;
}

/** True for a canonical positive integer spelling that is simply too large to be an id. */
export function isOversizedCanonicalId(value: string | undefined): boolean {
  return value !== undefined && CANONICAL_NUMBER.test(value) && parseCanonicalId(value) === undefined;
}

export function parseSeason(value: string | undefined): number | undefined {
  if (value === undefined || !CANONICAL_NUMBER.test(value) || value.length > 4) return undefined;
  const year = Number(value);
  if (year < 1897 || year > 2100) return undefined;
  return year;
}

/**
 * `decodeURIComponent` that reports a malformed escape as null instead of
 * throwing a URIError (a 500).
 */
export function safeDecodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The AFLW route keys (player slug, match key, season key, club code) are
 * `encodeURIComponent`-ed when linked, and 17 live player slugs contain a
 * literal `%27` (`Aasta_O%27Connor`, linked as `Aasta_O%2527Connor`).
 *
 * Next 16.3.1 hands the SAME dynamic segment to a page and to its
 * generateMetadata in different states (measured with a dev-server probe,
 * AFLDB-ISSUE-359): the page receives it still percent-encoded exactly as it
 * appears in the URL; generateMetadata receives it already decoded once.
 * Decoding both made the metadata over-decode (`O%27Connor` -> `O'Connor`), so
 * the title read "AFLW player not found" with `noindex` and no canonical on a
 * page that rendered fine. Both functions below return the key as stored; they
 * exist side by side so the two entry points cannot drift apart again.
 *
 * Page: null for a malformed escape, which the page turns into notFound().
 */
export function aflwKeyFromPageParam(raw: string): string | null {
  return safeDecodeParam(raw);
}

/** generateMetadata: the segment is already decoded once by Next; decoding again over-decodes. */
export function aflwKeyFromMetadataParam(decodedOnce: string): string {
  return decodedOnce;
}

/** Bounded integer, or undefined when absent or invalid. */
export function parseIntInRange(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return undefined;
  return Math.min(Math.max(n, min), max);
}

/** A slug is only ever used for equality lookups, but keep it sane. */
export function parseSlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(trimmed)) return undefined;
  return trimmed;
}

/** Free-text search term: trimmed and length-capped; empty becomes undefined. */
export function parseSearchTerm(value: string | undefined, maxLength = 100): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One end of a range filter, clamped into the field's declared bounds.
 *
 * Every filtered surface on the site — the list panels, Advanced Player
 * Search and Match Search — reads its bounds through this, so they agree
 * on what a hand-edited URL means: whole numbers only, out-of-range
 * clamped rather than rejected, and anything unparseable treated as
 * absent. `clamped` says whether the value the query will run with is the
 * one that was asked for, which the surfaces that show notices report.
 */
export function clampBound(
  raw: string | undefined,
  min: number,
  max: number,
): { value: number | undefined; clamped: boolean } {
  if (raw === undefined || raw.trim() === '') return { value: undefined, clamped: false };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { value: undefined, clamped: false };
  const truncated = Math.trunc(value);
  const bounded = Math.min(Math.max(truncated, min), max);
  return { value: bounded, clamped: bounded !== truncated };
}

/** The one wording for a range that cannot be honoured. */
export function invertedRangeError(label: string, min: number, max: number): string {
  return `${label}: minimum (${min}) is above maximum (${max}).`;
}
