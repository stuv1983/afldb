import 'server-only';

import type postgres from 'postgres';

/**
 * Permanent deletion of a beta access code (AFLDB-ISSUE-117).
 *
 * Revocation stops a code and keeps its row; deletion removes the row
 * once it is obsolete. A code is **retired** — and so disposable — when
 * it can no longer be redeemed by its own terms:
 *
 *   * `revoked_at IS NOT NULL` — an admin stopped it; or
 *   * `use_count >= max_uses` — it is spent, and spent is permanent.
 *
 * Requiring a revoke before deleting a spent code was ceremony: the
 * revoke changed nothing a redeemer could observe, because the code was
 * already refused. Making the spent case deletable directly removes the
 * meaningless step without widening what may be destroyed.
 *
 * CONTRACT: this predicate is the rule. It lives in the statement, not
 * in the caller and not in the browser. Hiding the button on a live
 * code is presentation; a forged POST naming one matches no row,
 * deletes nothing and returns null — the same answer an unknown id
 * gets, so the endpoint does not become an oracle for which ids exist.
 *
 * THE INVARIANT, stated so it can be checked: every condition here is a
 * reason `redeemBetaCode` (src/app/beta/actions.ts) would refuse the
 * code. That query redeems only when
 *   `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
 *    AND (max_uses IS NULL OR use_count < max_uses)`,
 * so "revoked or spent" is a strict subset of "not redeemable" and a
 * code that could still let someone in can never be deleted. The subset
 * is strict on purpose: an EXPIRED code is also unredeemable but is NOT
 * deletable here, because expiry is a moving line — `expires_at` passes
 * on its own, without anyone deciding anything — and deletion is
 * irreversible. Widening to expiry is a deliberate change, not a
 * tidy-up. NULL `max_uses` means unlimited (migration 036), so an
 * unlimited code is never spent and always needs an explicit revoke.
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
  /** Null when the code was deleted for being spent rather than revoked. */
  revokedAt: Date | null;
  useCount: number;
  /** Null means unlimited (migration 036) — such a code is never spent. */
  maxUses: number | null;
};

export async function deleteRetiredAccessCode(
  tx: postgres.TransactionSql,
  id: number,
): Promise<DeletedAccessCode | null> {
  const [row] = await tx<DeletedAccessCode[]>`
    DELETE FROM beta_access_codes
     WHERE id = ${id}
       AND (
             revoked_at IS NOT NULL
             OR (max_uses IS NOT NULL AND use_count >= max_uses)
           )
    RETURNING id, label, revoked_at AS "revokedAt",
              use_count AS "useCount", max_uses AS "maxUses"
  `;
  return row ?? null;
}

/**
 * Why the row was disposable, for the audit trail.
 *
 * Revoked wins when a code is both, matching the state precedence the
 * admin table shows, so the trail and the UI never disagree about what
 * an admin was looking at when they pressed the button.
 */
export function retirementReason(code: DeletedAccessCode): 'revoked' | 'spent' {
  return code.revokedAt ? 'revoked' : 'spent';
}
