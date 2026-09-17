/**
 * Pure form-parsing helpers for the coach admin actions (AFLDB-ISSUE-159).
 *
 * Kept out of `actions.ts` on purpose: a `'use server'` module may export
 * only async functions (Next.js's Server Action bundling rule), so a plain
 * synchronous helper cannot live there and still be unit-tested directly --
 * see `tests/admin-coach-actions.test.ts`.
 */

export function parsePositiveInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function optionalText(value: FormDataEntryValue | null, maxLength: number): string | null {
  const s = (value ?? '').toString().trim();
  if (s === '') return null;
  return s.slice(0, maxLength);
}

export type AssignmentPair = { matchId: number; clubId: number };

/**
 * `<matchId>:<clubId>,<matchId>:<clubId>,...` -- one pair for a single row's
 * "Set" button, several for the assignment panel's "apply to every listed
 * match" control, both handled by the same one-transaction mutation (§9.4).
 * Mirrors the `targets` parsing convention in
 * `src/app/admin/player-links/actions.ts`. Returns `null` for anything that
 * is not a non-empty list of two positive integers.
 */
export function parseAssignments(raw: FormDataEntryValue | null): AssignmentPair[] | null {
  const text = (raw ?? '').toString();
  const pairs = text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [matchIdRaw, clubIdRaw] = s.split(':');
    return { matchId: Number(matchIdRaw), clubId: Number(clubIdRaw) };
  });
  if (pairs.length === 0) return null;
  if (pairs.some((p) => !Number.isInteger(p.matchId) || p.matchId <= 0 || !Number.isInteger(p.clubId) || p.clubId <= 0)) {
    return null;
  }
  return pairs;
}
