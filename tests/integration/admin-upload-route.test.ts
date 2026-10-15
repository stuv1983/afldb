import './guard';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/admin/upload/stage/route';

/**
 * AFLDB-ISSUE-303 (D-303-1): the REAL upload route and the REAL staging pipeline on
 * `afldb_test`. The decision cases (CSRF, the size bound, the order of the checks) are
 * `tests/admin-upload-route.test.ts`; what only PostgreSQL can show is that a file between
 * 1 MB and 5 MB, which the Server Action refused at the framework, now reaches
 * `data_submissions` intact, with its rows and its audit event.
 *
 * Only the session is stubbed (the route's `requireCapability` returns a fixture admin); the
 * audit write, the staging transaction and the duplicate check are the real ones.
 */
const control = vi.hoisted(() => ({ admin: { id: 0, email: '' } }));
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/session')>(),
  requireCapability: vi.fn(async () => control.admin),
}));

// Redirect the auth pool to the test database before its first query (authSql is lazy).
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const FIXTURE_EMAIL = 'admin-upload-route-test-fixture@afldb.test';
const SAME_ORIGIN = {
  host: 'dev.afldb.example',
  origin: 'https://dev.afldb.example',
  'sec-fetch-site': 'same-origin',
};

let ownerSql: ReturnType<typeof postgres>;
let fixtureAdminId = 0;
const runSubmissionIds = new Set<number>();

beforeAll(async () => {
  ownerSql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
  const [db] = await ownerSql<{ db: string }[]>`SELECT current_database() AS db`;
  if (db.db !== 'afldb_test') throw new Error(`REFUSED: connected to ${db.db}, not afldb_test`);
  // A per-run user, removed (with its audit rows) in afterAll.
  const [created] = await ownerSql<{ id: number }[]>`
    INSERT INTO auth_users (email, role) VALUES (${FIXTURE_EMAIL}, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id`;
  fixtureAdminId = created.id;
  control.admin = { id: created.id, email: FIXTURE_EMAIL };
});

afterAll(async () => {
  try {
    if (runSubmissionIds.size > 0) {
      await ownerSql`DELETE FROM data_submissions WHERE id = ANY(${[...runSubmissionIds]}::int[])`;
    }
    if (fixtureAdminId > 0) {
      await ownerSql`DELETE FROM auth_audit_log WHERE actor_user_id = ${fixtureAdminId}`;
      await ownerSql`DELETE FROM auth_users WHERE id = ${fixtureAdminId}`;
    }
  } finally {
    await ownerSql.end({ timeout: 5 });
  }
});

/** About `targetBytes` of match_attendance CSV: 1 KB of padding per row keeps the row count small. */
function attendanceCsv(targetBytes: number, salt: string): Buffer {
  const pad = 'x'.repeat(1000);
  const lines = ['match_id,attendance,note'];
  let size = lines[0].length + 1;
  for (let i = 1; size < targetBytes; i += 1) {
    const line = `${900_000_000 + i},${10_000 + i},${salt}-${pad}`;
    lines.push(line);
    size += line.length + 1;
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

async function upload(csv: Buffer, name = 'attendance.csv'): Promise<Response> {
  const form = new FormData();
  form.set('dataset', 'match_attendance');
  form.set('file', new File([csv as BlobPart], name, { type: 'text/csv' }));
  const wire = new Response(form);
  const bytes = new Uint8Array(await wire.arrayBuffer());
  return POST(new Request('https://dev.afldb.example/admin/upload/stage', {
    method: 'POST',
    headers: {
      ...SAME_ORIGIN,
      'content-type': wire.headers.get('content-type')!,
      'content-length': String(bytes.length),
    },
    body: bytes as BodyInit,
  }));
}

describe('POST /admin/upload/stage on afldb_test', () => {
  it('stages a 1.5 MB CSV: the size the Server Action refused', async () => {
    const csv = attendanceCsv(1_500_000, `run-${Date.now()}`);
    expect(csv.length).toBeGreaterThan(1024 * 1024);
    expect(csv.length).toBeLessThan(5 * 1024 * 1024);

    const response = await upload(csv);
    const body = await response.json() as { ok?: boolean; submissionId?: number; duplicate?: boolean; redirectTo?: string; error?: string };
    if (typeof body.submissionId === 'number') runSubmissionIds.add(body.submissionId);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const submissionId = body.submissionId as number;
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(body.redirectTo).toBe(`/admin/submissions/${body.submissionId}`);

    const [submission] = await ownerSql<{
      dataset: string; filename: string; status: string; rowCount: number; sha: string; uploadedBy: number;
    }[]>`
      SELECT dataset, filename, status, row_count AS "rowCount", content_sha256 AS sha, uploaded_by AS "uploadedBy"
        FROM data_submissions WHERE id = ${submissionId}`;
    expect(submission).toMatchObject({
      dataset: 'match_attendance', filename: 'attendance.csv', status: 'staged', uploadedBy: fixtureAdminId,
    });
    const { createHash } = await import('node:crypto');
    expect(submission.sha).toBe(createHash('sha256').update(csv).digest('hex'));
    const [rows] = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_submission_rows WHERE submission_id = ${submissionId}`;
    expect(rows.n).toBe(submission.rowCount);
    expect(rows.n).toBe(csv.toString('utf8').split('\n').filter(Boolean).length - 1);

    const audit = await ownerSql<{ action: string }[]>`
      SELECT action FROM auth_audit_log WHERE actor_user_id = ${fixtureAdminId} ORDER BY id`;
    expect(audit.map((a) => a.action)).toContain('upload.staged');

    // The same bytes again land on the same submission, as the old action did.
    const again = await upload(csv);
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true, submissionId: body.submissionId });
  }, 120_000);

  it('refuses a file over 5 MiB with the old message and stages nothing', async () => {
    const before = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_submissions WHERE uploaded_by = ${fixtureAdminId}`;
    const csv = attendanceCsv(5 * 1024 * 1024 + 1024, 'oversize');
    const response = await upload(csv);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'The file exceeds the 5 MB limit.' });
    const after = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_submissions WHERE uploaded_by = ${fixtureAdminId}`;
    expect(after[0].n).toBe(before[0].n);
  }, 120_000);

  it('answers a pipeline rejection (a missing column) with 422 and audits it', async () => {
    const response = await upload(Buffer.from('match_id\n1\n'));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toContain('Missing required column');
    const audit = await ownerSql<{ action: string }[]>`
      SELECT action FROM auth_audit_log WHERE actor_user_id = ${fixtureAdminId}`;
    expect(audit.map((a) => a.action)).toContain('upload.rejected');
  }, 60_000);
});

// authSql is a lazy Proxy shared with the route; its pool is left to process exit, as in
// email-intake.test.ts.
void authSql;
