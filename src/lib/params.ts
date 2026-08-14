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

export function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
