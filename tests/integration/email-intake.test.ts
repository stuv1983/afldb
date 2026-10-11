import './guard';

import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/api/admin/email-intake/route';
import { decideSubmission, runValidation } from '@/app/admin/submissions/[id]/actions';
import { promoteSubmission, validateSubmission } from '@/lib/ingest/pipeline';

/**
 * AFLDB-ISSUE-273 (D-273-1) test control, the same wrapper as
 * tests/integration/submission-promotion.test.ts. `park` makes the NEXT
 * validateRow call wait until its entry in `parked` is called, so a review
 * action can commit while a delivery is mid-validation; `failFileKey` makes
 * validation throw an ordinary error. Both are off by default, and the
 * wrapper then passes straight through to the dataset. `afterStage` runs once,
 * after stageSubmission has committed and before the route calls
 * validateSubmission, so a review action can land ahead of validation's first
 * read. A hook failure is recorded in `hookFailures` as well as thrown, since
 * the route would otherwise report it only as a 500.
 */
const control = vi.hoisted(() => ({
  park: false,
  parked: [] as (() => void)[],
  failFileKey: false,
  afterStage: null as null | ((submissionId: number) => Promise<void>),
  hookFailures: [] as unknown[],
  admin: { id: 0, email: '' }, // set in beforeAll
}));

vi.mock('@/lib/ingest/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/pipeline')>();
  return {
    ...actual,
    stageSubmission: async (...args: Parameters<typeof actual.stageSubmission>) => {
      const staged = await actual.stageSubmission(...args);
      const hook = control.afterStage;
      control.afterStage = null;
      if (hook && staged.ok) {
        try {
          await hook(staged.submissionId);
        } catch (error) {
          control.hookFailures.push(error);
          throw error;
        }
      }
      return staged;
    },
  };
});

vi.mock('@/lib/ingest/datasets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/datasets')>();
  return {
    ...actual,
    getDataset: (key: string) => {
      const spec = actual.getDataset(key);
      if (!spec) return spec;
      return {
        ...spec,
        fileKey: (row: Parameters<typeof spec.fileKey>[0]) => {
          if (control.failFileKey) throw new Error('AFLDB-ISSUE-273 test: an ordinary validation failure');
          return spec.fileKey(row);
        },
        validateRow: async (...args: Parameters<typeof spec.validateRow>) => {
          if (control.park) {
            control.park = false;
            await new Promise<void>((resolve) => { control.parked.push(resolve); });
          }
          return spec.validateRow(...args);
        },
      };
    },
  };
});
// The real audit() still writes auth_audit_log; only the review actions'
// session check and cache refresh are stubbed.
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/session')>(),
  requireAdmin: vi.fn(async () => control.admin),
  requireSuperAdmin: vi.fn(async () => control.admin),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The race cases promote. Pin the import role to the test database too, never
// whatever an ambient .env names (submission-promotion.test.ts does the same).
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? process.env.AFLDB_TEST_DATABASE_URL;

/**
 * Every case but the 503 one needs the intake secret, and used to `return`
 * early -- and pass -- without it. Now it fails instead.
 */
function intakeSecret(): string {
  const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
  if (!secret) {
    throw new Error('AFLDB_EMAIL_INTAKE_SECRET must be set to run this suite (any value; the route runs in-process).');
  }
  return secret;
}

// Redirect the auth pool to the test database so authSql never opens a
// connection to afldb_dev (or any other ambient database). The same
// technique is used by data-editor.test.ts, awards-reload-links.test.ts,
// draftguru-import.test.ts, and first-kick-goal-reload-links.test.ts.
//
// Timing safety: authSql is a Proxy (src/db/authClient.ts). Its apply/get
// traps call getClient() -> createClient(), which reads AFLDB_AUTH_DATABASE_URL
// at the moment of the first query -- not at ESM import time. Static imports
// above only capture a reference to the Proxy object itself; no connection
// string is read during module evaluation. Setting the env var here, before
// any test body or beforeAll query runs, is therefore safe.
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

// authSql cleanup note: see datasets.test.ts -- no authSql.end() here for
// the same reason (the proxy's .end() is not safe to call with `this` bound
// to the proxy rather than the real client). The owner pool below is ended
// explicitly in afterAll.

