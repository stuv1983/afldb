/**
 * Pure form-parsing helpers for the fixture admin actions (AFLDB-ISSUE-162
 * Stage 2), mirroring `src/app/admin/season-lists/validation.ts`.
 *
 * Kept out of `actions.ts` for the same reason as the season-list precedent:
 * a `'use server'` module may export only async functions, so a plain
 * synchronous helper cannot live there. Deliberately free of any
 * `admin-fixtures.ts` import (which carries `import 'server-only'`): these
 * helpers parse shape only, and never decide what a season, round, club or
 * duplicate means -- that stays server-side, inside the mutation transaction
 * (Stage 1 §13/§15/§16).
 */

export function parsePositiveInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseInteger(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function optionalText(value: FormDataEntryValue | null, maxLength: number): string | null {
  const s = (value ?? '').toString().trim();
  if (s === '') return null;
  return s.slice(0, maxLength);
}

export function requiredText(value: FormDataEntryValue | null, maxLength: number): string | null {
  const s = (value ?? '').toString().trim();
  if (s === '') return null;
  return s.slice(0, maxLength);
}
