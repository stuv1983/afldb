import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/api/admin/email-intake/route';

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
});

afterAll(async () => {
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

  // The fixture auth_users row is intentionally NOT deleted here.
  // Deleting it would race with a concurrent run that reused the same fixture.
  // A durable fixture in the _test database is the correct model for a row
  // that is expensive to recreate and safe to leave in place.

  await ownerSql.end({ timeout: 5 });
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
    if (process.env.AFLDB_EMAIL_INTAKE_SECRET) return; // covered by the tests below instead
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
    ));
    expect(res.status).toBe(503);
  });

  it('rejects a request with the wrong secret', async () => {
    if (!process.env.AFLDB_EMAIL_INTAKE_SECRET) return; // not configured in this environment
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': 'definitely-not-the-real-secret' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no secret header at all', async () => {
    if (!process.env.AFLDB_EMAIL_INTAKE_SECRET) return;
    const res = await POST(request(
      { senderEmail: 'nobody@example.com', dataset: 'match_results', contentBase64: 'eA==' },
    ));
    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return; // not configured in this environment; covered by the tests above
    const res = await POST(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': secret },
      body: 'not json',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a sender who is not a known, enabled admin', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;
    const res = await POST(request(
      { senderEmail: 'definitely-not-an-admin@example.invalid', dataset: 'match_results', contentBase64: 'eA==' },
      { 'x-intake-secret': secret },
    ));
    expect(res.status).toBe(403);
  });

  it('stages and validates a real CSV from a real admin end to end', async () => {
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    if (!admin) return; // fixture admin missing; beforeAll failure already reported

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
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    if (!admin) return;

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
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    if (!admin) return;

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
    const secret = process.env.AFLDB_EMAIL_INTAKE_SECRET;
    if (!secret) return;

    // Select the fixture admin by its known ID -- never LIMIT 1 / ordering.
    const [admin] = await authSql<{ email: string }[]>`
      SELECT email FROM auth_users WHERE id = ${fixtureAdminId}
    `;
    if (!admin) return;

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
