import 'server-only';

import type postgres from 'postgres';

import { recordDataEdit } from '@/db/queries/audit-log';

/**
 * A player's DURABLE identity — the one shared module (AFLDB-ISSUE-161 §29).
 *
 * Extracted verbatim from `src/db/queries/admin-draft.ts` and
 * `src/db/queries/players.ts` when season-list administration became the second
 * domain that has to name a player in a `data_overrides` payload. The rule is
 * the same for both and must stay the same for both: a promotion renumbers
 * `players.id`, so a durable record names a person by an AFL Tables profile
 * path or by a minted `manual_admin_edit` token, and by nothing else. There is
 * exactly one identity system; a second one would be two answers to "who is
 * this row about".
 *
 * Behaviour is unchanged by the move — `admin-draft.ts` re-exports every name
 * it used to own, and `players.ts` re-exports `readManualPlayerToken`, so no
 * caller and no test had to change.
 *
 * NAMES NEVER DECIDE IDENTITY (I-10). Nothing here reads a display name, a
 * search name or a date of birth. A search UI may RANK candidates by name; only
 * this module says who a row is about, and when it cannot say so with
 * certainty it refuses rather than choosing.
 */

export const MANUAL_SOURCE_KEY = 'manual_admin_edit';

/** The `data_overrides.entity_key` of a MANUAL selection or player. */
export function manualEntityKey(token: string): string {
  return `${MANUAL_SOURCE_KEY}:${token}`;
}

/**
 * The `manual_admin_edit` token a player carries, or null when it holds none
 * (or, refusing to choose, more than one). Read inside the caller's
 * transaction: nothing identity-shaped is ever trusted from the browser
 * (AFLDB-ISSUE-160 §4).
 */
export async function readManualPlayerToken(
  tx: postgres.TransactionSql,
  playerId: number,
): Promise<string | null> {
  const rows = await tx<{ externalId: string }[]>`
    SELECT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'manual_admin_edit'
       AND e.status IN ('unique', 'resolved')
     ORDER BY e.external_id
  `;
  return rows.length === 1 ? rows[0].externalId : null;
}

/**
 * The outcome of resolving one player to one identity string.
 *
 * `'ambiguous_identity'` is a member of `DraftRefusalReason` and of
 * `SeasonListRefusalReason`, so both domains map a refusal straight through
 * without translating it.
 */
export type PlayerIdentityResolution =
  | { ok: true; identity: string; minted: false }
  | { ok: false; error: string; reason: 'ambiguous_identity' }
  | { ok: true; identity: null; minted: false };

/**
 * The player's DURABLE identity string for an override payload, resolved
 * server-side inside the transaction (AFLDB-ISSUE-160 §4 rule 2 — nothing
 * identity-shaped is trusted from the browser). AFL Tables path first, then the
 * manual token.
 *
 * `{ ok: true, identity: null }` means the player holds NEITHER — a legacy
 * identity-less row. That is not an error here: the caller decides what it
 * means. `admin-draft.ts` mints one in the adopt path and refuses elsewhere;
 * `admin-season-lists.ts` always refuses, because minting an identity is a
 * player-lifecycle decision and season-list administration is not the place to
 * take one.
 */
export async function resolvePlayerIdentity(
  tx: postgres.TransactionSql,
  playerId: number,
): Promise<PlayerIdentityResolution> {
  const afl = await tx<{ externalId: string }[]>`
    SELECT DISTINCT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'afltables'
       AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved')
  `;
  if (afl.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_identity',
      error: 'That player holds more than one AFL Tables profile identity. Refusing to choose one; '
        + 'reconcile the identity before recording a selection against them.',
    };
  }
  if (afl.length === 1) return { ok: true, identity: `afltables:${afl[0].externalId}`, minted: false };

  const token = await readManualPlayerToken(tx, playerId);
  if (token) return { ok: true, identity: manualEntityKey(token), minted: false };
  return { ok: true, identity: null, minted: false };
}

// ---------------------------------------------------------------------------
// The durable creation record's name fields (AFLDB-ISSUE-224 §21.3.2, A1)
// ---------------------------------------------------------------------------

