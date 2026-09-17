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
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { promoteSubmission, type PromoteResult } from '@/lib/ingest/pipeline';

import { createImportRoleParityHarness } from './import-role-parity';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

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
});

afterAll(async () => {
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
