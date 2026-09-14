/**
 * Pure form-parsing helpers for the special-records admin actions
 * (AFLDB-ISSUE-167 Stage 6).
 *
 * Kept out of `actions.ts` on purpose: a `'use server'` module may export only
 * async functions (Next.js's Server Action bundling rule), so a plain
 * synchronous helper cannot live there and still be unit-tested directly. One
 * module per domain is the established shape -- `src/app/admin/draft/
 * validation.ts` and `src/app/admin/awards/validation.ts` are the two
 * precedents -- rather than one shared parser module the domains reach across
 * into.
 *
 * Deliberately free of any `admin-special-records.ts` import (which carries
 * `import 'server-only'`): these helpers parse SHAPE only. What a correction
 * may touch, which fields are derived or identity-bearing, and whether the five
 * coupled after-siren fields agree are all decided server-side inside the
 * mutation transaction, never here.
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
 * A whole number that may legitimately be blank.
 *
 * `{ ok: true, value: null }` is "the administrator cleared this", which is not
 * the same answer as "the administrator typed something unparseable": the
 * correction contract treats an explicit null as a clear and a missing key as
 * "leave the source value alone", so the two must not collapse.
 */
export function parseNullableInt(
  value: FormDataEntryValue | null,
): { ok: true; value: number | null } | { ok: false } {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return { ok: true, value: null };
  const n = Number(raw);
  return Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
}

/** A whole number that must be present. */
export function parseRequiredInt(
  value: FormDataEntryValue | null,
): { ok: true; value: number } | { ok: false } {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return { ok: false };
  const n = Number(raw);
  return Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
}

/**
 * One member of a fixed vocabulary, or null.
 *
 * The vocabularies here are PostgreSQL enums (`after_siren_score`,
 * `after_siren_effect`, `after_siren_result`, `after_siren_siren`), so a value
 * outside the list is not merely invalid but unrepresentable -- and binding it
 * would surface as an opaque cast error rather than a sentence.
 */
export function parseEnum<T extends string>(
  value: FormDataEntryValue | null, allowed: readonly T[],
): T | null {
  const raw = (value ?? '').toString().trim();
  return (allowed as readonly string[]).includes(raw) ? raw as T : null;
}

/**
 * Which fields a correction form actually posted.
 *
 * KEY PRESENCE IS THE SEMANTICS for a source-owned row: an absent key leaves
 * the source value, an explicit null clears it. So a correction form posts a
 * `changed` list naming exactly the fields the administrator edited, and this
 * reads it -- rather than the action guessing from "is it different from what I
 * re-read", which would race a concurrent importer reload and freeze whatever
 * that reload had changed.
 */
export function parseChangedFields(
  value: FormDataEntryValue | null, allowed: readonly string[],
): string[] {
  const raw = (value ?? '').toString();
  if (!raw) return [];
  const seen = new Set<string>();
  for (const field of raw.split(',')) {
    const name = field.trim();
    if (name && allowed.includes(name)) seen.add(name);
  }
  return [...seen];
}
