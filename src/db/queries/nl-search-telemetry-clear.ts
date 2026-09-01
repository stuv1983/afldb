import 'server-only';

import type postgres from 'postgres';

/**
 * The one deletion capability over NL telemetry (AFLDB-ISSUE-119,
 * migration 081).
 *
 * This wraps public.nl_search_telemetry_clear(), a SECURITY DEFINER
 * function owned by afldb_owner with a pinned search_path and no
 * parameters. afldb_auth holds EXECUTE on it and no DELETE or TRUNCATE
 * on nl_search_log, nl_search_review or nl_search_feedback -- proven
 * against the live catalogue and as the role itself by
 * tests/integration/privileges.test.ts and
 * tests/integration/nl-search-telemetry-clear.test.ts. There is nothing
 * for this file to parameterise: the retained closure (reviews,
 * feedback and the full recursive parent_search_id ancestry above them)
 * is fixed in the function, so no caller can widen what is deleted.
 *
 * CONTRACT: pass a transaction handle from authSql.begin(), never the
 * pool. Two things depend on it. The function takes SHARE ROW EXCLUSIVE
 * locks on the four affected tables, and those define the cutoff for
 * concurrent telemetry writers -- on a pool they are released at
 * statement end and the cutoff evaporates. And the mandatory
 * auth_audit_log row must commit with the deletion or not at all, which
 * only holds if both are in the caller's transaction. Deliberately no
 * try/catch: a failure propagates and rolls the deletion back.
 *
 * It acquires no connection of its own and no fallback to authSql
 * exists, so the transaction cannot be forgotten by accident.
 */

/**
 * The five counts the function returns, and the only facts
 * AFLDB-ISSUE-119 §9 permits the audit event to record. Keys match the
 * audit payload one for one; no question, plan, client ref or deleted
 * id is available here, by design.
 */
export type NlTelemetryClearCounts = {
  deletedLogRows: number;
  retainedLogRows: number;
  retainedReviewRows: number;
  retainedFeedbackRows: number;
  detachedAppHealthLinks: number;
};

/**
 * All five columns are bigint, and postgres.js hands int8 back as a
 * JavaScript **string** (AFLDB-ISSUE-119 risk R3). Left uncast, the
 * audit row would record "0" instead of 0 and any arithmetic on a count
 * would concatenate: `deleted + retained` becomes "12" + "5" = "125".
 * So the row type states what the driver actually returns rather than
 * what the SQL type suggests, and every field goes through toCount()
 * below. The cast is deliberately here and not `::int` in the query: a
 * count above int4 range would make the database raise rather than let
 * this code decide what to do about it.
 */
type ClearCountsRow = {
  deletedLogRows: unknown;
  retainedLogRows: unknown;
  retainedReviewRows: unknown;
  retainedFeedbackRows: unknown;
  detachedAppHealthLinks: unknown;
};

/**
 * Converts one returned bigint to a number, or throws. Rejects rather
 * than coerces, because every silent conversion here is wrong: Number()
 * turns null and '' into 0, which would report a clear that deleted
 * nothing as a clear that deleted nothing -- indistinguishable from the
 * truth, and written to the audit trail as fact.
 */
function toCount(value: unknown, column: keyof NlTelemetryClearCounts): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value)
    : typeof value === 'number' ? value
      : typeof value === 'bigint' ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(
      `nl_search_telemetry_clear() returned ${column} as ${typeof value} `
      + `${JSON.stringify(String(value))}, which is not a count. The clear must `
      + 'not be audited on a value this code cannot read.',
    );
  }
  return n;
}

/**
 * Deletes every disposable nl_search_log row and reports what happened.
 *
 * Disposable means: no review, no feedback matching its client_ref, and
 * not an ancestor of a row protected by either. Reviews, feedback and
 * app_health_events rows are never deleted; the only change to
 * app-health is the schema's own ON DELETE SET NULL detaching links to
 * deleted logs. Identity sequences are not reset.
 *
 * The caller is responsible for the Super Admin check
 * (requireSuperAdmin(), before the transaction opens) and for writing
 * the audit row inside this same transaction.
 */
export async function clearNlSearchTelemetry(
  tx: postgres.TransactionSql,
): Promise<NlTelemetryClearCounts> {
  const rows = await tx<ClearCountsRow[]>`
    SELECT deleted_log_rows          AS "deletedLogRows",
           retained_log_rows         AS "retainedLogRows",
           retained_review_rows      AS "retainedReviewRows",
           retained_feedback_rows    AS "retainedFeedbackRows",
           detached_app_health_links AS "detachedAppHealthLinks"
      FROM public.nl_search_telemetry_clear()
  `;

  // RETURNS TABLE fed by one RETURN QUERY over a single-row SELECT:
  // exactly one row, always.
  // Anything else means the function is not the one this file was
  // written against, and the deletion has already happened -- so fail
  // and roll it back rather than audit a guess.
  if (rows.length !== 1) {
    throw new Error(
      `nl_search_telemetry_clear() returned ${rows.length} rows, expected exactly 1.`,
    );
  }
  const row = rows[0];

  return {
    deletedLogRows: toCount(row.deletedLogRows, 'deletedLogRows'),
    retainedLogRows: toCount(row.retainedLogRows, 'retainedLogRows'),
    retainedReviewRows: toCount(row.retainedReviewRows, 'retainedReviewRows'),
    retainedFeedbackRows: toCount(row.retainedFeedbackRows, 'retainedFeedbackRows'),
    detachedAppHealthLinks: toCount(row.detachedAppHealthLinks, 'detachedAppHealthLinks'),
  };
}
