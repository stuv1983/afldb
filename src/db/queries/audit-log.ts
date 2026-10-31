import 'server-only';

import type postgres from 'postgres';

import type { AuditedCorrectionWorkflow } from '@afldb/domain';

import {
  enforceSealedEditorWrite,
  type SealReceipt,
  type SealScope,
} from '@/lib/seasons/sealed-editor-guard';

/**
 * Required mutation audit (AFLDB-ISSUE-027, migration 066).
 *
 * CONTRACT: this helper is for REQUIRED mutation audits and must be
 * called inside the same import-role transaction as the statistical
 * mutation it records — pass the `sql.begin` transaction handle, never
 * a pool. It acquires no connection of its own and deliberately has no
 * try/catch: a failed audit INSERT propagates, aborts the transaction,
 * and rolls the mutation back with it. That is the whole point — the
 * database can no longer hold a mutation without its audit row.
 *
 * afldb_import holds INSERT (only) on data_edits via migration 066,
 * reconciled in tools/maintenance/privileges.sql. Best-effort
 * administrative activity logging (auth_audit_log) is a different
 * system and stays on the auth pool; do not route it through here.
 */

/** Mirrors the data_edits_table_name_check constraint (migrations 057/058/094/095/097). */
export type DataEditTableName =
  | 'players'
  | 'matches'
  | 'draft_picks'
  | 'award_winners'
  | 'hall_of_fame'
  | 'honour_team_members'
  // Brownlow administration (migration 094, AFLDB-ISSUE-155 §27.13). The
  // audited row is the workflow DECISION -- the entry state keyed by
  // match_id, the season authority keyed by season -- not the fact rows
  // it writes, which carry their own provenance quartet.
  | 'brownlow_vote_entry_state'
  | 'brownlow_season_authority'
  // Coach administration (migration 095, AFLDB-ISSUE-159 §5.2). 'match_coaches'
  // is deliberately absent: its primary key is composite (match_id, club_id)
  // and row_id is a single bigint, so a coaching-assignment edit is audited
  // against its match instead -- table_name 'matches', field_group
  // 'coach_assignment'.
  | 'coaches'
  // Fixture administration (migration 097, AFLDB-ISSUE-162 §24). The audited
  // row is the FIXTURE itself, which is the AFLDB-ISSUE-160 draft_picks shape
  // rather than AFLDB-ISSUE-161's audit-on-the-parent: a season-list membership
  // is DELETABLE, so its audit row was pointed at the player instead, but a
  // fixture is NEVER deleted (cancelled and void keep the row) and it has no
  // allowlisted parent -- it is deliberately not a property of a match, because
  // the whole point is that the match may not exist. row_id = fixtures.id
  // therefore always resolves, through the fixture_key lineage rule in
  // tools/db/promotion-inventory.ts.
  | 'fixtures'
  // Club leadership administration (migration 098, AFLDB-ISSUE-163 §15). The
  // fixtures shape again, and for the same two reasons: an appointment is NEVER
  // deleted (ended and void keep the row), and it has no allowlisted parent row
  // to be a property OF -- it is deliberately not a property of the player,
  // because the row is about a club, a season and an office, and one person may
  // hold several. row_id = club_leadership.id therefore always resolves,
  // through the appointment_key lineage rule in tools/db/promotion-inventory.ts.
  | 'club_leadership'
  // The two curated special-record families (migration 102,
  // AFLDB-ISSUE-167 §6.4). The fixtures / club_leadership shape once more:
  // neither is ever deleted -- voiding keeps the row precisely so its audit
  // rows stay resolvable -- and neither has an allowlisted parent to be a
  // property of. A first-kick achievement is deliberately not audited against
  // its player, because the row is about a source's claim rather than about
  // the person, and its match_id is derived. row_id therefore always resolves,
  // through the first_kick_goal_key and after_siren_key lineage rules in
  // tools/db/promotion-inventory.ts, both of which read the durable
  // '<sources.key>|<source_record_id>' identity rather than the integer.
  | 'player_achievements'
  | 'after_siren_kicks';

