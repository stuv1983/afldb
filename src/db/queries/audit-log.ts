import 'server-only';

import type postgres from 'postgres';

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
  | 'fixtures';

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
};

export async function recordDataEdit(
  tx: postgres.TransactionSql,
  input: DataEditAuditInput,
): Promise<void> {
  await tx`
    INSERT INTO data_edits
          (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
    VALUES (${input.tableName}, ${input.rowId}, ${input.fieldGroup},
            ${tx.json(input.oldValues as postgres.JSONValue)},
            ${tx.json(input.newValues as postgres.JSONValue)},
            ${input.adminUserId},
            ${(input.note ?? '').trim().slice(0, 2000) || null})
  `;
}
