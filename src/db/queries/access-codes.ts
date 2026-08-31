import 'server-only';

import type postgres from 'postgres';

/**
 * Permanent deletion of a beta access code (AFLDB-ISSUE-117).
 *
 * Revocation stops a code and keeps its row; deletion removes the row
 * once it is obsolete. The lifecycle is Active -> Revoke -> Delete, and
 * the second arrow is the one that has to be enforced somewhere real.
 *
 * CONTRACT: `revoked_at IS NOT NULL` lives in the statement, not in the
 * caller and not in the browser. Hiding the button on a live code is
 * presentation; this predicate is the rule. A forged POST naming a live
 * code's id matches no row, deletes nothing and returns null, which the
 * action reports as a refusal — the same answer an unknown id gets, so
 * the endpoint does not become an oracle for which ids exist.
 *
 * Takes a transaction handle rather than a pool, for the same reason
 * recordDataEdit does (src/db/queries/audit-log.ts): the destructive
 * statement and its audit row must commit together or not at all. Both
 * run as afldb_auth, so unlike the 066 case they need no second role —
 * one `authSql.begin` is enough. The DELETE grant itself is migration
 * 079, mirrored in tools/maintenance/privileges.sql.
 */
export type DeletedAccessCode = {
  id: number;
  label: string;
  /** Non-null by construction: the predicate below admits no live code. */
  revokedAt: Date;
};

export async function deleteRevokedAccessCode(
  tx: postgres.TransactionSql,
  id: number,
): Promise<DeletedAccessCode | null> {
  const [row] = await tx<DeletedAccessCode[]>`
    DELETE FROM beta_access_codes
     WHERE id = ${id}
       AND revoked_at IS NOT NULL
    RETURNING id, label, revoked_at AS "revokedAt"
  `;
  return row ?? null;
}
