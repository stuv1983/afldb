/**
 * AFLDB-ISSUE-119 — the retention/security contract of migration 081.
 *
 * public.nl_search_telemetry_clear() deletes disposable nl_search_log rows
 * and nothing else. "Disposable" is defined by exclusion: a log row
 * carrying a review, matching reader feedback by client_ref, or standing
 * ANYWHERE in the parent_search_id ancestry of such a row — to arbitrary
 * depth — must survive. Reviews, feedback (matched or orphaned), health
 * events, audit history and everything unrelated survive unconditionally;
 * app_health_events links to deleted logs are detached by the FK's own
 * ON DELETE SET NULL; identity sequences are never reset.
 *
 * The multi-level ancestry fixture below is an operator requirement
 * (runbook §13/§16.2): a chain deeper than one parent, because a
 * single-hop fixture also passes against a non-recursive join and so
 * cannot detect the exact defect the recursive closure exists to prevent.
 * The mid-chain disposable sibling proves retention follows ancestry, not
 * the whole connected component.
 *
 * Safety: every destructive path here runs inside a transaction that is
 * always rolled back (the database.test.ts Rollback idiom). The suite
 * refuses to run outside a _test database (tests/setup.ts, guard.ts), and
 * the restricted-credential tests skip explicitly — never falling back to
 * the owner DSN — when AFLDB_TEST_AUTH_DATABASE_URL is absent.
 */
import './guard';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

import { sql } from '@/db/client';

const CLEAR_FN = 'public.nl_search_telemetry_clear()';

export const AUTH_ROLE_CLEAR_SKIP_MESSAGE =
  'AFLDB_TEST_AUTH_DATABASE_URL is not set; restricted auth-role clear validation was not run.';

// guard.ts has already made this fatal when absent.
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL as string;
const authDsn = process.env.AFLDB_TEST_AUTH_DATABASE_URL;

function parseDsn(name: string, dsn: string): { database: string; endpoint: string } {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`${name} is not a valid connection URL.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error(`${name} does not name a database.`);
  return { database, endpoint: `${url.hostname.toLowerCase()}:${url.port || '5432'}` };
}

// The same target-parity rules AFLDB_TEST_IMPORT_DATABASE_URL obeys
// (import-role-parity.ts): _test suffix, and the exact endpoint/database
// the owner DSN names. A wrong value fails the whole file with a sentence
// rather than mutating some other database as afldb_auth.
if (authDsn) {
  const owner = parseDsn('AFLDB_TEST_DATABASE_URL', ownerDsn);
  const restricted = parseDsn('AFLDB_TEST_AUTH_DATABASE_URL', authDsn);
  if (!/_test$/.test(restricted.database)) {
    throw new Error(
      `AFLDB_TEST_AUTH_DATABASE_URL points at '${restricted.database}', which is not a _test `
      + 'database. Restricted auth-role clear validation was refused.',
    );
  }
  if (owner.database !== restricted.database || owner.endpoint !== restricted.endpoint) {
    throw new Error(
      'AFLDB_TEST_AUTH_DATABASE_URL must target the same PostgreSQL test database as '
      + `AFLDB_TEST_DATABASE_URL. Owner target: ${owner.endpoint}/${owner.database}; `
      + `restricted target: ${restricted.endpoint}/${restricted.database}.`,
    );
  }
}

/** Thrown to force a rollback once every assertion has run (database.test.ts idiom). */
class Rollback extends Error {}

type Db = typeof sql;

/** Runs destructive assertions inside a transaction that is always rolled back. */
async function rolledBack(db: Db, run: (tx: Db) => Promise<void>): Promise<void> {
  await expect(
    db.begin(async (tx) => {
      await run(tx as unknown as Db);
      throw new Rollback('rolled back on purpose');
    }),
  ).rejects.toThrow('rolled back on purpose');
}

async function insertLog(
  tx: Db,
  question: string,
  opts: { parentId?: number; clientRef?: string; runTag?: string } = {},
): Promise<number> {
  // id::int — postgres.js returns int8 as a string, and these ids feed
  // number comparisons below.
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO nl_search_log (question, outcome, parent_search_id, client_ref, run_tag)
    VALUES (${question}, 'answered', ${opts.parentId ?? null},
            ${opts.clientRef ?? null}, ${opts.runTag ?? null})
    RETURNING id::int AS id
  `;
  return row.id;
}

