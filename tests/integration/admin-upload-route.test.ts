import { verifyIsolatedIntegrationDatabase } from './guard';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { POST } from '@/app/admin/upload/stage/route';

/**
 * AFLDB V2 Stage 5 (V2-GAP-013, docs/v2/legacy-disposition.md L1): the CSV upload route
 * (`/admin/upload/stage`) is RETIRED, against a real `afldb_test`.
 *
 * Replaces the AFLDB-ISSUE-303 (D-303-1) cases that proved a 1.5 MB CSV reached
 * `data_submissions` intact. The decision cases (CSRF order, no body read, the 410 refusal) are
 * `tests/admin-upload-route.test.ts`; what only PostgreSQL can show is that an upload the old
 * route would have staged leaves no `data_submissions` or `data_submission_rows` row, and that the
 * refusal is audited once, with the real `audit()` write, naming the actor.
 *
 * Only the session is stubbed (the route's `requireCapability` returns a fixture admin). NOT
 * EXECUTED ON THE V2 WORKSTATION: it needs `afldb_test`, which V2 may not reach; like every
 * integration file it fails at load there (docs/v2/evidence/baseline-failures.txt).
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

beforeAll(async () => {
  ownerSql = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
  await verifyIsolatedIntegrationDatabase(ownerSql);
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
    if (fixtureAdminId > 0) {
      await ownerSql`DELETE FROM auth_audit_log WHERE actor_user_id = ${fixtureAdminId}`;
      await ownerSql`DELETE FROM data_submissions WHERE uploaded_by = ${fixtureAdminId}`;
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

const submissionsBy = async (userId: number): Promise<number> => {
  const [row] = await ownerSql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM data_submissions WHERE uploaded_by = ${userId}`;
  return row.n;
};

describe('POST /admin/upload/stage on afldb_test: retired', () => {
  it('answers 410 to a 1.5 MB CSV the old route staged, and stages nothing', async () => {
    const csv = attendanceCsv(1_500_000, `run-${Date.now()}`);
    expect(csv.length).toBeGreaterThan(1024 * 1024);
    expect(csv.length).toBeLessThan(5 * 1024 * 1024);
    const before = await submissionsBy(fixtureAdminId);

    const response = await upload(csv);

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.csv_upload' });
    expect(await submissionsBy(fixtureAdminId)).toBe(before);
    const [rows] = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_submission_rows r
        JOIN data_submissions s ON s.id = r.submission_id WHERE s.uploaded_by = ${fixtureAdminId}`;
    expect(rows.n).toBe(0);
  }, 120_000);

  it('answers 410 to a file over 5 MiB too (the size refusal is no longer reached) and stages nothing', async () => {
    const before = await submissionsBy(fixtureAdminId);
    const response = await upload(attendanceCsv(5 * 1024 * 1024 + 1024, 'oversize'));
    expect(response.status).toBe(410);
    expect(await submissionsBy(fixtureAdminId)).toBe(before);
  }, 120_000);

  it('writes one audit row per refusal with the real audit(), naming the actor and the surface', async () => {
    const [before] = await ownerSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth_audit_log
       WHERE actor_user_id = ${fixtureAdminId} AND action = 'admin.legacy_retired_refused'`;

    const response = await upload(Buffer.from('match_id\n1\n'));
    expect(response.status).toBe(410);

    const rows = await ownerSql<{ detail: { surface: string; export: string } }[]>`
      SELECT detail FROM auth_audit_log
       WHERE actor_user_id = ${fixtureAdminId} AND action = 'admin.legacy_retired_refused' ORDER BY id`;
    expect(rows).toHaveLength(before.n + 1);
    expect(rows.at(-1)!.detail).toEqual({ surface: 'admin.csv_upload', export: 'POST' });
    // The retired audit events of the old route are never written.
    const old = await ownerSql<{ action: string }[]>`
      SELECT action FROM auth_audit_log
       WHERE actor_user_id = ${fixtureAdminId} AND action IN ('upload.staged', 'upload.duplicate', 'upload.rejected')`;
    expect(old).toEqual([]);
  }, 60_000);
});

// authSql is a lazy Proxy shared with the route; its pool is left to process exit.
void authSql;
