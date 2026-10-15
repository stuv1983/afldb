/**
 * AFLDB-ISSUE-175: submission promotion is locked, atomic, and eligible
 * from both 'approved' and 'failed'.
 *
 * Before this fix, `promoteSubmission` read the submission's status without
 * a lock, applied the promoted data under `afldb_import` in one
 * transaction, and then flipped `data_submissions.status` in a SEPARATE,
 * unguarded statement on the auth pool. Two concurrent promotions could
 * both observe 'approved' and both apply; a successful data commit
 * followed by a failed status write left the submission looking
 * unpromoted while its data was already live.
 *
 * The fix locks the row with `SELECT ... FOR UPDATE` inside the SAME
 * transaction that applies the data and writes the final status, using
 * afldb_import's existing column grant (migration 023) on
 * data_submissions(status, promoted_at, import_batch_id, error) — no new
 * privilege, no migration, no intermediate status.
 *
 * THE THINGS MOST LIKELY TO REGRESS, and why each is asserted directly
 * against a real PostgreSQL database rather than mocked:
 *
 *   1. TWO PROMOTIONS BOTH APPLYING. Only real row-level locking proves a
 *      second caller blocks and then refuses once it re-reads the
 *      committed state — a mock cannot model lock contention.
 *
 *   2. A RETRY FROM 'failed' BEING TREATED AS INELIGIBLE. The eligibility
 *      check was tightened once already (approved-only) during review and
 *      had to be corrected back to approved-or-failed; a regression test
 *      pins the corrected behaviour, not the one that shipped briefly.
 *
 *   3. A REFUSED OR RACE-LOSING ATTEMPT WRITING 'failed' ANYWAY. That would
 *      reintroduce a lost-update bug at the error-handling layer, clobbering
 *      a legitimate 'promoted' row.
 *
 * The `player_bio` dataset is used as the promoted target throughout: its
 * `promoteRow` is a single, side-effect-free-to-repeat `UPDATE players ...`
 * with no award/source dependency, keyed by a disposable fixture player
 * created and deleted by this file. A deliberately invalid `dob` value
 * (`'9999-99-99'`) is used to force a genuine mid-promotion SQL failure
 * (`::date` cast error) without depending on any application-level bug.
 *
 * AFLDB-ISSUE-273 (the second describe block): validation against concurrent
 * review. `validateSubmission` computes its verdicts unlocked, then writes
 * them and the status in one transaction behind the submission row lock and
 * a status + xmin check. Each interleaving below is driven for real: a
 * validation is parked inside its validator (the `@/lib/ingest/datasets`
 * wrapper) while a reject, approve, promote or second validation commits,
 * or a validation's write transaction is held on a row lock while an
 * approve queues behind it. Approve and reject go through the real
 * `decideSubmission`; only its session/cache dependencies are stubbed.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { decideSubmission } from '@/app/admin/submissions/[id]/actions';
import {
  promoteSubmission,
  SubmissionChangedError,
  validateSubmission,
  type PromoteResult,
  type ValidationSummary,
} from '@/lib/ingest/pipeline';

import { createImportRoleParityHarness } from './import-role-parity';

/**
 * AFLDB-ISSUE-273 test control. `park` makes the NEXT validateRow call wait
 * until its entry in `parked` is called; `label` is appended to every verdict
 * so a test can tell which validation run wrote a row; `verdict` replaces the
 * dataset's own verdict (and its DB read) when set.
 */
const control = vi.hoisted(() => ({
  park: false,
  parked: [] as (() => void)[],
  label: null as string | null,
  verdict: null as null | ((row: Record<string, string | null>) => {
    verdict: 'ok' | 'warning' | 'error'; reasons: string[]; resolved?: Record<string, number | string | null>;
  }),
  admin: { id: 0, email: '' }, // set in beforeAll
}));

