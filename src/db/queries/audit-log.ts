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

/** Mirrors the data_edits_table_name_check constraint (migrations 057/058). */
export type DataEditTableName =
  | 'players'
  | 'matches'
  | 'draft_picks'
  | 'award_winners'
  | 'hall_of_fame'
  | 'honour_team_members';

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
