// lib | Coleman projection planner pure functions for award_winners
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.

/**
 * AFLDB V2 Launch F (stream F-D) - the PURE planner behind the Coleman projection into the
 * canonical winners table (docs/v2/adr/0015-coleman-publication.md).
 *
 * `publishColemanResult` writes the append-only derivation ledger. Projecting the published
 * derivation into the canonical winners table is a separate step done by a server-side port
 * (`src/db/queries/coleman-award-winners.ts`). This module is the part of that step that needs no
 * database: given the derivation, the canonical display names and the rows already stored, it
 * decides what each row becomes. The port loads the rows, calls {@link planColemanProjection}, and
 * either applies the plan inside the publisher's transaction or reports it read-only (the preview).
 * Planning and applying are split so the preview and the write cannot disagree.
 *
 * The idempotency key is the Python loader's own key, `(source, source_record_id =
 * coleman:<season>:<profile path>)`. A derived row is built in the loader's EXACT column format
 * (the loader is `tools/migration/import_awards.py`, `import_coleman`), so the loader's keyed
 * reload sees the same keys and the same values and has nothing to correct.
 *
 * Decision per derived winner key:
 *   no stored row ........................... inserted
 *   stored row, void ........................ refused (derived_row_voided)
 *   stored row, active, FULL tuple equal .... retained
 *   stored row, active, any column differs .. updated (refused when an administrator override exists)
 * Decision per ACTIVE stored Coleman row of the season whose key is no longer derived:
 *   source = the contract source and key = coleman:<season>:... ..... voided (override: refused)
 *   any other owner (manual edit, legacy source, unknown) ........... refused (foreign_winner_rows)
 *
 * Pure: no database, no clock, no I/O.
 */
import type { ColemanDerivation, ColemanWinner } from './coleman';
import type {
  ColemanProjectionAction,
  ColemanProjectionActionKind,
  ColemanProjectionCounts,
  ColemanProjectionRefusalCode,
} from './coleman-publication';

/**
 * The note the loader writes on a derived row, byte for byte
 * (`tools/migration/import_awards.py`, `import_coleman`, `note = f"Derived from AFLDB home-and-away
 * match statistics: {goals} goals (coleman-derivation.json method_version {method_version})"`).
 * tests/v2-coleman-projection.test.ts reads the Python file and pins this template to it.
 */
export function colemanProjectionNote(goals: number, methodVersion: number): string {
  return `Derived from AFLDB home-and-away match statistics: ${goals} goals (coleman-derivation.json method_version ${methodVersion})`;
}

/** The link status the loader gives a derived row ("born linked": the player id is canonical). */
export const COLEMAN_ROW_LINK_STATUS = 'resolved';

/**
 * The loader's column tuple for one derived row: every column `import_coleman` asserts on a keyed
 * reload except the award, the season and the key itself. Two rows are "the same" only when every
 * field is equal (review F-002): a goals-only change moves the note and makes the row `updated`.
 */
export interface ColemanWinnerRowValues {
  readonly playerId: number | null;
  readonly playerNameRaw: string;
  readonly linkStatus: string;
  readonly candidateCount: number;
  readonly clubId: number | null;
  readonly clubNameRaw: string | null;
  /** `numeric(8,2)` carried as text; the loader leaves it NULL (a goal total is not a vote total). */
  readonly votes: string | null;
  readonly position: string | null;
  readonly isCaptain: boolean;
  readonly isViceCaptain: boolean;
  readonly note: string | null;
}

export const COLEMAN_ROW_FIELDS = [
  'playerId', 'playerNameRaw', 'linkStatus', 'candidateCount', 'clubId', 'clubNameRaw',
  'votes', 'position', 'isCaptain', 'isViceCaptain', 'note',
] as const satisfies readonly (keyof ColemanWinnerRowValues)[];

/** The values the loader would write for one derived winner. */
export function desiredColemanRow(
  winner: ColemanWinner,
  playerNameRaw: string,
  methodVersion: number,
): ColemanWinnerRowValues {
  return {
    playerId: Number(winner.playerId),
    playerNameRaw,
    linkStatus: COLEMAN_ROW_LINK_STATUS,
    candidateCount: 0,
    clubId: winner.clubId === null ? null : Number(winner.clubId),
    clubNameRaw: null,
    votes: null,
    position: null,
    isCaptain: false,
    isViceCaptain: false,
    note: colemanProjectionNote(winner.goals, methodVersion),
  };
}