/**
 * The three fields the editor's `players` / `name` group and the durable
 * `manual_admin_edit:<token>` / `identity` creation record BOTH claim.
 *
 * They are the only overlap this module keeps in step for EVERY player,
 * deliberately. For a player who holds an AFL Tables identity every other shared
 * field (`dob`, `height_cm`, …) is already settled deterministically by the
 * replay's authority precedence (`tools/migration/common.py`,
 * `replay_admin_overrides('players')`), and propagating it here would create a
 * new way for a legitimate edit to make the creation record unresolvable — the
 * replay refuses a payload carrying a `dob` with `dob_confidence = 'unknown'`
 * (migration 018, `players_dob_confidence_ck`), a state the editor can produce.
 * The name family is different in two ways that earn the sync: it is what the
 * replay's INSERT branch re-creates a destroyed row FROM, and it is what the AFL
 * API player bridge's fail-closed surname check reads.
 *
 * A player with NO AFL Tables identity is the exception, and
 * {@link planManualIdentityRecordSync} (AFLDB-ISSUE-277, D-277-1) covers it: the
 * editor writes no override for them, so the creation record is the only durable
 * record of every other field too, and it is kept in step behind a save-time
 * replay-compatibility guard instead of being left stale.
 */
export const MANUAL_IDENTITY_NAME_FIELDS = ['display_name', 'given_name', 'surname'] as const;

export type ManualIdentityNamePatch = Record<string, string | null>;

/**
 * The patch to merge into the durable creation record after a `name` edit, or
 * `null` when the edit moved none of the three fields.
 *
 * All three are written whenever any one of them moves: the record is a
 * SNAPSHOT of the row, so a half-updated one (a new surname beside a stale given
 * name) would be a third answer to what the person is called. Pure, and
 * exercised directly by `tests/manual-identity-name-record.test.ts`.
 */
