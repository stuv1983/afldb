import './guard';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/api/admin/email-intake/route';
import { decideSubmission, runPromotion, runValidation } from '@/app/admin/submissions/[id]/actions';

/**
 * AFLDB V2 Stage 5 (V2-GAP-013, docs/v2/legacy-disposition.md L2/L3): the email intake route and
 * the three submission review actions are RETIRED, against a real `afldb_test`.
 *
 * Replaces the AFLDB-ISSUE-273 / AFLDB-ISSUE-304 suite that drove a real delivery through the
 * route against concurrent review actions (reviewer races, the declared-size bound, a deleted
 * submission). Those entry points now only refuse, so the races have no runtime path left; the
 * library contracts they exercised (`validateSubmission`, `promoteSubmission`) are proved
 * directly in tests/integration/submission-promotion.test.ts.
 *
 * What only PostgreSQL can show, and this file pins:
 *   - a delivery the old route would have staged (valid secret, known sender, real CSV) leaves
 *     NO `data_submissions` row and NO `auth_audit_log` row (an unattributed call is not audited);
 *   - each review action refuses an existing submission without changing its status, reviewer or
 *     rows, and writes exactly ONE `admin.legacy_retired_refused` audit row naming the actor.
 *
 * Only the session guards are stubbed (they return the fixture admin); the audit write and the
 * database are the real ones. NOT EXECUTED ON THE V2 WORKSTATION: it needs `afldb_test`, which V2
 * may not reach. Like every integration file it fails at load there (baseline-failures.txt).
 */
const control = vi.hoisted(() => ({ admin: { id: 0, email: '' } }));
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/session')>(),
  requireAdmin: vi.fn(async () => control.admin),
  requireSuperAdmin: vi.fn(async () => control.admin),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Redirect the auth pool to the test database before its first query (authSql is lazy).
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

/** The actions take no parameters; a stale `useActionState` client still posts (previous state, form data). */
type StaleAction = (previous: object, form: FormData) => Promise<unknown>;
const staleValidation = runValidation as unknown as StaleAction;
const staleDecision = decideSubmission as unknown as StaleAction;
const stalePromotion = runPromotion as unknown as StaleAction;

/** The route takes no parameter; the request is passed to prove it is ignored. */
const deliver = POST as unknown as (request: Request) => Promise<Response>;

const FIXTURE_EMAIL = 'email-intake-retired-test-fixture@afldb.test';
const MARKER = 'v2-stage5-retired';

let ownerSql: ReturnType<typeof postgres>;
let fixtureAdminId = 0;
const submissionIds = new Set<number>();

beforeAll(async () => {
  ownerSql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
  const [db] = await ownerSql<{ db: string }[]>`SELECT current_database() AS db`;
  if (!db.db.endsWith('_test')) throw new Error(`REFUSED: connected to ${db.db}, not a _test database`);
  const [created] = await ownerSql<{ id: number }[]>`
    INSERT INTO auth_users (email, role) VALUES (${FIXTURE_EMAIL}, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id`;
  fixtureAdminId = created.id;
  control.admin = { id: created.id, email: FIXTURE_EMAIL };
  vi.stubEnv('AFLDB_EMAIL_INTAKE_SECRET', 'integration-secret');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    if (submissionIds.size > 0) {
      await ownerSql`DELETE FROM data_submissions WHERE id = ANY(${[...submissionIds]}::int[])`;
    }
    if (fixtureAdminId > 0) {
      await ownerSql`DELETE FROM auth_audit_log WHERE actor_user_id = ${fixtureAdminId}`;
      await ownerSql`DELETE FROM data_submissions WHERE uploaded_by = ${fixtureAdminId}`;
      await ownerSql`DELETE FROM auth_users WHERE id = ${fixtureAdminId}`;
    }
  } finally {
    await ownerSql.end({ timeout: 5 });
  }
});

const submissionCount = async (): Promise<number> => {
  const [row] = await ownerSql<{ n: number }[]>`SELECT count(*)::int AS n FROM data_submissions`;
  return row.n;
};

