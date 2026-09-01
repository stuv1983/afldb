/**
 * AFLDB-ISSUE-119 — deterministic disposable seed for the telemetry-clear
 * acceptance harness.
 *
 * WHAT THIS DOES TO THE TARGET DATABASE
 *
 * reseed() DELETEs every row from nl_search_review, nl_search_feedback,
 * app_health_events and nl_search_log on the database AFLDB_TEST_DATABASE_URL
 * names, then inserts a fixed 11-log fixture. This is a full wipe, on
 * purpose: the clear function reports table-wide counts
 * (retained_review_rows = count(*) over the whole table, etc.), so a
 * deterministic assertion on those counts is only possible from a known
 * empty starting point. That is safe here and nowhere else because
 * target-guard.ts refuses to run unless the database name ends in _test,
 * is not afldb_dev / production, and the operator has set
 * AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM to that exact name. The deployment
 * under test is a throwaway the operator stood up for this run.
 *
 * THE FIXTURE  (ids returned by reseed())
 *
 *   retained (6) — must all survive a clear:
 *     gp  ─ grandparent ─ parent ─ leaf(REVIEWED)          ancestry chain, depth 4
 *     fbParent ─ fbMatched(client_ref = REF_MATCHED, has feedback)
 *   disposable (5) — must all be deleted:
 *     sibling      parent_search_id = grandparent  (sibling off a mid-chain ancestor)
 *     childOfLeaf  parent_search_id = leaf         (child of a retained row)
 *     plain1, plain2                                (ordinary reader telemetry)
 *     synthetic    run_tag = 'issue-119-e2e'       (unprotected synthetic run)
 *
 *   feedback (2): REF_MATCHED (matches fbMatched) + REF_ORPHAN (no log — a
 *     deferred feedback whose log never landed; retained outright).
 *   reviews (1): on leaf.
 *   app_health_events (3): one linked to plain1 (link detached, row kept),
 *     one linked to leaf (link kept), one with related_search_id NULL.
 *
 * EXPECTED CLEAR RESULT (exact, because the wipe gives a clean slate):
 *   deleted_log_rows          = 5
 *   retained_log_rows         = 6
 *   retained_review_rows      = 1
 *   retained_feedback_rows    = 2
 *   detached_app_health_links = 1
 *
 * Re-running the destructive spec is only meaningful after another
 * reseed(): once a clear has removed the 5 disposable rows, a second clear
 * would report deleted_log_rows = 0. Every destructive test calls
 * reseed() itself for that reason.
 */
import postgres from 'postgres';

import { assertDisposableTestDatabase } from './target-guard';

/** Fixed client_refs so the fixture is byte-identical every reseed. */
const REF_MATCHED = '11111111-1111-4111-8111-111111111111';
const REF_ORPHAN = '22222222-2222-4222-8222-222222222222';

/** Distinct sentinels, only for readability in a manual DB inspection. */
const RUN_TAG = 'issue-119-e2e';
const MARKER_TAG = 'issue-119-e2e-marker';
const HEALTH_ROUTE = '/__issue-119-e2e__';

export const EXPECTED = {
  deletedLogRows: 5,
  retainedLogRows: 6,
  retainedReviewRows: 1,
  retainedFeedbackRows: 2,
  detachedAppHealthLinks: 1,
} as const;

export type FixtureIds = {
  retained: number[];
  disposable: number[];
};

export type TableCounts = {
  logs: number;
  reviews: number;
  feedback: number;
  healthRows: number;
  attachedLinks: number;
};

const { dsn } = assertDisposableTestDatabase();

/**
 * One low-concurrency connection for the whole run, closed by close() in
 * the spec's afterAll. Not @/db/client: that module is server-only and
 * reads the application DSN. This connects with the validated _test DSN
 * directly, the way the integration suite's dedicated clients do.
 */
const sql = postgres(dsn, { max: 1, idle_timeout: 5, onnotice: () => {} });

