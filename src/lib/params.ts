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

export function parseSeason(value: string | undefined): number | undefined {
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 1897 || year > 2100) return undefined;
  return year;
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