// ---------------------------------------------------------------------------
// Fixture admin
// ---------------------------------------------------------------------------
// The test inserts (or deterministically reuses) a dedicated auth_users row
// identified by an exact fixture email address that no shared or real
// development row ever uses. Admin lookups inside tests select by
// `id = fixtureAdminId` -- never LIMIT 1 / arbitrary ordering.
//
// data_submissions cannot be deleted via authSql: migration 023 grants
// afldb_auth SELECT, INSERT, UPDATE on data_submissions but DELETE only on
// data_submission_rows. Cleanup therefore uses a short-lived owner-level
// connection (AFLDB_TEST_DATABASE_URL), exactly as data-editor.test.ts does
// for rows that require owner privileges.

const FIXTURE_EMAIL = 'email-intake-test-fixture@afldb.test';

let ownerSql: ReturnType<typeof postgres>;
let fixtureAdminId = 0;

// Exact data_submissions.id values created by THIS run. Each test registers
// its submission ID here immediately after the staging call returns --
// before any assertion that could throw -- so afterAll always has the full
// set to clean up, even when a later assertion fails.
//
// Using a Set of precise IDs (not uploaded_by alone) means:
//   * rows from a prior run are never deleted (their IDs are unknown to us);
//   * a concurrent run on the same fixture admin is unaffected (it holds its
//     own Set with its own IDs).
const runSubmissionIds = new Set<number>();
// Fixture players for the player_bio race cases, deleted in afterAll.
const runPlayerIds = new Set<number>();

beforeAll(async () => {
  ownerSql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, {
    max: 1,
    onnotice: () => {},
  });

  // Provision the fixture admin concurrency-safely.
  //
  // auth_users.email is UNIQUE (migration 023), so two concurrent runs that
  // both see the row absent and both attempt the INSERT will have exactly one
  // succeed and the other silently do nothing (ON CONFLICT DO NOTHING).
  // Neither run fails; the SELECT that follows always returns the one row.
  //
  // The fixture is intentionally RETAINED in the _test database between runs:
  // deleting it in afterAll would race with a concurrent run that reused it.
  // Treating it as a durable test-database fixture (not transient per-run
  // state) eliminates both the creation race and the deletion race.
  await ownerSql`
    INSERT INTO auth_users (email, role)
    VALUES (${FIXTURE_EMAIL}, 'super_admin')
    ON CONFLICT (email) DO NOTHING
  `;

  const [fixture] = await ownerSql<{ id: number }[]>`
    SELECT id FROM auth_users
     WHERE email = ${FIXTURE_EMAIL}
       AND role = 'super_admin'
       AND disabled_at IS NULL
  `;
  if (!fixture) {
    throw new Error(
      `Fixture admin '${FIXTURE_EMAIL}' exists but is not an enabled super_admin. `
      + 'Fix the test database manually before running this suite.',
    );
  }
  fixtureAdminId = fixture.id;
  control.admin = { id: fixture.id, email: FIXTURE_EMAIL };
});

// ---------------------------------------------------------------------------
// Background work (AFLDB-ISSUE-273)
// ---------------------------------------------------------------------------
// A delivery a test starts and awaits later is tracked the moment it starts,
// with its rejection handler already attached. A test that fails before
// awaiting it (an assertion, or a vi.waitFor timeout) therefore cannot leave
// an unhandled rejection, or a delivery still running into the next test or
// into the fixture cleanup: teardown releases and awaits it first.

type BackgroundEntry = { done: Promise<void>; failure: { error: unknown } | null; consumed: boolean };
const background: BackgroundEntry[] = [];
const SETTLE_TIMEOUT_MS = 20_000; // inside the configured 30 s hookTimeout

/** Track `promise`; the test reads its outcome through `result()`. */
function track<T>(promise: Promise<T>): { result: () => Promise<T> } {
  const entry: BackgroundEntry = { done: Promise.resolve(), failure: null, consumed: false };
  entry.done = promise.then(() => {}, (error: unknown) => { entry.failure = { error }; });
  background.push(entry);
  return { result: () => { entry.consumed = true; return promise; } };
}

/**
 * Stop new parking, release every parked delivery and await every tracked
 * one. Returns the failures no test consumed, plus any afterStage hook
 * failure. Throws, keeping the entries, if work is still running after
 * SETTLE_TIMEOUT_MS, so the caller neither resets controls nor cleans
 * fixtures under it.
 */