export function manualIdentityNamePatchFor(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ManualIdentityNamePatch | null {
  const normalise = (value: unknown): string | null =>
    (value === null || value === undefined ? null : String(value));
  const moved = MANUAL_IDENTITY_NAME_FIELDS
    .some((field) => normalise(before[field]) !== normalise(after[field]));
  if (!moved) return null;
  const patch: ManualIdentityNamePatch = {};
  for (const field of MANUAL_IDENTITY_NAME_FIELDS) patch[field] = normalise(after[field]);
  return patch;
}

export type ManualIdentitySyncOutcome = 'no_change' | 'no_durable_record' | 'synced';

/**
 * Keep an admin-created player's durable creation record in step with a name
 * edit — the general half of AFLDB-ISSUE-224 §21.3.2's A1.
 *
 * WHY THIS EXISTS. `createPlayerInTransaction` writes the whole player into
 * `data_overrides('players', 'manual_admin_edit:<token>', 'identity')` so a
 * destructive rebuild can re-create the row. Until now NOTHING re-typed that
 * payload: `attachAflTablesIdentityInTransaction` merges `afltables_profile_path`
 * into it and nothing else, and the data editor writes its correction under the
 * player's AFL TABLES key instead. So a name corrected through the one sanctioned
 * surface left the creation record asserting the old name for ever. Two symptoms,
 * both general and neither about any particular player:
 *
 *   1. the two rows disagreed, and the replay had to pick one (fixed
 *      deterministically by the precedence rule in `common.py`, but a stale record
 *      still wins back the moment the higher-authority row is absent — an AFL
 *      Tables identity not yet `unique`/`resolved` at replay time is enough — or
 *      is deactivated);
 *   2. for a manual player who has NO AFL Tables identity yet,
 *      `getEntityNaturalKey` returns null and the editor writes no durable
 *      override AT ALL, so the correction was never durable in the first place.
 *
 * This runs inside the caller's transaction and writes its OWN `data_edits` row,
 * so the repair is audited as a distinct decision rather than hidden inside the
 * `name` edit's audit. A player with no manual token, or whose record is already
 * deactivated, is `'no_durable_record'` — there is no creation record to contradict
 * the canonical row, so there is nothing to repair and nothing to refuse.
 */
export async function syncManualIdentityNameRecord(
  tx: postgres.TransactionSql,
  input: {
    playerId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    adminUserId: number;
    note?: string | null;
  },
): Promise<ManualIdentitySyncOutcome> {
  const patch = manualIdentityNamePatchFor(input.before, input.after);
  if (patch === null) return 'no_change';

  const token = await readManualPlayerToken(tx, input.playerId);
  if (!token) return 'no_durable_record';

  const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
    SELECT override_values AS "overrideValues"
      FROM data_overrides
     WHERE entity_type = 'players'
       AND entity_key = ${manualEntityKey(token)}
       AND field_group = 'identity'
       AND is_active = true
     FOR UPDATE
  `;
  if (!existing) return 'no_durable_record';

  const updated = await tx<{ id: number }[]>`
    UPDATE data_overrides
       SET override_values = override_values || ${tx.json(patch as postgres.JSONValue)},
           admin_user_id = ${input.adminUserId},
           updated_at = now()
     WHERE entity_type = 'players'
       AND entity_key = ${manualEntityKey(token)}
       AND field_group = 'identity'
       AND is_active = true
    RETURNING id
  `;
  if (updated.length === 0) return 'no_durable_record';

  const oldValues: Record<string, unknown> = {};
  for (const field of MANUAL_IDENTITY_NAME_FIELDS) {
    oldValues[field] = existing.overrideValues[field] ?? null;
  }
  await recordDataEdit(tx, {
    tableName: 'players',
    rowId: input.playerId,
    fieldGroup: 'manual_identity_record',
    oldValues,
    newValues: patch,
    adminUserId: input.adminUserId,
    note: input.note,
  });
  return 'synced';
}

// ---------------------------------------------------------------------------
// The creation record's other editor-owned fields (AFLDB-ISSUE-277, D-277-1)
// ---------------------------------------------------------------------------

/**
 * The editor groups other than `name`, each with exactly the creation-record keys
 * it owns. They are the groups `getEntityNaturalKey('players')` writes NO override
 * for when the player has no AFL Tables identity, so a Data Editor save of one of
 * them was reverted by the next replay (AFLDB-ISSUE-277). Syncing the group into
 * the creation record makes it durable: the replay's INSERT branch re-creates the
 * row from `dob`, `dob_confidence`, `birth_year`, `height_cm`, `weight_kg` and
 * `notes`, and its merge UPDATE applies `birth_year_min`, `birth_year_max` and
 * `birth_year_confidence` to the re-created row in the same pass.
 *
 * The keys of a group are the editor spec's own fields for it; a source contract
 * test pins that equality.
 */
export const MANUAL_IDENTITY_RECORD_GROUPS = {
  dob: ['dob', 'dob_confidence'],
  birth_year: ['birth_year', 'birth_year_min', 'birth_year_max', 'birth_year_confidence'],
  height_cm: ['height_cm'],
  weight_kg: ['weight_kg'],
  notes: ['notes'],
} as const satisfies Record<string, readonly string[]>;

export type ManualIdentityRecordGroup = keyof typeof MANUAL_IDENTITY_RECORD_GROUPS;

export function isManualIdentityRecordGroup(groupKey: string): groupKey is ManualIdentityRecordGroup {
  return Object.prototype.hasOwnProperty.call(MANUAL_IDENTITY_RECORD_GROUPS, groupKey);
}

export type ManualIdentityRecordPatch = Record<string, string | number | null>;

/**
 * The patch to merge into the creation record after a save of `groupKey`, or
 * `null` when the group is not one this module syncs or the save moved none of its
 * fields. Every field of the group is restated whenever any one moves, as for the
 * name: the record is a snapshot, and a half-updated pair (a new `dob` beside a
 * stale `dob_confidence`) would be a third answer to what the person is.
 *
 * The `dob` group mirrors the editor's own write (`applyPlayerEdit`): a cleared
 * date is stored with the confidence `'unknown'`, whatever the form sent.
 * Absent and `undefined` read as an explicit `null`, which the replay applies as
 * "clear this column". Pure, and exercised directly by the source contract test.
 */
export function manualIdentityRecordPatchFor(
  groupKey: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ManualIdentityRecordPatch | null {
  if (!isManualIdentityRecordGroup(groupKey)) return null;
  const patch: ManualIdentityRecordPatch = {};
  for (const field of MANUAL_IDENTITY_RECORD_GROUPS[groupKey]) {
    const value = after[field] ?? null;
    patch[field] = value as string | number | null;
  }
  if (groupKey === 'dob') {
    patch.dob_confidence = patch.dob === null ? 'unknown' : (patch.dob_confidence ?? 'unknown');
  }
  const same = (a: unknown, b: unknown) =>
    (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));
  const moved = MANUAL_IDENTITY_RECORD_GROUPS[groupKey].some((field) => !same(before[field], patch[field]));
  return moved ? patch : null;
}

/**
 * Whether the replay's fail-closed pre-check would refuse this creation record.
 * Mirrors the first three arms of the `CASE` in `replay_admin_overrides('players')`
 * (`tools/migration/common.py`): a record with no `display_name` cannot re-create
 * the row, and a record carrying a `dob` with no usable `dob_confidence` violates
 * `players_dob_confidence_ck` (migration 018). The fourth arm, an
 * `afltables_profile_path` that resolves to more than one player, is a property of
 * the whole database and not of one edit, and is not the editor's to decide.
 *
 * The refusal names the replay's own wording so an operator can match the two. An
 * integration case runs the REAL replay over a record this function accepts and
 * over one it refuses, so the mirror cannot drift silently.
 */
export function manualIdentityRecordReplayProblem(record: Record<string, unknown>): string | null {
  if (record.display_name === undefined || record.display_name === null) {
    return 'the record carries no display_name to re-create the row with';
  }
  const dobConfidence = record.dob_confidence ?? 'unknown';
  if (record.dob !== undefined && record.dob !== null && dobConfidence === 'unknown') {
    return 'the record carries a dob with no dob_confidence (players_dob_confidence_ck, migration 018)';
  }
  return null;
}

export type ManualIdentityRecordPlan =
  | { kind: 'skip'; outcome: 'no_change' | 'no_durable_record' }
  | { kind: 'refused'; error: string }
  | {
      kind: 'write';
      token: string;
      patch: ManualIdentityRecordPatch;
      existing: Record<string, unknown>;
    };

/**
 * Decide, BEFORE the canonical write, how an editor save of `groupKey` reaches the
 * creation record of a player who has no AFL Tables identity (AFLDB-ISSUE-277,
 * D-277-1). Nothing is written here; the creation record is read `FOR UPDATE` so
 * the plan cannot go stale before {@link applyManualIdentityRecordSync} uses it.
 *
 * THE GUARD. The merged record is checked against the replay's own pre-check, and
 * a save that would leave it unreplayable is refused whole, with nothing written.
 * A record that was ALREADY unreplayable for the same reason is not made worse by
 * the save, so it is not refused for it: the replay refuses that record on its own.
 *
 * `skip` outcomes: the group is not synced or nothing moved (`no_change`), or the
 * player has no manual token or no active creation record (`no_durable_record`),
 * in which case there is no durable record anywhere and the save is exactly as
 * non-durable as it was before this change.
 */
export async function planManualIdentityRecordSync(
  tx: postgres.TransactionSql,
  input: {
    playerId: number;
    groupKey: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  },
): Promise<ManualIdentityRecordPlan> {
  const patch = manualIdentityRecordPatchFor(input.groupKey, input.before, input.after);
  if (patch === null) return { kind: 'skip', outcome: 'no_change' };

  const token = await readManualPlayerToken(tx, input.playerId);
  if (!token) return { kind: 'skip', outcome: 'no_durable_record' };

  const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
    SELECT override_values AS "overrideValues"
      FROM data_overrides
     WHERE entity_type = 'players'
       AND entity_key = ${manualEntityKey(token)}
       AND field_group = 'identity'
       AND is_active = true
     FOR UPDATE
  `;
  if (!existing) return { kind: 'skip', outcome: 'no_durable_record' };

  const problem = manualIdentityRecordReplayProblem({ ...existing.overrideValues, ...patch });
  if (problem !== null && problem !== manualIdentityRecordReplayProblem(existing.overrideValues)) {
    return {
      kind: 'refused',
      error: 'This change was not saved. It would leave the player\'s durable creation record '
        + `unable to be replayed: ${problem}.`,
    };
  }
  return { kind: 'write', token, patch, existing: existing.overrideValues };
}

/**
 * Write a `write` plan into the creation record and audit it. Same transaction as
 * the canonical edit and its own `data_edits` row (`manual_identity_record`), as
 * for the name sync, so the repair is a distinct decision in the trail and a
 * failed audit rolls the whole save back (AFLDB-ISSUE-027).
 */
export async function applyManualIdentityRecordSync(
  tx: postgres.TransactionSql,
  plan: Extract<ManualIdentityRecordPlan, { kind: 'write' }>,
  input: { playerId: number; adminUserId: number; note?: string | null },
): Promise<void> {
  const updated = await tx<{ id: number }[]>`
    UPDATE data_overrides
       SET override_values = override_values || ${tx.json(plan.patch as postgres.JSONValue)},
           admin_user_id = ${input.adminUserId},
           updated_at = now()
     WHERE entity_type = 'players'
       AND entity_key = ${manualEntityKey(plan.token)}
       AND field_group = 'identity'
       AND is_active = true
    RETURNING id
  `;
  // The row was locked FOR UPDATE by the plan in this transaction, so it cannot have gone.
  if (updated.length === 0) throw new Error('The player\'s durable creation record disappeared during the save.');

  const oldValues: Record<string, unknown> = {};
  for (const field of Object.keys(plan.patch)) oldValues[field] = plan.existing[field] ?? null;
  await recordDataEdit(tx, {
    tableName: 'players',
    rowId: input.playerId,
    fieldGroup: 'manual_identity_record',
    oldValues,
    newValues: plan.patch,
    adminUserId: input.adminUserId,
    note: input.note,
  });
}