/** The fields on which two rows differ (empty = equal). */
export function changedColemanFields(
  before: ColemanWinnerRowValues,
  after: ColemanWinnerRowValues,
): (typeof COLEMAN_ROW_FIELDS)[number][] {
  return COLEMAN_ROW_FIELDS.filter((field) => before[field] !== after[field]);
}

/** One stored `award_winners` row of the Coleman award, as the port loads it. */
export interface ColemanStoredRow extends ColemanWinnerRowValues {
  readonly id: number;
  readonly awardId: number;
  readonly season: number | null;
  readonly status: string;
  readonly sourceKey: string | null;
  readonly sourceRecordId: string | null;
}

export interface ColemanProjectionPlanInput {
  readonly derivation: ColemanDerivation;
  /** The Coleman `awards.id`. A stored row of another award is foreign. */
  readonly awardId: number;
  /** The contract's source key (`afltables`): the owner of every derived row. */
  readonly sourceKey: string;
  /** `players.display_name` by player id (as a string, the derivation's id form). */
  readonly displayNames: Readonly<Record<string, string>>;
  /** The Coleman rows of the season (any status) plus any row holding a derived key. */
  readonly stored: readonly ColemanStoredRow[];
  /** Entity keys with a `data_overrides` row (see {@link ColemanProjectionPlanInput.entityKeyOf}). */
  readonly overriddenEntityKeys: ReadonlySet<string>;
  /** The durable `data_overrides` key of a row: `<source key>:<source_record_id>`. */
  readonly entityKeyOf: (sourceRecordId: string) => string;
}

export interface ColemanPlannedRow {
  readonly action: ColemanProjectionActionKind;
  /** `award_winners.source_record_id`. */
  readonly key: string;
  readonly entityKey: string;
  /** Null for an insert that has not been applied yet. */
  readonly awardWinnerId: number | null;
  /** The stored values before the action (null for an insert). */
  readonly before: ColemanWinnerRowValues | null;
  /** The values after the action (null for a void). */
  readonly after: ColemanWinnerRowValues | null;
  /** The fields that change (updated only). */
  readonly changedFields: readonly string[];
}

export interface ColemanProjectionPlanRefusal {
  readonly code: ColemanProjectionRefusalCode;
  readonly message: string;
  /** The offending rows or keys. */
  readonly subjects: readonly string[];
}

export type ColemanProjectionPlan =
  | { readonly ok: false; readonly refusal: ColemanProjectionPlanRefusal }
  | {
    readonly ok: true;
    readonly season: number;
    readonly planned: readonly ColemanPlannedRow[];
    readonly counts: ColemanProjectionCounts;
    /** inserted + updated + voided. */
    readonly changedCount: number;
  };

/** What the operator sees before publishing: the same plan, as plain data. */
export type ColemanProjectionPreview =
  | { readonly ok: false; readonly refusal: ColemanProjectionPlanRefusal }
  | {
    readonly ok: true;
    readonly counts: ColemanProjectionCounts;
    readonly changedCount: number;
    readonly actions: readonly ColemanProjectionAction[];
  };

const SUBJECT_LIMIT = 20;

function subjectOf(row: ColemanStoredRow): string {
  return `#${row.id} ${row.sourceKey ?? 'no source'}:${row.sourceRecordId ?? 'no key'}`;
}

function capped(subjects: string[]): string[] {
  return subjects.length <= SUBJECT_LIMIT ? subjects : [...subjects.slice(0, SUBJECT_LIMIT), `... and ${subjects.length - SUBJECT_LIMIT} more`];
}

/**
 * Plan the projection of one derivation. Total and deterministic: the same input yields the same
 * plan. A refusal names every offending row of its kind; when several kinds apply the first of
 * `player_missing`, `foreign_winner_rows`, `derived_row_voided`, `admin_override_present` is
 * returned (fix it, run again).
 */