async function settleBackground(): Promise<unknown[]> {
  control.park = false; // set first: a released multi-row validation must not park again
  for (const release of control.parked.splice(0)) release();
  const entries = [...background];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `${entries.length} background intake operation(s) still running after ${SETTLE_TIMEOUT_MS} ms`,
    )), SETTLE_TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.all(entries.map((e) => e.done)), timedOut]);
  } finally {
    clearTimeout(timer);
  }
  background.splice(0, entries.length);
  return [
    ...entries.filter((e) => e.failure && !e.consumed).map((e) => e.failure!.error),
    ...control.hookFailures.splice(0),
  ];
}

function throwBackgroundFailures(failures: unknown[]): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} unexpected background intake failure(s)`);
  }
}

afterEach(async () => {
  // Await everything this test started before resetting the controls a
  // released delivery still reads (failFileKey, afterStage).
  const failures = await settleBackground();
  control.failFileKey = false;
  control.afterStage = null;
  throwBackgroundFailures(failures);
});

afterAll(async () => {
  // Never clean fixtures under a running delivery: settle anything an
  // afterEach could not, or refuse the cleanup by throwing.
  const failures = await settleBackground();

  // Delete exactly the data_submissions rows created by this run.
  // data_submission_rows are removed automatically by the ON DELETE CASCADE
  // declared in migration 023 (submission_id REFERENCES data_submissions(id)
  // ON DELETE CASCADE).
  //
  // The predicate is `id = ANY(...)` -- not uploaded_by -- so this cannot
  // touch rows created by another run or a concurrent invocation that
  // happens to share the same fixture admin.
  if (runSubmissionIds.size > 0) {
    const ids = [...runSubmissionIds];
    await ownerSql`
      DELETE FROM data_submissions WHERE id = ANY(${ids}::int[])
    `;
  }
  if (runPlayerIds.size > 0) {
    await ownerSql`DELETE FROM players WHERE id = ANY(${[...runPlayerIds]}::int[])`;
  }

  // The fixture auth_users row is intentionally NOT deleted here.
  // Deleting it would race with a concurrent run that reused the same fixture.
  // A durable fixture in the _test database is the correct model for a row
  // that is expensive to recreate and safe to leave in place.

  await ownerSql.end({ timeout: 5 });
  throwBackgroundFailures(failures);
});

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/admin/email-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/email-intake', () => {
  it('refuses to run at all when no secret is configured', async () => {
    // Unset for this case only, so it runs whether or not the suite has a secret.
    vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', '');
    try {
      const res = await POST(request(
        { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
      ));
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects a request with the wrong secret', async () => {
    intakeSecret();
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': 'definitely-not-the-real-secret' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no secret header at all', async () => {
    intakeSecret();
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON', async () => {
    const secret = intakeSecret();
    const res = await POST(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': secret },
      body: 'not json',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a sender who is not a known, enabled admin', async () => {
    const secret = intakeSecret();
    const res = await POST(request(
      { senderEmail: 'definitely-not-an-admin@example.invalid', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': secret },
    ));
    expect(res.status).toBe(403);
  });

  it('stages and validates a real CSV from a real admin end to end', async () => {
    const secret = intakeSecret();

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    expect(admin).toBeDefined();

    // Per-run unique payload via crypto.randomUUID() so the content_sha256
    // is guaranteed distinct from every prior and concurrent run. This
    // prevents the global deduplication check from returning a prior run's
    // submission ID instead of staging a fresh row.
    const runToken = crypto.randomUUID();
    const csv = `player,year,club,position,captain\nA Real Sounding Name ${runToken},2024,Carlton,Half Back,\n`;
    const contentBase64 = Buffer.from(csv, 'utf8').toString('base64');

    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'all_australian', filename: 'test.csv', contentBase64 },
      { 'x-intake-secret': secret },
    ));
    const body = await res.json();

    // Register the submission ID for cleanup BEFORE any assertion that could
    // throw, so afterAll always removes this row even when a later check fails.
    if (typeof body.submissionId === 'number') {
      runSubmissionIds.add(body.submissionId);
    }

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rowCount).toBe(1);
    expect(body.report).toBeDefined();

    const [row] = await authSql<{ status: string; uploadedBy: string }[]>`
      SELECT s.status::text, u.email AS "uploadedBy"
        FROM data_submissions s JOIN auth_users u ON u.id = s.uploaded_by
       WHERE s.id = ${body.submissionId}
    `;
    expect(row.status).toBe('validated');
    expect(row.uploadedBy).toBe(admin.email);

    // Cleanup: afterAll deletes the row by exact ID via the owner pool
    // (owner holds DELETE on data_submissions; authSql/afldb_auth does not).
  });

  it('resolves an identical resend to the submission it already made', async () => {
    const secret = intakeSecret();

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    expect(admin).toBeDefined();

    // Per-run unique payload via crypto.randomUUID(). The SAME payload is
    // deliberately posted TWICE below: the first call creates the submission
    // (duplicate: false) and the second must resolve to that same submission
    // (duplicate: true). Using randomUUID guarantees that no prior run's row
    // can satisfy the deduplication check and cause a false positive here.
    const runToken = crypto.randomUUID();
    const csv = `player,year,club,position,captain\nResend Case ${runToken},2024,Carlton,Half Back,\n`;
    const contentBase64 = Buffer.from(csv, 'utf8').toString('base64');
    const body = { senderEmail: admin.email, dataset: 'all_australian', filename: 'resend.csv', contentBase64 };

    const first = await POST(request(body, { 'x-intake-secret': secret })).then((r) => r.json());

    // Register BEFORE assertions so cleanup runs even on failure.
    if (typeof first.submissionId === 'number') {
      runSubmissionIds.add(first.submissionId);
    }

    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await POST(request(body, { 'x-intake-secret': secret })).then((r) => r.json());

    // The second call returns the same ID as the first. Adding it to the Set
    // is a no-op (Set deduplicates), so this submission is deleted only once
    // in afterAll -- never double-deleted or missed.
    if (typeof second.submissionId === 'number') {
      runSubmissionIds.add(second.submissionId);
    }

    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);

    // Staged once, and the rows staged once with it: a re-run that
    // re-inserted rows would double them under the same submission.
    const [{ count }] = await authSql<{ count: string }[]>`
      SELECT count(*) FROM data_submission_rows WHERE submission_id = ${first.submissionId}
    `;
    expect(Number(count)).toBe(1);
  });

  it('rejects base64 that Buffer.from would silently accept', async () => {
    const secret = intakeSecret();

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    expect(admin).toBeDefined();

    // Buffer.from skips characters it does not recognise rather than
    // throwing, so a damaged transfer would otherwise decode to
    // plausible garbage and surface as a confusing CSV parse error.
    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'all_australian', contentBase64: 'not!valid!base64!' },
      { 'x-intake-secret': secret },
    ));
    // A 400 response means no submission was created; nothing to register.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/base64/i);
  });

  it('rejects an oversized payload', async () => {
    const secret = intakeSecret();

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    expect(admin).toBeDefined();

    const big = 'x'.repeat(6 * 1024 * 1024); // over the 5 MB MAX_UPLOAD_BYTES limit
    const contentBase64 = Buffer.from(big, 'utf8').toString('base64');
    const res = await POST(request(
      { senderEmail: admin.email, dataset: 'match_results', contentBase64 },
      { 'x-intake-secret': secret },
    ));
    // A 400 response means no submission was created; nothing to register.
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-273 (D-273-1): a delivery whose validation a review decision or
// another validation overtook
// ---------------------------------------------------------------------------

/**
 * The keys of the 200 the poller files under Processed for a superseded
 * delivery. tools/email_intake/test_fetch_and_stage.py feeds main() this
 * exact shape.
 */
const SUPERSEDED_KEYS = [
  'duplicate', 'message', 'ok', 'reviewUrl', 'rowCount', 'status', 'submissionId', 'validated',
];
/** The existing retryable 500 body, unchanged by D-273-1. */
const RETRY_ERROR = 'The file was staged but validation failed; it can be re-validated from the review page.';

const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

async function createFixturePlayer(tag: string): Promise<number> {
  const name = `AFLDB-ISSUE-273 intake ${tag} ${crypto.randomUUID()}`;
  const [row] = await ownerSql<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${name}, afldb_normalise_name(${name}), ${name}, ${`issue-273-intake-${crypto.randomUUID()}`})
    RETURNING id
  `;
  runPlayerIds.add(row.id);
  return row.id;
}

