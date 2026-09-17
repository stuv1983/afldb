/**
 * Pure form-parsing helpers for the awards admin actions (AFLDB-ISSUE-165).
 *
 * Kept out of `actions.ts` on purpose: a `'use server'` module may export
 * only async functions (Next.js's Server Action bundling rule), so a plain
 * synchronous helper cannot live there and still be unit-tested directly.
 * Deliberately free of any `admin-awards.ts` import (which carries
 * `import 'server-only'`): these helpers parse SHAPE only. What a correction
 * may touch, which fields are identity-bearing, and whether a duplicate needs
 * confirming are decided server-side inside the mutation transaction, never
 * here — the same division `src/app/admin/draft/validation.ts` draws.
 */

export function parsePositiveInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function optionalText(value: FormDataEntryValue | null, maxLength: number): string | null {
  const s = (value ?? '').toString().trim();
  return s === '' ? null : s.slice(0, maxLength);
}

export function requiredText(value: FormDataEntryValue | null, maxLength: number): string | null {
  return optionalText(value, maxLength);
}

/** An HTML checkbox posts nothing at all when clear, and 'on' or 'true' when set. */
export function parseCheckbox(value: FormDataEntryValue | null): boolean {
  const s = (value ?? '').toString();
  return s === 'on' || s === 'true' || s === '1';
}

/**
 * A number field that may legitimately be blank.
 *
 * `{ ok: true, value: null }` is "the administrator cleared this", which is
 * not the same answer as "the administrator typed something unparseable" —
 * the correction contract treats an explicit null as a clear and a missing
 * key as "leave the source value alone", so the two must not collapse.
 */
export function parseNullableInt(
  value: FormDataEntryValue | null,
): { ok: true; value: number | null } | { ok: false } {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return { ok: true, value: null };
  const n = Number(raw);
  return Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
}

/**
 * A decimal field that may legitimately be blank.
 *
 * `award_winners.votes` is `numeric(8,2)` and is carried as TEXT end to end
 * (nothing arithmetics it), so this validates and returns the string rather
 * than round-tripping through a float that could alter what was typed.
 */
export function parseNullableDecimal(
  value: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false } {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return { ok: true, value: null };
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

/**
 * Which fields a correction form actually posted.
 *
 * KEY PRESENCE IS THE SEMANTICS for a source-owned row (§6.2): an absent key
 * leaves the source value, an explicit null clears it. So a correction form
 * posts a `changed` list naming exactly the fields the administrator edited,
 * and this reads it — rather than the action guessing from "is it different
 * from what I re-read", which would race a concurrent reload.
 */
export function parseChangedFields(value: FormDataEntryValue | null, allowed: readonly string[]): string[] {
  const raw = (value ?? '').toString();
  if (!raw) return [];
  const seen = new Set<string>();
  for (const field of raw.split(',')) {
    const name = field.trim();
    if (name && allowed.includes(name)) seen.add(name);
  }
  return [...seen];
}