async function survivors(tx: Db, ids: number[]): Promise<number[]> {
  const rows = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM nl_search_log WHERE id IN ${tx(ids)} ORDER BY id
  `;
  return rows.map((r) => r.id);
}

type ClearCounts = {
  deleted: number;
  retainedLogs: number;
  retainedReviews: number;
  retainedFeedback: number;
  detached: number;
};

async function runClear(tx: Db): Promise<ClearCounts> {
  const [counts] = await tx<ClearCounts[]>`
    SELECT deleted_log_rows::int          AS deleted,
           retained_log_rows::int         AS "retainedLogs",
           retained_review_rows::int      AS "retainedReviews",
           retained_feedback_rows::int    AS "retainedFeedback",
           detached_app_health_links::int AS detached
      FROM public.nl_search_telemetry_clear()
  `;
  expect(counts, 'the clear function must return exactly one counts row').toBeDefined();
  return counts;
}

beforeAll(async () => {
  const [fn] = await sql<{ present: boolean }[]>`
    SELECT to_regprocedure(${CLEAR_FN}) IS NOT NULL AS present
  `;
  if (!fn?.present) {
    throw new Error(
      `${CLEAR_FN} is absent from this database, so the ISSUE-119 retention `
      + 'contract cannot be verified. Run npm run db:migrate:test rather than '
      + 'skipping: an unverifiable invariant is not a passing one.',
    );
  }
});

afterAll(async () => {
  await sql.end();
});

describe('retention contract (every destructive path rolled back)', () => {
  it('retains the full ancestor chain above a reviewed leaf, to arbitrary depth, and deletes the mid-chain sibling', async () => {
    await rolledBack(sql, async (tx) => {
      // The mandatory §13 fixture. Only the leaf is protected directly;
      // every ancestor above it is otherwise disposable — no review, no
      // feedback — so each survivor proves one more recursion step.
      const greatGrandparent = await insertLog(tx, 'ancestry fixture: great-grandparent');
      const grandparent = await insertLog(tx, 'ancestry fixture: grandparent', { parentId: greatGrandparent });
      const parent = await insertLog(tx, 'ancestry fixture: parent', { parentId: grandparent });
      const leaf = await insertLog(tx, 'ancestry fixture: reviewed leaf', { parentId: parent });
      await tx`
        INSERT INTO nl_search_review (search_log_id, status, notes)
        VALUES (${leaf}, 'reviewing', 'ISSUE-119 ancestry fixture')
      `;

      // Hanging off a MID-CHAIN ancestor, and off the protected leaf
      // itself: both connected to retained rows, neither an ancestor of
      // one. Retention must follow the parent chain upward only.
      const sibling = await insertLog(tx, 'ancestry fixture: disposable sibling', { parentId: grandparent });
      const childOfLeaf = await insertLog(tx, 'ancestry fixture: disposable child', { parentId: leaf });

      const counts = await runClear(tx);

      expect(
        await survivors(tx, [greatGrandparent, grandparent, parent, leaf, sibling, childOfLeaf]),
        'every ancestor survives; the sibling and the child do not',
      ).toEqual([greatGrandparent, grandparent, parent, leaf].sort((a, b) => a - b));
      expect(counts.deleted).toBeGreaterThanOrEqual(2);

      // The review is byte-unchanged and points at a live row: the FK
      // held through the delete without deferral.
      const [review] = await tx<{ status: string; notes: string; live: boolean }[]>`
        SELECT r.status, r.notes, (l.id IS NOT NULL) AS live
          FROM nl_search_review r
          LEFT JOIN nl_search_log l ON l.id = r.search_log_id
         WHERE r.search_log_id = ${leaf}
      `;
      expect(review).toEqual({ status: 'reviewing', notes: 'ISSUE-119 ancestry fixture', live: true });

      const [orphans] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM nl_search_review r
          LEFT JOIN nl_search_log l ON l.id = r.search_log_id
         WHERE l.id IS NULL
      `;
      expect(orphans.n, 'no review anywhere may be orphaned').toBe(0);
    });
  });

  it('keeps every feedback row — matched with its ancestry, and orphaned — and every review', async () => {
    await rolledBack(sql, async (tx) => {
      const matchedRef = randomUUID();
      const feedbackParent = await insertLog(tx, 'feedback fixture: disposable-but-ancestor parent');
      const matchedLog = await insertLog(tx, 'feedback fixture: matched log', {
        parentId: feedbackParent,
        clientRef: matchedRef,
      });
      await tx`
        INSERT INTO nl_search_feedback (client_ref, verdict, expected_answer)
        VALUES (${matchedRef}, 'incorrect', 'ISSUE-119 matched feedback fixture')
      `;

      // Feedback whose deferred log never landed: protected outright.
      const orphanRef = randomUUID();
      await tx`
        INSERT INTO nl_search_feedback (client_ref, verdict) VALUES (${orphanRef}, 'correct')
      `;

      // Ordinary reader telemetry and an unprotected synthetic run_tag
      // row: both are exactly what the operation exists to remove.
      const plainDisposable = await insertLog(tx, 'feedback fixture: plain disposable');
      const syntheticDisposable = await insertLog(tx, 'feedback fixture: synthetic disposable', {
        runTag: 'issue-119-test-fixture',
      });

      const [before] = await tx<{ feedback: number; reviews: number }[]>`
        SELECT (SELECT count(*)::int FROM nl_search_feedback) AS feedback,
               (SELECT count(*)::int FROM nl_search_review)   AS reviews
      `;

      const counts = await runClear(tx);

      expect(
        await survivors(tx, [feedbackParent, matchedLog, plainDisposable, syntheticDisposable]),
        'the matched log and its parent survive; plain and synthetic telemetry do not',
      ).toEqual([feedbackParent, matchedLog].sort((a, b) => a - b));

      const feedback = await tx<{ ref: string; verdict: string; expected: string | null }[]>`
        SELECT client_ref AS ref, verdict, expected_answer AS expected
          FROM nl_search_feedback
         WHERE client_ref IN (${matchedRef}, ${orphanRef})
         ORDER BY id
      `;
      expect(feedback).toEqual([
        { ref: matchedRef, verdict: 'incorrect', expected: 'ISSUE-119 matched feedback fixture' },
        { ref: orphanRef, verdict: 'correct', expected: null },
      ]);

      const [after] = await tx<{ feedback: number; reviews: number }[]>`
        SELECT (SELECT count(*)::int FROM nl_search_feedback) AS feedback,
               (SELECT count(*)::int FROM nl_search_review)   AS reviews
      `;
      expect(after, 'not one feedback or review row may be lost').toEqual(before);
      expect(counts.retainedFeedback).toBe(after.feedback);
      expect(counts.retainedReviews).toBe(after.reviews);
    });
  });

  it('preserves every app-health row and detaches only the links to deleted logs', async () => {
    await rolledBack(sql, async (tx) => {
      const protectedRef = randomUUID();
      const disposableLog = await insertLog(tx, 'health fixture: disposable log');
      const protectedLog = await insertLog(tx, 'health fixture: protected log', { clientRef: protectedRef });
      await tx`
        INSERT INTO nl_search_feedback (client_ref, verdict) VALUES (${protectedRef}, 'correct')
      `;

      const healthIds = await tx<{ id: number }[]>`
        INSERT INTO app_health_events (event_type, related_search_id)
        VALUES ('PAGE_CRASH', ${disposableLog}),
               ('PAGE_CRASH', ${protectedLog}),
               ('PAGE_CRASH', NULL)
        RETURNING id::int AS id
      `;
      const [detachedId, keptId, unlinkedId] = healthIds.map((r) => r.id);

      const [before] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM app_health_events`;

      const counts = await runClear(tx);

      const [after] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM app_health_events`;
      expect(after.n, 'no health row may be deleted').toBe(before.n);

      const links = await tx<{ id: number; related: number | null }[]>`
        SELECT id::int AS id, related_search_id::int AS related
          FROM app_health_events
         WHERE id IN ${tx([detachedId, keptId, unlinkedId])}
         ORDER BY id
      `;
      expect(links).toEqual([
        { id: detachedId, related: null },
        { id: keptId, related: protectedLog },
        { id: unlinkedId, related: null },
      ]);
      expect(counts.detached).toBeGreaterThanOrEqual(1);
    });
  });

  it('touches nothing unrelated, and the identity sequence is not reset', async () => {
    await rolledBack(sql, async (tx) => {
      // A pre-existing audit row standing in for the durable admin trail
      // the clear must never eat (the clear's OWN audit event is Server
      // Action work, tested with the action — the function records none).
      const [sentinel] = await tx<{ id: number }[]>`
        INSERT INTO auth_audit_log (action, detail)
        VALUES ('nl_search.telemetry_clear_test_sentinel', '{"issue": 119}'::jsonb)
        RETURNING id::int AS id
      `;

      const disposable = await insertLog(tx, 'sequence fixture: disposable');
      const [unrelatedBefore] = await tx<{ audits: number; users: number; players: number; matches: number }[]>`
        SELECT (SELECT count(*)::int FROM auth_audit_log) AS audits,
               (SELECT count(*)::int FROM auth_users)     AS users,
               (SELECT count(*)::int FROM players)        AS players,
               (SELECT count(*)::int FROM matches)        AS matches
      `;
      const [{ maxId }] = await tx<{ maxId: number }[]>`
        SELECT max(id)::int AS "maxId" FROM nl_search_log
      `;

      const counts = await runClear(tx);
      expect(counts.deleted).toBeGreaterThanOrEqual(1);
      expect(await survivors(tx, [disposable])).toEqual([]);

      const [unrelatedAfter] = await tx<{ audits: number; users: number; players: number; matches: number }[]>`
        SELECT (SELECT count(*)::int FROM auth_audit_log) AS audits,
               (SELECT count(*)::int FROM auth_users)     AS users,
               (SELECT count(*)::int FROM players)        AS players,
               (SELECT count(*)::int FROM matches)        AS matches
      `;
      expect(unrelatedAfter, 'unrelated data must be untouched').toEqual(unrelatedBefore);
      const [audit] = await tx<{ id: number }[]>`
        SELECT id::int AS id FROM auth_audit_log WHERE id = ${sentinel.id}
      `;
      expect(audit?.id, 'pre-existing audit history survives').toBe(sentinel.id);

      // Monotonic ids after the clear: a TRUNCATE ... RESTART IDENTITY or
      // ALTER SEQUENCE would restart below maxId. GENERATED ALWAYS AS
      // IDENTITY continues instead.
      const postClear = await insertLog(tx, 'sequence fixture: post-clear telemetry');
      expect(postClear, 'the identity sequence must not be reset').toBeGreaterThan(maxId);
    });
  });

  it('rolls back completely: an aborted clearing transaction leaves no trace', async () => {
    // Runbook §13 atomicity: a failure between the function returning and
    // COMMIT — the Server Action's audit insert failing, say — must undo
    // every delete AND every FK SET NULL. This is the database half of
    // that contract; the audit half belongs to the Server Action tests.
    const [baseline] = await sql<{ logs: number; links: number }[]>`
      SELECT (SELECT count(*)::int FROM nl_search_log) AS logs,
             (SELECT count(*)::int FROM app_health_events
               WHERE related_search_id IS NOT NULL)    AS links
    `;

    await rolledBack(sql, async (tx) => {
      const disposable = await insertLog(tx, 'rollback fixture: disposable');
      await tx`
        INSERT INTO app_health_events (event_type, related_search_id)
        VALUES ('PAGE_CRASH', ${disposable})
      `;
      const counts = await runClear(tx);
      expect(counts.deleted).toBeGreaterThanOrEqual(1);
      expect(counts.detached).toBeGreaterThanOrEqual(1);
    });

    const [after] = await sql<{ logs: number; links: number }[]>`
      SELECT (SELECT count(*)::int FROM nl_search_log) AS logs,
             (SELECT count(*)::int FROM app_health_events
               WHERE related_search_id IS NOT NULL)    AS links
    `;
    expect(after, 'deletes and SET NULL detachments must all roll back').toEqual(baseline);
  });
});