/** POST one player_bio CSV as the poller would, registering whatever it staged. */
async function deliver(csv: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await POST(request(
    {
      senderEmail: FIXTURE_EMAIL,
      dataset: 'player_bio',
      filename: 'issue-273.csv',
      contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
    },
    { 'x-intake-secret': intakeSecret() },
  ));
  const body = await res.json() as Record<string, unknown>;
  if (typeof body.submissionId === 'number') runSubmissionIds.add(body.submissionId);
  return { status: res.status, body };
}

/**
 * Start a delivery and return once its validation is parked inside
 * validateRow. The delivery is tracked before the wait, so a wait that times
 * out still leaves it to teardown.
 */
async function startParkedDelivery(csv: string) {
  const index = control.parked.length;
  control.park = true;
  const delivery = track(deliver(csv));
  await vi.waitFor(() => { expect(control.parked.length).toBe(index + 1); }, { timeout: 10_000 });
  return { response: delivery.result, release: control.parked[index] };
}

/** Every submission of this file, registered for cleanup: a second one is the defect. */
async function submissionsOf(csv: string): Promise<number[]> {
  const rows = await ownerSql<{ id: number }[]>`
    SELECT id FROM data_submissions WHERE dataset = 'player_bio' AND content_sha256 = ${sha256(csv)} ORDER BY id
  `;
  for (const { id } of rows) runSubmissionIds.add(id);
  return rows.map((r) => r.id);
}