const auditCount = async (action: string): Promise<number> => {
  const [row] = await ownerSql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM auth_audit_log WHERE action = ${action}`;
  return row.n;
};

/** A staged submission inserted directly (the retired intake can no longer make one). */
async function insertHistoricalSubmission(status: 'staged' | 'validated' | 'approved'): Promise<number> {
  const sha = `${MARKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [row] = await ownerSql<{ id: number }[]>`
    INSERT INTO data_submissions
      (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
    VALUES ('player_bio', ${`${MARKER}.csv`}, ${Buffer.from('player_id,dob\n1,2000-01-01\n')}, ${sha},
            ${fixtureAdminId}, 1, ${status}::submission_status)
    RETURNING id`;
  submissionIds.add(row.id);
  await ownerSql`
    INSERT INTO data_submission_rows (submission_id, row_no, payload, verdict, reasons)
    VALUES (${row.id}, 1, ${ownerSql.json({ player_id: '1', dob: '2000-01-01' })}, 'ok',
            ${ownerSql.json({ resolved: { player_id: 1 } })})`;
  return row.id;
}

const snapshotOf = async (id: number) => {
  const [row] = await ownerSql<{
    status: string; reviewedBy: number | null; importBatchId: string | null; verdicts: string;
  }[]>`
    SELECT s.status::text, s.reviewed_by AS "reviewedBy", s.import_batch_id::text AS "importBatchId",
           (SELECT string_agg(coalesce(r.verdict, '-'), ',' ORDER BY r.row_no)
              FROM data_submission_rows r WHERE r.submission_id = s.id) AS verdicts
      FROM data_submissions s WHERE s.id = ${id}`;
  return row;
};

const form = (id: number, decision?: 'approve' | 'reject'): FormData => {
  const f = new FormData();
  f.set('id', String(id));
  if (decision) f.set('decision', decision);
  return f;
};

describe('POST /api/admin/email-intake on afldb_test: retired', () => {
  it('answers 410 to a delivery the old route would have staged, and stages nothing', async () => {
    const before = await submissionCount();
    const res = await deliver(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': 'integration-secret' },
      body: JSON.stringify({
        senderEmail: FIXTURE_EMAIL,
        dataset: 'player_bio',
        filename: `${MARKER}.csv`,
        contentBase64: Buffer.from('player_id,dob\n1,2000-01-01\n').toString('base64'),
      }),
    }));

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.email_intake' });
    expect(await submissionCount()).toBe(before);
  });

  it('writes no audit row for the call, from any actor (an anonymous call must not write audit rows)', async () => {
    const before = await auditCount('admin.legacy_retired_refused');
    const beforeIntake = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth_audit_log WHERE action LIKE 'email_intake.%'`;

    await deliver(new Request('http://localhost/api/admin/email-intake', {
      method: 'POST', headers: { 'x-intake-secret': 'wrong' }, body: '{}',
    }));

    expect(await auditCount('admin.legacy_retired_refused')).toBe(before);
    const afterIntake = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth_audit_log WHERE action LIKE 'email_intake.%'`;
    expect(afterIntake[0].n).toBe(beforeIntake[0].n);
  });
});

describe('the submission review actions on afldb_test: retired', () => {
  it.each([
    ['runValidation', 'staged', (id: number) => staleValidation({}, form(id))],
    ['decideSubmission (approve)', 'validated', (id: number) => staleDecision({}, form(id, 'approve'))],
    ['decideSubmission (reject)', 'validated', (id: number) => staleDecision({}, form(id, 'reject'))],
    ['runPromotion', 'approved', (id: number) => stalePromotion({}, form(id))],
  ] as const)('%s refuses, changes nothing, and writes one audit row', async (name, status, call) => {
    const id = await insertHistoricalSubmission(status);
    const before = await snapshotOf(id);
    const auditBefore = await auditCount('admin.legacy_retired_refused');

    const result = await call(id);

    expect(result).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.submission_review' });
    expect(await snapshotOf(id)).toEqual(before);
    expect(await auditCount('admin.legacy_retired_refused')).toBe(auditBefore + 1);
    const [row] = await ownerSql<{ actor: number; detail: { surface: string; export: string } }[]>`
      SELECT actor_user_id AS actor, detail FROM auth_audit_log
       WHERE action = 'admin.legacy_retired_refused' ORDER BY id DESC LIMIT 1`;
    expect(row.actor).toBe(fixtureAdminId);
    expect(row.detail).toEqual({ surface: 'admin.submission_review', export: name.split(' ')[0] });
  });
});

// authSql is a lazy Proxy shared with the route; its pool is left to process exit, as in the
// suites this file replaces.
void authSql;