describe('cutoff and concurrency', () => {
  // Dedicated single-connection clients: the blocking proof needs two
  // sessions that are provably distinct backends, plus an observer that
  // is subject to neither lock (SHARE ROW EXCLUSIVE never blocks reads,
  // and pg_blocking_pids reads only lock state).
  const sqlA = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  const sqlB = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  const observer = postgres(ownerDsn, { max: 1, onnotice: () => {} });

  afterAll(async () => {
    await Promise.all([
      sqlA.end({ timeout: 5 }),
      sqlB.end({ timeout: 5 }),
      observer.end({ timeout: 5 }),
    ]);
  });

  async function waitForBlock(blockerPid: number, blockedPid: number): Promise<void> {
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const [{ blocking }] = await observer<{ blocking: number[] }[]>`
        SELECT pg_blocking_pids(${blockedPid}) AS blocking
      `;
      if (blocking?.includes(blockerPid)) return;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error(`Timed out waiting for PID ${blockedPid} to block behind PID ${blockerPid}`);
  }

  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  it('blocks a telemetry writer for the life of the clearing transaction, then the writer proceeds untouched', async () => {
    // The §8 cutoff, at the database layer: everything committed when the
    // lock set is acquired is in scope; a writer arriving afterwards —
    // including a deferred after() insert — waits, then commits as
    // post-clear telemetry. Its row can never be deleted by this clear
    // because the DELETE has already run by the time the writer proceeds.
    // Transaction A rolls back at the end, so nothing here destroys real
    // afldb_test telemetry; the blocking itself is what is under test.
    const aHolding = deferred<number>();
    const aRelease = deferred();

    const aDone = sqlA.begin(async (a) => {
      const tx = a as unknown as Db;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT deleted_log_rows FROM public.nl_search_telemetry_clear()`;
      aHolding.resolve(pid);
      await aRelease.promise;
      throw new Rollback('clearing transaction rolled back');
    }).then(
      () => { throw new Error('the clearing transaction must never commit in this test'); },
      (error) => { if (!(error instanceof Rollback)) throw error; },
    );

    // If A fails before it holds the locks, surface that error instead of
    // hanging until the test times out. The guard promise also rejects
    // when A ends NORMALLY later — after the race is long since decided —
    // so it is marked handled to keep that from surfacing as an unhandled
    // rejection.
    const aGuard = aDone.then(() => Promise.reject(new Error('clearing transaction ended before it was released')));
    aGuard.catch(() => {});
    const aPid = await Promise.race([aHolding.promise, aGuard]);

    let writerInserted = false;
    const bStarted = deferred<number>();
    const bDone = sqlB.begin(async (b) => {
      const tx = b as unknown as Db;
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      bStarted.resolve(pid);
      await tx`
        INSERT INTO nl_search_log (question, outcome)
        VALUES ('post-cutoff writer probe', 'answered')
      `;
      writerInserted = true;
      throw new Rollback('writer probe rolled back');
    }).then(
      () => { throw new Error('the writer probe must never commit in this test'); },
      (error) => { if (!(error instanceof Rollback)) throw error; },
    );

    const bGuard = bDone.then(() => Promise.reject(new Error('writer probe ended before it could block')));
    bGuard.catch(() => {});
    const bPid = await Promise.race([bStarted.promise, bGuard]);

    await waitForBlock(aPid, bPid);
    expect(writerInserted, 'the writer must still be waiting on the lock').toBe(false);

    aRelease.resolve();
    await aDone;
    await bDone;
    expect(writerInserted, 'the writer proceeds once the clearing transaction ends').toBe(true);
  }, 30_000);
});

// Skipped explicitly when AFLDB_TEST_AUTH_DATABASE_URL is unset — see
// AUTH_ROLE_CLEAR_SKIP_MESSAGE. Never falls back to the owner credential.
describe.skipIf(!authDsn)('restricted afldb_auth credential (AFLDB_TEST_AUTH_DATABASE_URL)', () => {
  const authSql = authDsn ? postgres(authDsn, { max: 1, onnotice: () => {} }) : undefined;

  beforeAll(async () => {
    if (!authSql) throw new Error(AUTH_ROLE_CLEAR_SKIP_MESSAGE);
    // The runtime half of the module-level DSN parity check: what the
    // credential actually authenticated as, not what its URL claimed.
    const [identity] = await authSql<{ database: string; role: string }[]>`
      SELECT current_database() AS database, current_user AS role
    `;
    const owner = parseDsn('AFLDB_TEST_DATABASE_URL', ownerDsn);
    if (identity.database !== owner.database || !/_test$/.test(identity.database)) {
      throw new Error(
        `AFLDB_TEST_AUTH_DATABASE_URL authenticated to '${identity.database}', not the `
        + `_test database AFLDB_TEST_DATABASE_URL targets ('${owner.database}').`,
      );
    }
    if (identity.role !== 'afldb_auth') {
      throw new Error(
        'AFLDB_TEST_AUTH_DATABASE_URL must authenticate as afldb_auth; '
        + `current_user is '${identity.role}'. Never substitute the owner credential.`,
      );
    }
  });

  afterAll(async () => {
    await authSql?.end({ timeout: 5 });
  });

  /** Resolves to the SQLSTATE a statement failed with, or undefined if it was permitted. */
  async function sqlstate(run: Promise<unknown>): Promise<string | undefined> {
    try {
      await run;
      return undefined;
    } catch (error) {
      return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    }
  }

  it('executes the clear end to end as the application role', async () => {
    // EXECUTE on the SECURITY DEFINER function is the entire capability:
    // the role seeds its own disposable row (it holds INSERT), invokes
    // the function, and sees the row gone — all rolled back.
    await rolledBack(authSql as unknown as Db, async (tx) => {
      const probe = await insertLog(tx, 'restricted-role disposable probe');
      const counts = await runClear(tx);
      expect(counts.deleted).toBeGreaterThanOrEqual(1);
      expect(await survivors(tx, [probe])).toEqual([]);
    });
  });

  it('still cannot DELETE any NL table directly', async () => {
    // The live half of the catalogue assertion in privileges.test.ts:
    // this is the actual credential the application will hold, refused by
    // the server itself. WHERE false makes the probe harmless even if the
    // grant has regressed — the failure is then the assertion, not damage.
    for (const table of ['nl_search_log', 'nl_search_review', 'nl_search_feedback']) {
      expect(
        await sqlstate(authSql!`DELETE FROM ${authSql!(table)} WHERE false`),
        `${table}: DELETE must be denied (SQLSTATE 42501)`,
      ).toBe('42501');
    }
  });

  it('still cannot TRUNCATE any NL table', async () => {
    // One transaction per probe: 42501 aborts the transaction it happens
    // in, and if a regressed grant ever let TRUNCATE through, the
    // rollback would contain the damage while the assertion still failed.
    for (const table of ['nl_search_log', 'nl_search_review', 'nl_search_feedback']) {
      let state: string | undefined;
      await expect(
        authSql!.begin(async (tx) => {
          state = await sqlstate(tx`TRUNCATE TABLE ${tx(table)}`);
          throw new Rollback('truncate probe rolled back');
        }),
      ).rejects.toThrow('truncate probe rolled back');
      expect(state, `${table}: TRUNCATE must be denied (SQLSTATE 42501)`).toBe('42501');
    }
  });
});