async function readSubmission(id: number) {
  const [row] = await ownerSql<{
    status: string; reviewedBy: number | null; report: unknown; importBatchId: string | null;
  }[]>`
    SELECT status::text, reviewed_by AS "reviewedBy", validation_report AS report,
           import_batch_id::text AS "importBatchId"
      FROM data_submissions WHERE id = ${id}
  `;
  return row;
}

async function readRows(id: number) {
  return ownerSql<{ rowNo: number; payload: unknown; verdict: string | null; reasons: unknown }[]>`
    SELECT row_no AS "rowNo", payload, verdict, reasons
      FROM data_submission_rows WHERE submission_id = ${id} ORDER BY row_no
  `;
}

async function intakeAudits(id: number) {
  return ownerSql<{ action: string; detail: Record<string, unknown> }[]>`
    SELECT action, detail FROM auth_audit_log
     WHERE action LIKE 'email_intake.%' AND detail->>'submissionId' = ${String(id)}
     ORDER BY id
  `;
}

function decision(id: number, value: 'approve' | 'reject'): FormData {
  const form = new FormData();
  form.set('id', String(id));
  form.set('decision', value);
  return form;
}

describe('AFLDB-ISSUE-273 email intake against a concurrent review (D-273-1)', () => {
  it('a reject during the first delivery stands, and the delivery is acknowledged without a second copy', async () => {
    const playerId = await createFixturePlayer('reject');
    const csv = `player_id,dob\n${playerId},2001-02-03\n`;

    const delivery = await startParkedDelivery(csv);
    const [id] = await submissionsOf(csv);
    expect(id).toBeGreaterThan(0);
    expect(await decideSubmission({}, decision(id, 'reject'))).toEqual({ message: 'Rejected.' });
    delivery.release();
    const { status, body } = await delivery.response();

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(SUPERSEDED_KEYS);
    expect(body).toMatchObject({
      ok: true, submissionId: id, duplicate: false, rowCount: 1, validated: false, status: 'rejected',
      reviewUrl: `/admin/submissions/${id}`,
    });

    const review = await readSubmission(id);
    expect(review.status).toBe('rejected');
    expect(review.reviewedBy).toBe(fixtureAdminId);
    expect(review.report).toBeNull();
    // Staged and never validated: the payload as uploaded, no verdict written.
    expect(await readRows(id)).toEqual([
      { rowNo: 1, payload: { player_id: String(playerId), dob: '2001-02-03' }, verdict: null, reasons: null },
    ]);
    expect(await submissionsOf(csv)).toEqual([id]);
    expect((await intakeAudits(id)).map((a) => [a.action, a.detail.status ?? null])).toEqual([
      ['email_intake.staged', null],
      ['email_intake.validation_superseded', 'rejected'],
    ]);
  });

  it.each([
    { outcome: 'approved', promote: false },
    { outcome: 'promoted', promote: true },
  ])('a review ending $outcome during a resend stands; the resend is acknowledged, not re-staged', async ({
    outcome, promote,
  }) => {
    const playerId = await createFixturePlayer(outcome);
    const csv = `player_id,dob\n${playerId},2002-03-04\n`;

    // The first delivery validates normally; the poller then resends it (a
    // timeout, say) and a reviewer acts while the resend is validating.
    const first = await deliver(csv);
    expect(first.status).toBe(200);
    const id = first.body.submissionId as number;
    const before = await readRows(id);
    expect(before.map((r) => r.verdict)).toEqual(['ok']);

    const resend = await startParkedDelivery(csv);
    expect(await decideSubmission({}, decision(id, 'approve'))).toEqual({ message: 'Approved.' });
    if (promote) expect((await promoteSubmission(id)).ok).toBe(true);
    resend.release();
    const { status, body } = await resend.response();

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(SUPERSEDED_KEYS);
    expect(body).toMatchObject({
      ok: true, submissionId: id, duplicate: true, rowCount: 1, validated: false, status: outcome,
      reviewUrl: `/admin/submissions/${id}`,
    });

    const review = await readSubmission(id);
    expect(review.status).toBe(outcome);
    expect(review.reviewedBy).toBe(fixtureAdminId);
    // The verdicts and payloads the reviewer approved, untouched by the resend.
    expect(await readRows(id)).toEqual(before);
    expect(await submissionsOf(csv)).toEqual([id]);
    if (promote) {
      expect(review.importBatchId).not.toBeNull();
      const [{ count }] = await ownerSql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM import_batches WHERE notes = ${'submission ' + id}
      `;
      expect(count).toBe(1);
    }
    expect((await intakeAudits(id)).map((a) => [a.action, a.detail.status ?? null])).toEqual([
      ['email_intake.staged', null],
      ['email_intake.validated', null],
      ['email_intake.duplicate', null],
      ['email_intake.validation_superseded', outcome],
    ]);
  });

  it('a resend that loses to another validation still gets the 500, and its retry resolves to the same submission', async () => {
    const playerId = await createFixturePlayer('lost');
    const csv = `player_id,dob\n${playerId},2003-04-05\n`;

    const first = await deliver(csv);
    expect(first.status).toBe(200);
    const id = first.body.submissionId as number;

    const resend = await startParkedDelivery(csv);
    await validateSubmission(id); // a reviewer's Validate commits first
    resend.release();
    const lost = await resend.response();

    expect(lost.status).toBe(500);
    expect(lost.body).toEqual({ error: RETRY_ERROR, submissionId: id, reviewUrl: `/admin/submissions/${id}` });
    expect((await readSubmission(id)).status).toBe('validated');

    // The poller's retry of that 500.
    const retry = await deliver(csv);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, submissionId: id, duplicate: true, rowCount: 1 });
    expect(retry.body.report).toEqual({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });
    expect(retry.body.validated).toBeUndefined();
    expect(await submissionsOf(csv)).toEqual([id]);
    expect((await intakeAudits(id)).map((a) => a.action)).toEqual([
      'email_intake.staged', 'email_intake.validated',
      'email_intake.duplicate', 'email_intake.validate_error',
      'email_intake.duplicate', 'email_intake.validated',
    ]);
  });

  it('an ordinary validation failure still gets the existing 500', async () => {
    const playerId = await createFixturePlayer('ordinary');
    const csv = `player_id,dob\n${playerId},2004-05-06\n`;

    control.failFileKey = true;
    const { status, body } = await deliver(csv);

    const [id] = await submissionsOf(csv);
    expect(status).toBe(500);
    expect(body).toEqual({ error: RETRY_ERROR, submissionId: id, reviewUrl: `/admin/submissions/${id}` });
    expect((await readSubmission(id)).status).toBe('staged');
    expect((await readRows(id)).map((r) => r.verdict)).toEqual([null]);
    expect((await intakeAudits(id)).map((a) => a.action)).toEqual([
      'email_intake.staged', 'email_intake.validate_error',
    ]);
  });

  it('a submission deleted mid-validation is not acknowledged', async () => {
    const playerId = await createFixturePlayer('deleted');
    const csv = `player_id,dob\n${playerId},2005-06-07\n`;

    const delivery = await startParkedDelivery(csv);
    const [id] = await submissionsOf(csv);
    await ownerSql`DELETE FROM data_submissions WHERE id = ${id}`;
    delivery.release();
    const { status, body } = await delivery.response();

    expect(status).toBe(500);
    expect(body).toEqual({ error: RETRY_ERROR, submissionId: id, reviewUrl: `/admin/submissions/${id}` });
    expect(await submissionsOf(csv)).toEqual([]);
    expect((await intakeAudits(id)).map((a) => a.action)).toEqual([
      'email_intake.staged', 'email_intake.validate_error',
    ]);
  });
});

describe('AFLDB-ISSUE-273 email intake against a review that lands before validation starts', () => {
  // A decision that commits after staging but before validateSubmission's
  // first read. Before the intake start policy, a reject there was taken as
  // the starting state and rewritten to 'validated'; an approve or promote
  // was refused with a plain error, a 500, and a resend that staged a
  // second copy.
  it.each([
    { outcome: 'rejected', resend: false },
    { outcome: 'rejected', resend: true },
    { outcome: 'approved', resend: true },
    { outcome: 'promoted', resend: true },
  ])('a review ending $outcome before the first read (resend: $resend) stands and is acknowledged', async ({
    outcome, resend,
  }) => {
    const playerId = await createFixturePlayer(`pre-read-${outcome}`);
    const csv = `player_id,dob\n${playerId},2006-07-08\n`;

    let id = 0;
    let beforeRows: Awaited<ReturnType<typeof readRows>> | null = null;
    let beforeReport: unknown = null;
    if (resend) {
      const first = await deliver(csv);
      expect(first.status).toBe(200);
      id = first.body.submissionId as number;
      beforeRows = await readRows(id);
      expect(beforeRows.map((r) => r.verdict)).toEqual(['ok']);
      expect((beforeRows[0].reasons as { resolved: unknown }).resolved).toEqual({ player_id: playerId });
      beforeReport = (await readSubmission(id)).report;
    }

    const decided: number[] = [];
    control.afterStage = async (submissionId) => {
      decided.push(submissionId);
      if (outcome === 'rejected') {
        expect(await decideSubmission({}, decision(submissionId, 'reject'))).toEqual({ message: 'Rejected.' });
      } else {
        expect(await decideSubmission({}, decision(submissionId, 'approve'))).toEqual({ message: 'Approved.' });
        if (outcome === 'promoted') expect((await promoteSubmission(submissionId)).ok).toBe(true);
      }
    };
    const { status, body } = await deliver(csv);
    if (!resend) [id] = await submissionsOf(csv);

    expect(decided).toEqual([id]);
    expect(status).toBe(200);
    // The shape tools/email_intake/test_fetch_and_stage.py feeds main(): filed
    // under Processed, exit 0, one POST, so the poller never resends it.
    expect(Object.keys(body).sort()).toEqual(SUPERSEDED_KEYS);
    expect(body).toEqual({
      ok: true, submissionId: id, duplicate: resend, rowCount: 1, validated: false, status: outcome,
      message: `A reviewer has ruled on this file (it is now ${outcome}); `
        + 'this validation attempt wrote no verdicts or resolved payloads.',
      reviewUrl: `/admin/submissions/${id}`,
    });

    const review = await readSubmission(id);
    expect(review.status).toBe(outcome);
    expect(review.reviewedBy).toBe(fixtureAdminId);
    // Verdicts, resolved payloads and the report exactly as before the delivery.
    expect(review.report).toEqual(beforeReport);
    expect(await readRows(id)).toEqual(beforeRows ?? [
      { rowNo: 1, payload: { player_id: String(playerId), dob: '2006-07-08' }, verdict: null, reasons: null },
    ]);
    expect(await submissionsOf(csv)).toEqual([id]);
    if (outcome === 'promoted') {
      const [{ count }] = await ownerSql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM import_batches WHERE notes = ${'submission ' + id}
      `;
      expect(count).toBe(1);
    }
    expect((await intakeAudits(id)).map((a) => [a.action, a.detail.status ?? null])).toEqual([
      ...(resend ? [['email_intake.staged', null], ['email_intake.validated', null]] : []),
      [resend ? 'email_intake.duplicate' : 'email_intake.staged', null],
      ['email_intake.validation_superseded', outcome],
    ]);
  });

  it('an admin can still re-validate by hand a file the intake left rejected', async () => {
    const playerId = await createFixturePlayer('manual-revalidate');
    const csv = `player_id,dob\n${playerId},2007-08-09\n`;

    control.afterStage = async (submissionId) => {
      expect(await decideSubmission({}, decision(submissionId, 'reject'))).toEqual({ message: 'Rejected.' });
    };
    const delivery = await deliver(csv);
    const [id] = await submissionsOf(csv);
    expect(delivery.body).toMatchObject({ validated: false, status: 'rejected' });
    expect((await readSubmission(id)).status).toBe('rejected');

    const form = new FormData();
    form.set('id', String(id));
    expect(await runValidation({}, form)).toEqual({ message: 'Validated: 1 ok, 0 warnings, 0 errors.' });

    const review = await readSubmission(id);
    expect(review.status).toBe('validated');
    expect(review.report).toEqual({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });
    const [row] = await readRows(id);
    expect(row.verdict).toBe('ok');
    expect((row.reasons as { resolved: unknown }).resolved).toEqual({ player_id: playerId });
    expect(await submissionsOf(csv)).toEqual([id]);
  });
});