async function insertLog(
  question: string,
  opts: { parentId?: number; clientRef?: string; runTag?: string } = {},
): Promise<number> {
  // id::int — postgres.js returns int8 as a string, and these ids feed
  // number comparisons and IN () lists.
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO nl_search_log (question, outcome, parent_search_id, client_ref, run_tag)
    VALUES (${question}, 'answered', ${opts.parentId ?? null},
            ${opts.clientRef ?? null}, ${opts.runTag ?? null})
    RETURNING id::int AS id
  `;
  return row.id;
}

/** DELETE (not TRUNCATE) in FK-safe order: children before nl_search_log. */
async function wipe(): Promise<void> {
  await sql`DELETE FROM nl_search_review`;
  await sql`DELETE FROM app_health_events`;
  await sql`DELETE FROM nl_search_feedback`;
  await sql`DELETE FROM nl_search_log`;
}

/**
 * Wipes and rebuilds the fixture. Returns the fixture ids and the table
 * counts immediately after seeding (before any clear), so a caller can
 * assert "nothing changed" after a non-destructive interaction.
 */
export async function reseed(): Promise<{ ids: FixtureIds; counts: TableCounts }> {
  await wipe();

  // Retained ancestry chain, depth 4. Only the leaf is protected directly.
  const gp = await insertLog('ISSUE-119 E2E ancestry great-grandparent');
  const grandparent = await insertLog('ISSUE-119 E2E ancestry grandparent', { parentId: gp });
  const parent = await insertLog('ISSUE-119 E2E ancestry parent', { parentId: grandparent });
  const leaf = await insertLog('ISSUE-119 E2E ancestry reviewed leaf', { parentId: parent });
  await sql`
    INSERT INTO nl_search_review (search_log_id, status, notes)
    VALUES (${leaf}, 'reviewing', 'ISSUE-119 E2E fixture')
  `;

  // Retained via matching feedback, plus its otherwise-disposable parent.
  const fbParent = await insertLog('ISSUE-119 E2E feedback parent');
  const fbMatched = await insertLog('ISSUE-119 E2E feedback matched leaf', {
    parentId: fbParent,
    clientRef: REF_MATCHED,
  });
  await sql`
    INSERT INTO nl_search_feedback (client_ref, verdict, expected_answer)
    VALUES (${REF_MATCHED}, 'incorrect', 'ISSUE-119 E2E matched feedback')
  `;
  // Feedback whose deferred log never landed — retained outright.
  await sql`
    INSERT INTO nl_search_feedback (client_ref, verdict)
    VALUES (${REF_ORPHAN}, 'correct')
  `;

  // Disposable rows: a sibling off a mid-chain ancestor, a child of the
  // retained leaf, plain telemetry, and an unprotected synthetic run.
  const sibling = await insertLog('ISSUE-119 E2E disposable sibling', { parentId: grandparent });
  const childOfLeaf = await insertLog('ISSUE-119 E2E disposable child of leaf', { parentId: leaf });
  const plain1 = await insertLog('ISSUE-119 E2E disposable plain one');
  const plain2 = await insertLog('ISSUE-119 E2E disposable plain two');
  const synthetic = await insertLog('ISSUE-119 E2E disposable synthetic', { runTag: RUN_TAG });

  // Health events: link to a disposable log (detached, row kept), link to
  // a retained log (kept), and an unlinked row.
  await sql`
    INSERT INTO app_health_events (event_type, route, related_search_id)
    VALUES ('PAGE_CRASH', ${HEALTH_ROUTE}, ${plain1}),
           ('PAGE_CRASH', ${HEALTH_ROUTE}, ${leaf}),
           ('PAGE_CRASH', ${HEALTH_ROUTE}, NULL)
  `;

  const ids: FixtureIds = {
    retained: [gp, grandparent, parent, leaf, fbParent, fbMatched].sort((a, b) => a - b),
    disposable: [sibling, childOfLeaf, plain1, plain2, synthetic].sort((a, b) => a - b),
  };
  return { ids, counts: await readCounts() };
}

/** Current row counts across the four tables the clear can touch. */
export async function readCounts(): Promise<TableCounts> {
  const [row] = await sql<TableCounts[]>`
    SELECT (SELECT count(*)::int FROM nl_search_log)      AS logs,
           (SELECT count(*)::int FROM nl_search_review)   AS reviews,
           (SELECT count(*)::int FROM nl_search_feedback) AS feedback,
           (SELECT count(*)::int FROM app_health_events)  AS "healthRows",
           (SELECT count(*)::int FROM app_health_events
             WHERE related_search_id IS NOT NULL)         AS "attachedLinks"
  `;
  return row;
}

/** The subset of `ids` that still exists in nl_search_log, ascending. */
export async function survivingLogIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM nl_search_log
     WHERE id IN ${sql(ids)}
     ORDER BY id
  `;
  return rows.map((r) => r.id);
}

/**
 * Inserts one uniquely-worded disposable log and returns its question
 * text. Used by the "prove the target is the disposable _test deployment"
 * test: the deployment's own super-admin export must show this row, which
 * it only can if the deployment reads the same database this seed wrote.
 */
export async function plantTargetMarker(): Promise<string> {
  const question = `ISSUE-119 E2E target proof ${Date.now().toString(36)}`;
  await insertLog(question, { runTag: MARKER_TAG });
  return question;
}

/** Removes any rows left by plantTargetMarker(). */
export async function removeTargetMarker(): Promise<void> {
  await sql`DELETE FROM nl_search_log WHERE run_tag = ${MARKER_TAG}`;
}

export async function close(): Promise<void> {
  await sql.end({ timeout: 5 });
}
