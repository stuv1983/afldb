/**
 * AFLDB-ISSUE-354: how an admin edit merges its changed fields into a durable `data_overrides`
 * payload (`saveCoachMetadata`, `saveSourcePickFields`, `saveEdit`).
 *
 * An override is the admin's standing decision about a field group; retiring it
 * (`is_active = false`) is the documented hand-back to the source (AFLDB-ISSUE-160: "a retired
 * selection is never resurrected"). Only an ACTIVE row may therefore be merged into: a retired
 * payload is never read back, so a later edit of a different field of the same group cannot
 * silently re-activate the values the admin retired. Starting from `{}` replaces the retired
 * payload; its earlier values stay in the `data_edits` rows that retired and wrote it.
 *
 * Pure (no database access) so the rule is unit-testable; the callers read the row with
 * `override_values` and `is_active`.
 */

export type StoredOverrideRow = {
  overrideValues: Record<string, unknown> | null;
  isActive: boolean;
} | null | undefined;

export type OverrideMerge = {
  /** The payload to upsert (empty means: nothing to write, leave any existing row as it is). */
  payload: Record<string, unknown>;
  /** Keys kept from the ACTIVE row that this edit did not change, sorted. */
  carriedKeys: string[];
  /** Keys of a RETIRED row that were dropped (not revived) and not re-set by this edit, sorted. */
  retiredKeysDropped: string[];
};

export function mergeOverrideDelta(
  existing: StoredOverrideRow,
  delta: Readonly<Record<string, unknown>>,
): OverrideMerge {
  const stored = existing?.overrideValues && typeof existing.overrideValues === 'object'
    ? existing.overrideValues
    : {};
  const base: Record<string, unknown> = existing?.isActive === true ? { ...stored } : {};
  const payload: Record<string, unknown> = { ...base, ...delta };
  const changed = new Set(Object.keys(delta));
  const carriedKeys = Object.keys(base).filter((key) => !changed.has(key)).sort();
  const retiredKeysDropped = existing && existing.isActive !== true
    ? Object.keys(stored).filter((key) => !changed.has(key)).sort()
    : [];
  return { payload, carriedKeys, retiredKeysDropped };
}

/**
 * The audit keys recorded beside the edited field values in `data_edits.new_values`, or `{}` when
 * the edit neither carried keys of an active override nor dropped a retired one (so an ordinary
 * first edit's audit row keeps exactly the shape it always had).
 */
export function overrideMergeAudit(merge: OverrideMerge): Record<string, string[]> {
  const audit: Record<string, string[]> = {};
  if (merge.carriedKeys.length > 0) audit.override_carried_keys = merge.carriedKeys;
  if (merge.retiredKeysDropped.length > 0) audit.override_retired_keys_dropped = merge.retiredKeysDropped;
  return audit;
}
