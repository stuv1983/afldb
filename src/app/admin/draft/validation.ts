/**
 * Pure form-parsing helpers for the draft admin actions (AFLDB-ISSUE-160).
 *
 * Kept out of `actions.ts` on purpose: a `'use server'` module may export
 * only async functions (Next.js's Server Action bundling rule), so a plain
 * synchronous helper cannot live there and still be unit-tested directly --
 * see `tests/admin-draft-actions.test.ts`. Deliberately free of any
 * `admin-draft.ts` import (which carries `import 'server-only'`): these
 * helpers parse shape only, and never decide what the enumeration or the
 * duplicate contract admits -- that stays server-side, inside the mutation
 * transaction (§4 rule 2).
 */

export function parsePositiveInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Like {@link parsePositiveInt}, but an empty value is a valid "no pick number" (NULL), not a parse failure. */
export function parseNullablePickNumber(value: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false } {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
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

/**
 * The Step 1 draft-facts select posts one `eventPair` field shaped
 * `<draftType>|<draftKind>` -- the `DRAFT_EVENT_PAIRS` entry the operator
 * chose, verbatim. Splitting rather than posting two separate fields means
 * the browser can never pair a `draftType` with a `draftKind` the
 * enumeration does not actually offer together; `checkSelectionConflicts`
 * (J-9) still re-validates the pair server-side regardless.
 */
export function parseEventPair(value: FormDataEntryValue | null): { draftType: string; draftKind: string } | null {
  const raw = (value ?? '').toString();
  const sep = raw.indexOf('|');
  if (sep <= 0 || sep === raw.length - 1) return null;
  const draftType = raw.slice(0, sep);
  const draftKind = raw.slice(sep + 1);
  if (!draftType || !draftKind) return null;
  return { draftType, draftKind };
}