/**
 * The same allowlist as a runtime value, for the read side
 * (`src/db/queries/audit-reader.ts`, AFLDB-ISSUE-157): a URL-supplied
 * table name is accepted only if it names a member, so the filter can
 * never bind a value the CHECK constraint would not have admitted.
 */
export const DATA_EDIT_TABLE_NAMES: readonly DataEditTableName[] = [
  'players',
  'matches',
  'draft_picks',
  'award_winners',
  'hall_of_fame',
  'honour_team_members',
  'brownlow_vote_entry_state',
  'brownlow_season_authority',
  'coaches',
  'fixtures',
  'club_leadership',
  'player_achievements',
  'after_siren_kicks',
];

export function isDataEditTableName(value: string): value is DataEditTableName {
  return (DATA_EDIT_TABLE_NAMES as readonly string[]).includes(value);
}

export type DataEditAuditInput = {
  tableName: DataEditTableName;
  rowId: number;
  /** A field key ('dob'), coupled-group key ('score'), or operation key ('match_sheet'). */
  fieldGroup: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  adminUserId: number;
  note?: string | null;
  /**
   * The HUMAN-written note the season seal evaluates, when `note` is not exactly what the admin
   * typed (a few editors append a fixed suffix to the stored note). Defaults to `note`. A fixed
   * suffix must never count toward the 20-character minimum.
   */
  sealNote?: string | null;
  /**
   * Server-internal only: a caller that already runs under a more specific audited workflow
   * (the Coleman publisher, curated award approval) names it so the receipt records that one.
   * It must come from server code, never from a form or a request. Default: derived from
   * `tableName` (see `workflowForAuditTable`).
   */
  sealWorkflow?: AuditedCorrectionWorkflow;
  /**
   * REQUIRED (V2-GAP-006, D-V2-GAP006-EDITORS E1): which seasons this mutation writes, so the
   * season seal can be applied inside this same transaction. See `SealScope`. There is no
   * default: a new editor mutation cannot be added without declaring its seasons.
   */
  seal: SealScope;
};

export type DataEditReceipt = {
  /** The id of the `data_edits` row just written (int8, so a string at runtime). */
  readonly id: string;
  readonly seal: SealReceipt;
};

/**
 * Writes the required audit row and applies the season seal in the SAME transaction.
 *
 * The seal runs AFTER the audit INSERT so that the correction's evidence reference names the real
 * row (`data_edits:<id>`, read back by RETURNING, never predicted). A refusal THROWS
 * `SealedEditorRefusal`, which aborts the transaction: the canonical write that preceded this
 * call, the audit row and every sibling write roll back together. A write wholly inside an open
 * season is unchanged and needs no note.
 */
export async function recordDataEdit(
  tx: postgres.TransactionSql,
  input: DataEditAuditInput,
): Promise<DataEditReceipt> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO data_edits
          (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
    VALUES (${input.tableName}, ${input.rowId}, ${input.fieldGroup},
            ${tx.json(input.oldValues as postgres.JSONValue)},
            ${tx.json(input.newValues as postgres.JSONValue)},
            ${input.adminUserId},
            ${(input.note ?? '').trim().slice(0, 2000) || null})
    RETURNING id
  `;
  const id = String(rows[0]!.id);
  const seal = await enforceSealedEditorWrite(tx, {
    tableName: input.tableName,
    rowId: input.rowId,
    scope: input.seal,
    actorUserId: input.adminUserId,
    // `sealNote` present (even as undefined) means `note` is not the human's text: evaluate only that.
    note: 'sealNote' in input ? input.sealNote : input.note,
    evidenceRef: `data_edits:${id}`,
    workflow: input.sealWorkflow,
  });
  return { id, seal };
}