describe('AFLDB-ISSUE-273 email intake teardown after an early failure', () => {
  // Each `it.fails` case parks a delivery, arms failFileKey (read only after
  // the release), then fails before awaiting it. The case after it checks
  // that afterEach released the delivery and awaited it to the end BEFORE
  // resetting failFileKey: had it reset first, the delivery would have
  // validated to 200, or still be running.
  const stranded: { id: number; csv: string }[] = [];

  async function strandDelivery(tag: string) {
    const playerId = await createFixturePlayer(tag);
    const csv = `player_id,dob\n${playerId},2008-09-10\n`;
    await startParkedDelivery(csv);
    const [id] = await submissionsOf(csv);
    stranded.push({ id, csv });
    control.failFileKey = true;
  }

  async function expectSettledBeforeReset() {
    const last = stranded.at(-1);
    expect(last).toBeDefined();
    const { id, csv } = last!;
    expect(background).toEqual([]);
    expect(control.parked).toEqual([]);
    expect(control).toMatchObject({ park: false, failFileKey: false, afterStage: null });
    expect((await readSubmission(id)).status).toBe('staged');
    expect((await readRows(id)).map((r) => r.verdict)).toEqual([null]);
    expect(await submissionsOf(csv)).toEqual([id]);
    expect((await intakeAudits(id)).map((a) => a.action)).toEqual([
      'email_intake.staged', 'email_intake.validate_error',
    ]);
  }

  it.fails('(deliberately fails) an assertion failure while a delivery is parked', async () => {
    await strandDelivery('early-assertion');
    expect('the test stopped here').toBe('never');
  });

  it('afterEach finished that delivery before resetting the controls', expectSettledBeforeReset);

  it.fails('(deliberately fails) a wait failure while a delivery is parked', async () => {
    await strandDelivery('early-wait');
    await vi.waitFor(() => { expect('still waiting').toBe('never'); }, { timeout: 50, interval: 10 });
  });

  it('afterEach finished that delivery too', expectSettledBeforeReset);

  it('teardown reports a failure no test consumed and an afterStage failure, but not a consumed one', async () => {
    await expect(track(Promise.reject(new Error('consumed'))).result()).rejects.toThrow('consumed');
    track(Promise.reject(new Error('never consumed')));

    const playerId = await createFixturePlayer('hook-failure');
    const csv = `player_id,dob\n${playerId},2009-10-11\n`;
    control.afterStage = async () => { throw new Error('afterStage failed'); };
    const { status, body } = await deliver(csv);
    await submissionsOf(csv);
    // What the route alone would report: the hook's own error is lost.
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Staging failed on the server.' });

    const failures = await settleBackground();
    expect(failures.map((e) => (e as Error).message)).toEqual(['never consumed', 'afterStage failed']);
    expect(background).toEqual([]);
    expect(control.hookFailures).toEqual([]);
  });
});