export function planColemanProjection(input: ColemanProjectionPlanInput): ColemanProjectionPlan {
  const { derivation, awardId, sourceKey, displayNames, stored, overriddenEntityKeys, entityKeyOf } = input;
  const season = derivation.season;
  const keyPrefix = `coleman:${season}:`;

  const missingPlayers: string[] = [];
  for (const winner of derivation.winners) {
    if (typeof displayNames[winner.playerId] !== 'string' || displayNames[winner.playerId].trim() === '') {
      missingPlayers.push(`${winner.key} (player ${winner.playerId})`);
    }
  }

  const byKey = new Map<string, ColemanStoredRow>();
  for (const row of stored) {
    if (row.sourceKey === sourceKey && row.sourceRecordId !== null) byKey.set(row.sourceRecordId, row);
  }
  const derivedKeys = new Set(derivation.winners.map((winner) => winner.key));

  const foreign: string[] = [];
  const voided: string[] = [];
  const overridden: string[] = [];
  const planned: ColemanPlannedRow[] = [];

  for (const winner of derivation.winners) {
    const entityKey = entityKeyOf(winner.key);
    const name = displayNames[winner.playerId];
    if (typeof name !== 'string' || name.trim() === '') continue; // reported as player_missing
    const desired = desiredColemanRow(winner, name, derivation.methodVersion);
    const row = byKey.get(winner.key);
    if (row === undefined) {
      planned.push({ action: 'inserted', key: winner.key, entityKey, awardWinnerId: null, before: null, after: desired, changedFields: [] });
      continue;
    }
    if (row.awardId !== awardId || row.season !== season) {
      foreign.push(`${subjectOf(row)} (award ${row.awardId}, season ${row.season ?? 'none'})`);
      continue;
    }
    if (row.status !== 'active') {
      voided.push(subjectOf(row));
      continue;
    }
    const changedFields = changedColemanFields(row, desired);
    if (changedFields.length === 0) {
      planned.push({ action: 'retained', key: winner.key, entityKey, awardWinnerId: row.id, before: row, after: desired, changedFields });
      continue;
    }
    if (overriddenEntityKeys.has(entityKey)) {
      overridden.push(subjectOf(row));
      continue;
    }
    planned.push({ action: 'updated', key: winner.key, entityKey, awardWinnerId: row.id, before: row, after: desired, changedFields });
  }

  // Active Coleman rows of the season that this derivation no longer supports.
  for (const row of [...stored].sort((a, b) => a.id - b.id)) {
    if (row.awardId !== awardId || row.season !== season || row.status !== 'active') continue;
    if (row.sourceKey === sourceKey && row.sourceRecordId !== null && derivedKeys.has(row.sourceRecordId)) continue;
    const ours = row.sourceKey === sourceKey && row.sourceRecordId !== null && row.sourceRecordId.startsWith(keyPrefix);
    if (!ours) {
      foreign.push(subjectOf(row));
      continue;
    }
    const entityKey = entityKeyOf(row.sourceRecordId as string);
    if (overriddenEntityKeys.has(entityKey)) {
      overridden.push(subjectOf(row));
      continue;
    }
    planned.push({ action: 'voided', key: row.sourceRecordId as string, entityKey, awardWinnerId: row.id, before: row, after: null, changedFields: [] });
  }

  if (missingPlayers.length > 0) {
    return refusal(
      'player_missing',
      `Refused: ${missingPlayers.length} derived winner(s) have no player record to take the canonical display name from; nothing was written.`,
      missingPlayers,
    );
  }
  if (foreign.length > 0) {
    return refusal(
      'foreign_winner_rows',
      `Refused: season ${season} holds ${foreign.length} Coleman winner row(s) this derivation does not own (a manual or legacy entry, or a row under another key). Void or re-own them in /admin/awards, then publish again; nothing was written.`,
      foreign,
    );
  }
  if (voided.length > 0) {
    return refusal(
      'derived_row_voided',
      `Refused: ${voided.length} derived winner(s) are stored as voided rows. A void is an administrator decision that publication does not override; reinstate the row in /admin/awards first. Nothing was written.`,
      voided,
    );
  }
  if (overridden.length > 0) {
    return refusal(
      'admin_override_present',
      `Refused: ${overridden.length} stored Coleman row(s) that publication would change carry an administrator override that the offline loader replays; a publication must not fight it. Resolve the override in /admin/awards, then publish again; nothing was written.`,
      overridden,
    );
  }

  const counts: ColemanProjectionCounts = {
    inserted: planned.filter((p) => p.action === 'inserted').length,
    updated: planned.filter((p) => p.action === 'updated').length,
    voided: planned.filter((p) => p.action === 'voided').length,
    retained: planned.filter((p) => p.action === 'retained').length,
  };
  return { ok: true, season, planned, counts, changedCount: counts.inserted + counts.updated + counts.voided };
}

function refusal(code: ColemanProjectionRefusalCode, message: string, subjects: string[]): ColemanProjectionPlan {
  return { ok: false, refusal: { code, message, subjects: capped(subjects) } };
}

/** The plan as the read-only preview the compare step shows (nothing has been written). */
export function previewOfColemanProjection(plan: ColemanProjectionPlan): ColemanProjectionPreview {
  if (!plan.ok) return plan;
  return {
    ok: true,
    counts: plan.counts,
    changedCount: plan.changedCount,
    actions: plan.planned.map((row) => ({ entityKey: row.entityKey, action: row.action, awardWinnerId: row.awardWinnerId })),
  };
}