vi.mock('@/lib/ingest/datasets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/datasets')>();
  return {
    ...actual,
    getDataset: (key: string) => {
      const spec = actual.getDataset(key);
      if (!spec) return spec;
      return {
        ...spec,
        validateRow: async (...args: Parameters<typeof spec.validateRow>) => {
          if (control.park) {
            control.park = false;
            await new Promise<void>((resolve) => { control.parked.push(resolve); });
          }
          const verdict = control.verdict ? control.verdict(args[0]) : await spec.validateRow(...args);
          return control.label ? { ...verdict, reasons: [...verdict.reasons, control.label] } : verdict;
        },
      };
    },
  };
});
vi.mock('@/lib/auth/session', () => ({
  audit: vi.fn(async () => {}),
  requireAdmin: vi.fn(async () => control.admin),
  requireSuperAdmin: vi.fn(async () => control.admin),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

// validateSubmission and decideSubmission run on the auth pool. Point it at
// the test database before any query (authSql reads the variable lazily; see
// tests/integration/email-intake.test.ts). Owner role, as email-intake does;
// the afldb_auth lock privilege is asserted separately below.
process.env.AFLDB_AUTH_DATABASE_URL = testDbUrl;

// Redirect the pipeline's import-role connection at the test database,
// exactly as tests/integration/admin-special-records.test.ts does. Falls
// back to the owner DSN (still the _test database, unrestricted role) when
// AFLDB_TEST_IMPORT_DATABASE_URL is not configured, so the functional
// assertions still run; the privilege-parity assertions below are gated on
// the restricted DSN actually being present.
const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? process.env.AFLDB_TEST_DATABASE_URL;

const MARKER = 'AFLDB-ISSUE-175';
const FIXTURE_EMAIL = 'issue-175-promotion-test-fixture@afldb.test';

let fixtureAdminId: number;
const submissionIds = new Set<number>();
const playerIds = new Set<number>();

async function createFixturePlayer(tag: string): Promise<number> {
  const name = `${MARKER} ${tag}`;
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${name}, afldb_normalise_name(${name}), ${name},
            ${`issue-175-${tag}-${Date.now().toString(36)}`})
    RETURNING id
  `;
  playerIds.add(row.id);
  return row.id;
}

/**
 * Insert one submission plus its single row directly (bypassing
 * stageSubmission/validateSubmission), so the test controls the exact
 * status, verdict and resolved payload each scenario needs.
 */
async function insertSubmission(opts: {
  status: 'approved' | 'failed';
  error?: string | null;
  verdict: string | null;
  playerId: number;
  dob: string;
}): Promise<number> {
  const sha = `${MARKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [submission] = await owner<{ id: number }[]>`
    INSERT INTO data_submissions
      (dataset, filename, content, content_sha256, uploaded_by, row_count, status, error)
    VALUES ('player_bio', ${`${MARKER}.csv`}, ${Buffer.from('player_id,dob\n')}, ${sha},
            ${fixtureAdminId}, 1, ${opts.status}::submission_status, ${opts.error ?? null})
    RETURNING id
  `;
  submissionIds.add(submission.id);

  await owner`
    INSERT INTO data_submission_rows (submission_id, row_no, payload, verdict, reasons)
    VALUES (
      ${submission.id}, 1,
      ${owner.json({ player_id: String(opts.playerId), dob: opts.dob })},
      ${opts.verdict},
      ${owner.json({ resolved: { player_id: opts.playerId } })}
    )
  `;
  return submission.id;
}

async function readSubmission(id: number) {
  const [row] = await owner<{
    status: string; error: string | null; importBatchId: string | null;
  }[]>`
    SELECT status::text, error, import_batch_id::text AS "importBatchId"
      FROM data_submissions WHERE id = ${id}
  `;
  return row;
}

async function readPlayerDob(playerId: number): Promise<string | null> {
  const [row] = await owner<{ dob: string | null }[]>`
    SELECT dob::text FROM players WHERE id = ${playerId}
  `;
  return row.dob;
}

beforeAll(async () => {
  if (process.env.AFLDB_TEST_IMPORT_DATABASE_URL) {
    const proof = await importRole.validate();
    expect(proof.restricted.role).toBe('afldb_import');
    expect(proof.restricted.database).toMatch(/_test$/);
  }

  await owner`
    INSERT INTO auth_users (email, role)
    VALUES (${FIXTURE_EMAIL}, 'super_admin')
    ON CONFLICT (email) DO NOTHING
  `;
  const [admin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users WHERE email = ${FIXTURE_EMAIL}
  `;
  fixtureAdminId = admin.id;
  control.admin = { id: admin.id, email: FIXTURE_EMAIL };
});

// ---------------------------------------------------------------------------
// Background work (AFLDB-ISSUE-273)
// ---------------------------------------------------------------------------
// A validation or approval a test starts and awaits later is tracked the
// moment it starts, with its rejection handler already attached. A test that
// fails before awaiting it (an assertion, or a vi.waitFor timeout) therefore
// cannot leave an unhandled rejection, or an operation still running into
// the next test or into the fixture cleanup: teardown releases and awaits it
// first.

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then((value) => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
}

type BackgroundEntry = { done: Promise<void>; failure: { error: unknown } | null; consumed: boolean };
const background: BackgroundEntry[] = [];
const SETTLE_TIMEOUT_MS = 20_000; // inside the configured 30 s hookTimeout

/** Track `promise`; the test reads its outcome through `settled()`. */
function track<T>(promise: Promise<T>): { settled: () => Promise<Settled<T>> } {
  const entry: BackgroundEntry = { done: Promise.resolve(), failure: null, consumed: false };
  entry.done = promise.then(() => {}, (error: unknown) => { entry.failure = { error }; });
  background.push(entry);
  return { settled: () => { entry.consumed = true; return settle(promise); } };
}

/**
 * Stop new parking, release every parked validation and await every tracked
 * operation. Returns the failures no test consumed. Throws, keeping the
 * entries, if work is still running after SETTLE_TIMEOUT_MS, so the caller
 * neither resets controls nor cleans fixtures under it.
 */
async function settleBackground(): Promise<unknown[]> {
  control.park = false; // set first: a released multi-row validation must not park again
  for (const release of control.parked.splice(0)) release();
  const entries = [...background];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `${entries.length} background operation(s) still running after ${SETTLE_TIMEOUT_MS} ms`,
    )), SETTLE_TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.all(entries.map((e) => e.done)), timedOut]);
  } finally {
    clearTimeout(timer);
  }
  background.splice(0, entries.length);
  return entries.filter((e) => e.failure && !e.consumed).map((e) => e.failure!.error);
}

function throwBackgroundFailures(failures: unknown[]): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} unexpected background failure(s)`);
  }
}

afterEach(async () => {
  // Await everything this test started before resetting the controls a
  // released validation still reads (label, verdict).
  const failures = await settleBackground();
  control.label = null;
  control.verdict = null;
  throwBackgroundFailures(failures);
});

afterAll(async () => {
  // Never clean fixtures under a running operation: settle anything an
  // afterEach could not, or refuse the cleanup by throwing.
  const failures = await settleBackground();
  if (submissionIds.size > 0) {
    await owner`DELETE FROM data_submissions WHERE id = ANY(${[...submissionIds]}::int[])`;
  }
  if (playerIds.size > 0) {
    await owner`DELETE FROM players WHERE id = ANY(${[...playerIds]}::int[])`;
  }
  // The fixture auth_users row is intentionally retained (see
  // tests/integration/email-intake.test.ts for the same rationale): deleting
  // it would race a concurrent run that reused it.

  await owner.end({ timeout: 5 });
  throwBackgroundFailures(failures);
});

describe('AFLDB-ISSUE-175 promotion locking and atomicity', () => {
  it('lets exactly one of two concurrent promotions of the same approved submission succeed', async () => {
    const playerId = await createFixturePlayer('concurrent-success');
    const id = await insertSubmission({
      status: 'approved', verdict: 'ok', playerId, dob: '2000-01-01',
    });

    const [a, b]: PromoteResult[] = await Promise.all([
      promoteSubmission(id),
      promoteSubmission(id),
    ]);

    const succeeded = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    if (!refused[0].ok) expect(refused[0].error).toMatch(/promoted/i);

    const row = await readSubmission(id);
    expect(row.status).toBe('promoted');

    // Exactly one import batch was ever created for this submission — the
    // loser refused before reaching the batch insert, it did not run it
    // and then get overwritten.
    const [{ count }] = await owner<{ count: number }[]>`
      SELECT count(*)::int AS count FROM import_batches WHERE notes = ${'submission ' + id}
    `;
    expect(count).toBe(1);
  });

  it('rolls back the promotion work and marks failed on a genuine error from approved', async () => {
    const playerId = await createFixturePlayer('fail-from-approved');
    const id = await insertSubmission({
      // '9999-99-99' fails the ::date cast inside promoteRow's UPDATE,
      // deep inside the savepoint, after the row is already locked.
      status: 'approved', verdict: 'ok', playerId, dob: '9999-99-99',
    });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rolled back/i);

    const row = await readSubmission(id);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect(row.importBatchId).toBeNull();

    // The savepoint rollback means the UPDATE never actually applied.
    expect(await readPlayerDob(playerId)).toBeNull();
  });

  it('promotes on retry from a failed submission using the same eligibility lock', async () => {
    const playerId = await createFixturePlayer('retry-success');
    const id = await insertSubmission({
      status: 'failed', error: 'a previous attempt broke', verdict: 'ok',
      playerId, dob: '2001-02-03',
    });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(true);

    const row = await readSubmission(id);
    expect(row.status).toBe('promoted');
    expect(row.error).toBeNull();
    expect(await readPlayerDob(playerId)).toBe('2001-02-03');
  });

  it('keeps status failed with an updated error when a retry from failed fails again', async () => {
    const playerId = await createFixturePlayer('retry-fail-again');
    const id = await insertSubmission({
      status: 'failed', error: 'first failure', verdict: 'ok',
      playerId, dob: '9999-99-99',
    });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(false);

    const row = await readSubmission(id);
    expect(row.status).toBe('failed');
    expect(row.error).not.toBe('first failure');
    expect(row.error).toBeTruthy();
    expect(await readPlayerDob(playerId)).toBeNull();
  });

  it('refuses without any status/error write when the submission carries an error row', async () => {
    const playerId = await createFixturePlayer('error-rows');
    // 'error' hits the same refusal branch as a missing/null verdict
    // (`r.verdict === 'error' || !r.verdict`) — one case proves the branch.
    const id = await insertSubmission({
      status: 'approved', verdict: 'error', playerId, dob: '2000-01-01',
    });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/error rows/i);

    const row = await readSubmission(id);
    // Untouched: still 'approved', still no error recorded.
    expect(row.status).toBe('approved');
    expect(row.error).toBeNull();
    expect(await readPlayerDob(playerId)).toBeNull();
  });

  it('refuses a promotion blocked on the lock once a concurrent reject commits first', async () => {
    const playerId = await createFixturePlayer('reject-race');
    const id = await insertSubmission({
      status: 'approved', verdict: 'ok', playerId, dob: '2002-03-04',
    });

    // decideSubmission's reject path (src/app/admin/submissions/[id]/actions.ts)
    // runs this exact statement on the auth pool. Locking is per-row and
    // per-transaction, not per-role, so reproducing it here on the owner
    // connection exercises the same PostgreSQL mechanism ISSUE-175 depends
    // on without pulling in session/auth mocking that is out of this
    // issue's scope.
    const rejectTx = postgres(testDbUrl, { max: 1, onnotice: () => {} });
    let promotionPromise: Promise<PromoteResult> | undefined;
    try {
      await rejectTx.begin(async (tx) => {
        // Take the row lock ourselves, deterministically ahead of the real
        // promotion attempt below, so which side "wins" is controlled
        // rather than a genuine race.
        await tx`SELECT id FROM data_submissions WHERE id = ${id} FOR UPDATE`;

        // Started while we hold the lock: promoteSubmission's own
        // SELECT ... FOR UPDATE must block on it.
        promotionPromise = promoteSubmission(id);
        // Give it time to actually reach and block on that statement
        // before we commit the reject underneath it.
        await new Promise((resolve) => { setTimeout(resolve, 250); });

        const rejected = await tx<{ id: number }[]>`
          UPDATE data_submissions
             SET status = 'rejected', reviewed_by = ${fixtureAdminId}, reviewed_at = now()
           WHERE id = ${id}
             AND status IN ('staged', 'validated', 'approved')
          RETURNING id
        `;
        expect(rejected).toHaveLength(1);
        // Returning here commits, releasing the lock promoteSubmission is
        // waiting on.
      });
    } finally {
      await rejectTx.end({ timeout: 5 });
    }

    const promotionResult = await promotionPromise!;
    expect(promotionResult.ok).toBe(false);
    if (!promotionResult.ok) expect(promotionResult.error).toMatch(/rejected/i);

    const row = await readSubmission(id);
    expect(row.status).toBe('rejected');
    expect(await readPlayerDob(playerId)).toBeNull();
  });

  it.skipIf(!process.env.AFLDB_TEST_IMPORT_DATABASE_URL)(
    'afldb_import may lock data_submissions with SELECT ... FOR UPDATE (AFLDB-ISSUE-175)',
    async () => {
      const playerId = await createFixturePlayer('for-update-privilege');
      const id = await insertSubmission({
        status: 'approved', verdict: 'ok', playerId, dob: '2000-01-01',
      });

      const restricted = importRole.connect();
      try {
        await restricted.begin(async (tx) => {
          await tx`SELECT id FROM data_submissions WHERE id = ${id} FOR UPDATE`;
        });
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-273: validation against concurrent review
// ---------------------------------------------------------------------------

/**
 * Start a validation and return once it is parked inside its first
 * validateRow. The validation is tracked before the wait, so a wait that
 * times out still leaves it to teardown.
 */
async function startParkedValidation(id: number) {
  const index = control.parked.length;
  control.park = true;
  const run = track(validateSubmission(id));
  await vi.waitFor(() => { expect(control.parked.length).toBe(index + 1); }, { timeout: 10_000 });
  return { settled: run.settled, release: control.parked[index] };
}

const SEEDED = { reasons: ['seeded by AFLDB-ISSUE-273 test'], resolved: null };

/**
 * A submission at `status` whose rows carry a sentinel verdict, so a test can
 * prove a refused validation left every row exactly as it was.
 */
async function insertReviewFixture(opts: {
  status: 'staged' | 'validated';
  payloads: Record<string, string>[];
  seededVerdict?: 'ok' | null;
}): Promise<number> {
  const sha = `AFLDB-ISSUE-273-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [submission] = await owner<{ id: number }[]>`
    INSERT INTO data_submissions
      (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
    VALUES ('player_bio', 'AFLDB-ISSUE-273.csv', ${Buffer.from('player_id,dob\n')}, ${sha},
            ${fixtureAdminId}, ${opts.payloads.length}, ${opts.status}::submission_status)
    RETURNING id
  `;
  submissionIds.add(submission.id);
  const seeded = opts.seededVerdict === undefined ? 'ok' : opts.seededVerdict;
  const rows = opts.payloads.map((payload, index) => ({
    submission_id: submission.id,
    row_no: index + 1,
    payload,
    verdict: seeded,
    reasons: seeded === null ? null : SEEDED,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    await owner`INSERT INTO data_submission_rows ${owner(rows.slice(start, start + 500))}`;
  }
  return submission.id;
}

async function readReview(id: number) {
  const [row] = await owner<{
    status: string; reviewedBy: number | null; report: unknown; importBatchId: string | null;
  }[]>`
    SELECT status::text, reviewed_by AS "reviewedBy", validation_report AS report,
           import_batch_id::text AS "importBatchId"
      FROM data_submissions WHERE id = ${id}
  `;
  return row;
}

async function readRows(id: number) {
  return owner<{
    rowNo: number; verdict: string | null; reasons: { reasons: string[]; resolved: unknown } | null;
    kind: string | null;
  }[]>`
    SELECT row_no AS "rowNo", verdict, reasons, jsonb_typeof(reasons) AS kind
      FROM data_submission_rows WHERE submission_id = ${id} ORDER BY row_no
  `;
}

function decision(id: number, value: 'approve' | 'reject'): FormData {
  const form = new FormData();
  form.set('id', String(id));
  form.set('decision', value);
  return form;
}

describe('AFLDB-ISSUE-273 validation against concurrent review', () => {
  it('validates normally: every verdict, the resolved payload as a jsonb object, and the report', async () => {
    const playerId = await createFixturePlayer('273-normal');
    const id = await insertReviewFixture({
      status: 'staged',
      seededVerdict: null,
      payloads: [
        { player_id: String(playerId), dob: '2000-01-01' },
        { player_id: '0', dob: '2000-01-01' },
        { player_id: String(playerId), dob: '2000-01-02' },
      ],
    });

    const summary = await validateSubmission(id);

    expect(summary).toEqual({ ok: 1, warnings: 0, errors: 2, duplicates: 1 });
    const review = await readReview(id);
    expect(review.status).toBe('validated');
    expect(review.report).toEqual(summary);
    const rows = await readRows(id);
    expect(rows.map((r) => [r.verdict, r.kind])).toEqual([
      ['ok', 'object'], ['error', 'object'], ['error', 'object'],
    ]);
    expect(rows[0].reasons?.resolved).toEqual({ player_id: playerId });
    expect(rows[1].reasons?.reasons).toEqual(['player_id must be a positive integer']);
    expect(rows[2].reasons?.reasons.at(-1)).toBe(`duplicate of row 1 (key "${playerId}")`);
  });

  it('a reject that commits mid-validation stands, and the run writes nothing', async () => {
    const a = await createFixturePlayer('273-reject-a');
    const b = await createFixturePlayer('273-reject-b');
    const id = await insertReviewFixture({
      status: 'validated',
      payloads: [{ player_id: String(a), dob: '2000-01-01' }, { player_id: String(b), dob: '2000-01-01' }],
    });

    const run = await startParkedValidation(id);
    expect(await decideSubmission({}, decision(id, 'reject'))).toEqual({ message: 'Rejected.' });
    run.release();
    const result = await run.settled();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SubmissionChangedError);
      expect(String(result.error)).toMatch(/became rejected/);
    }
    const review = await readReview(id);
    expect(review.status).toBe('rejected');
    expect(review.reviewedBy).toBe(fixtureAdminId);
    expect(review.report).toBeNull();
    expect((await readRows(id)).map((r) => [r.verdict, r.reasons])).toEqual([['ok', SEEDED], ['ok', SEEDED]]);
  });

  it('an approve and promote that commit mid-validation stand: no revert, no second batch', async () => {
    const playerId = await createFixturePlayer('273-promote');
    const id = await insertReviewFixture({
      status: 'validated',
      payloads: [{ player_id: String(playerId), dob: '2003-04-05' }],
    });
    // promoteRow reads the seeded `resolved`, so seed a promotable one.
    await owner`
      UPDATE data_submission_rows
         SET reasons = ${owner.json({ reasons: SEEDED.reasons, resolved: { player_id: playerId } })}
       WHERE submission_id = ${id}
    `;

    const run = await startParkedValidation(id);
    expect(await decideSubmission({}, decision(id, 'approve'))).toEqual({ message: 'Approved.' });
    const promoted = await promoteSubmission(id);
    expect(promoted.ok).toBe(true);
    run.release();
    const result = await run.settled();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toMatch(/became promoted/);
    const review = await readReview(id);
    expect(review.status).toBe('promoted');
    expect(review.importBatchId).not.toBeNull();
    expect(await readPlayerDob(playerId)).toBe('2003-04-05');
    // It was never reopened, so it cannot be approved (and promoted) again.
    expect(await decideSubmission({}, decision(id, 'approve'))).toEqual({
      error: 'Only a validated submission with no error rows can be approved.',
    });
    const [{ count }] = await owner<{ count: number }[]>`
      SELECT count(*)::int AS count FROM import_batches WHERE notes = ${'submission ' + id}
    `;
    expect(count).toBe(1);
    const [row] = await readRows(id);
    expect(row.reasons?.reasons).toEqual(SEEDED.reasons);
  });

  it('of two overlapping validations the first to commit wins whole; the other writes nothing', async () => {
    const players = [
      await createFixturePlayer('273-pair-a'),
      await createFixturePlayer('273-pair-b'),
      await createFixturePlayer('273-pair-c'),
    ];
    const id = await insertReviewFixture({
      status: 'staged',
      seededVerdict: null,
      payloads: players.map((p) => ({ player_id: String(p), dob: '2000-01-01' })),
    });

    const first = await startParkedValidation(id);
    const second = await startParkedValidation(id);
    control.label = 'run 1';
    first.release();
    const firstResult = await first.settled();
    control.label = 'run 2';
    second.release();
    const secondResult = await second.settled();

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) expect(secondResult.error).toBeInstanceOf(SubmissionChangedError);
    const review = await readReview(id);
    expect(review.status).toBe('validated');
    expect(review.report).toEqual((firstResult as { value: ValidationSummary }).value);
    const rows = await readRows(id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.reasons?.reasons).toContain('run 1');
      expect(row.reasons?.reasons).not.toContain('run 2');
    }
  });

  it('a reject then a fresh validation (status back to validated) still refuses the older run', async () => {
    const playerId = await createFixturePlayer('273-aba');
    const id = await insertReviewFixture({
      status: 'validated',
      payloads: [{ player_id: String(playerId), dob: '2000-01-01' }],
    });

    const stale = await startParkedValidation(id);
    expect(await decideSubmission({}, decision(id, 'reject'))).toEqual({ message: 'Rejected.' });
    control.label = 'fresh';
    await validateSubmission(id);
    expect((await readReview(id)).status).toBe('validated');
    control.label = 'stale';
    stale.release();
    const result = await stale.settled();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toMatch(/changed by another validation or review action/);
    const [row] = await readRows(id);
    expect(row.reasons?.reasons).toContain('fresh');
    expect(row.reasons?.reasons).not.toContain('stale');
  });

  it('an approve queued behind a validation write sees that write, and refuses its error rows', async () => {
    // Seeded 'ok', but player_id 0 fails validation: the stale verdict is
    // approvable, the fresh one is not.
    const id = await insertReviewFixture({
      status: 'validated',
      payloads: [{ player_id: '0', dob: '2000-01-01' }],
    });

    const holder = postgres(testDbUrl, { max: 1, onnotice: () => {} });
    let validation: { settled: () => Promise<Settled<ValidationSummary>> } | undefined;
    let approval: { settled: () => Promise<Settled<Awaited<ReturnType<typeof decideSubmission>>>> } | undefined;
    const blockedBehind = async (pid: number, like: string): Promise<number> => {
      let found: number | undefined;
      await vi.waitFor(async () => {
        const rows = await owner<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
           WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE ${like}
        `;
        expect(rows).toHaveLength(1);
        found = rows[0].pid;
      }, { timeout: 4_000, interval: 25 });
      return found!;
    };
    try {
      await holder.begin(async (tx) => {
        const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        // Hold the row lock: validation will lock the submission, then wait here.
        await tx`SELECT row_no FROM data_submission_rows WHERE submission_id = ${id} FOR UPDATE`;
        validation = track(validateSubmission(id));
        const validator = await blockedBehind(pid, '%UPDATE data_submission_rows r%');
        approval = track(decideSubmission({}, decision(id, 'approve')));
        await blockedBehind(validator, '%FROM data_submissions WHERE id = $1 FOR UPDATE%');
        // Returning commits and releases the row lock.
      });
    } finally {
      await holder.end({ timeout: 5 });
    }

    const validated = await validation!.settled();
    expect(validated).toEqual({ ok: true, value: { ok: 0, warnings: 0, errors: 1, duplicates: 0 } });
    expect(await approval!.settled()).toEqual({
      ok: true, value: { error: 'Only a validated submission with no error rows can be approved.' },
    });
    expect((await readReview(id)).status).toBe('validated');
    expect((await readRows(id)).map((r) => r.verdict)).toEqual(['error']);
  });

  it('a failure inside the write transaction rolls back the verdict chunks already written', async () => {
    const payloads = Array.from({ length: 501 }, (_, i) => ({ player_id: String(i + 1), dob: '2000-01-01' }));
    const id = await insertReviewFixture({ status: 'staged', seededVerdict: null, payloads });
    // Synthetic verdicts (no player reads); row 501 carries a verdict the
    // CHECK constraint rejects, so the SECOND chunk fails after the first landed.
    control.verdict = (row) => (row.player_id === '501'
      ? { verdict: 'bogus' as 'ok', reasons: ['not a verdict'] }
      : { verdict: 'ok', reasons: ['synthetic'] });

    await expect(validateSubmission(id)).rejects.toThrow(/data_submission_rows_verdict_ck/);

    const review = await readReview(id);
    expect(review.status).toBe('staged');
    expect(review.report).toBeNull();
    const [{ written }] = await owner<{ written: number }[]>`
      SELECT count(*)::int AS written FROM data_submission_rows
       WHERE submission_id = ${id} AND verdict IS NOT NULL
    `;
    expect(written).toBe(0);
  });

  it.skipIf(!process.env.AFLDB_TEST_AUTH_DATABASE_URL)(
    'afldb_auth may lock data_submissions and read its xmin (AFLDB-ISSUE-273)',
    async () => {
      const id = await insertReviewFixture({ status: 'staged', payloads: [{ player_id: '1' }] });
      const restricted = postgres(process.env.AFLDB_TEST_AUTH_DATABASE_URL!, { max: 1, onnotice: () => {} });
      try {
        const [who] = await restricted<{ database: string; role: string }[]>`
          SELECT current_database() AS database, current_user AS role
        `;
        expect(who.database).toMatch(/_test$/);
        expect(who.role).toBe('afldb_auth');
        await restricted.begin(async (tx) => {
          const [row] = await tx<{ version: string }[]>`
            SELECT xmin::text AS version FROM data_submissions WHERE id = ${id} FOR UPDATE
          `;
          expect(row.version).toMatch(/^\d+$/);
          await tx`SELECT id FROM data_submissions WHERE id = ${id} FOR UPDATE`;
        });
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );
});

describe('AFLDB-ISSUE-273 teardown after an early failure', () => {
  // Each `it.fails` case leaves a validation in flight with control.label set
  // to 'stranded' (read when the validation reaches validateRow), then fails
  // before awaiting it. The case after it checks that afterEach awaited the
  // validation to the end BEFORE resetting the label: had it reset first, the
  // rows would lack the label, or the validation would still be running.
  const stranded: number[] = [];

  async function strandedFixture(tag: string): Promise<number> {
    const playerId = await createFixturePlayer(tag);
    const id = await insertReviewFixture({
      status: 'staged', seededVerdict: null, payloads: [{ player_id: String(playerId), dob: '2000-01-01' }],
    });
    stranded.push(id);
    return id;
  }

  async function expectSettledBeforeReset() {
    const id = stranded.at(-1);
    expect(id).toBeDefined();
    expect(background).toEqual([]);
    expect(control.parked).toEqual([]);
    expect(control).toMatchObject({ park: false, label: null, verdict: null });
    const review = await readReview(id!);
    expect(review.status).toBe('validated');
    expect(review.report).toEqual({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });
    const rows = await readRows(id!);
    expect(rows.map((r) => r.verdict)).toEqual(['ok']);
    expect(rows[0].reasons?.reasons).toContain('stranded');
  }

  it.fails('(deliberately fails) an assertion failure while a validation is parked', async () => {
    const id = await strandedFixture('273-stranded-assertion');
    await startParkedValidation(id);
    control.label = 'stranded';
    expect('the test stopped here').toBe('never');
  });

  it('afterEach finished that validation before resetting the controls', expectSettledBeforeReset);

  it.fails('(deliberately fails) a wait failure while a validation is blocked behind a row lock', async () => {
    const id = await strandedFixture('273-stranded-wait');
    control.label = 'stranded';
    const holder = postgres(testDbUrl, { max: 1, onnotice: () => {} });
    try {
      await holder.begin(async (tx) => {
        await tx`SELECT row_no FROM data_submission_rows WHERE submission_id = ${id} FOR UPDATE`;
        track(validateSubmission(id));
        await vi.waitFor(() => { expect('still waiting').toBe('never'); }, { timeout: 50, interval: 10 });
      });
    } finally {
      await holder.end({ timeout: 5 });
    }
  });

  it('afterEach finished that validation too', expectSettledBeforeReset);

  it('teardown reports a failure no test consumed, but not a consumed one', async () => {
    expect(await track(Promise.reject(new Error('consumed'))).settled()).toMatchObject({ ok: false });
    track(Promise.reject(new Error('never consumed')));

    const failures = await settleBackground();
    expect(failures.map((e) => (e as Error).message)).toEqual(['never consumed']);
    expect(background).toEqual([]);
  });
});

describe('AFLDB-ISSUE-307 the promotion batch counts what each row did', () => {
  it('records an update for each biography row written and counts a row whose player is gone as neither', async () => {
    const kept = await createFixturePlayer('batch-counts-kept');
    const gone = await createFixturePlayer('batch-counts-gone');
    const sha = `${MARKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const [submission] = await owner<{ id: number }[]>`
      INSERT INTO data_submissions
        (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
      VALUES ('player_bio', ${`${MARKER}.csv`}, ${Buffer.from('player_id,dob\n')}, ${sha},
              ${fixtureAdminId}, 2, 'approved'::submission_status)
      RETURNING id
    `;
    submissionIds.add(submission.id);
    for (const [rowNo, playerId] of [[1, kept], [2, gone]] as const) {
      await owner`
        INSERT INTO data_submission_rows (submission_id, row_no, payload, verdict, reasons)
        VALUES (${submission.id}, ${rowNo},
                ${owner.json({ player_id: String(playerId), dob: '2001-02-03' })}, 'ok',
                ${owner.json({ resolved: { player_id: playerId } })})
      `;
    }
    // The second player is deleted after "validation": its UPDATE then matches no row.
    await owner`DELETE FROM players WHERE id = ${gone}`;
    playerIds.delete(gone);

    const result = await promoteSubmission(submission.id);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(await readPlayerDob(kept)).toBe('2001-02-03');

    const [batch] = await owner<{ read: number; inserted: number; updated: number }[]>`
      SELECT records_read::int AS read, records_inserted::int AS inserted,
             records_updated::int AS updated
        FROM import_batches WHERE id = ${String(result.batchId)}::bigint
    `;
    // Two rows read; one bio row written (an update, never an insert); one that matched no row.
    expect(batch).toEqual({ read: 2, inserted: 0, updated: 1 });
  });
});
