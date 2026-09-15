/**
 * AFLDB-ISSUE-178: approving a beta join request is atomic against a real
 * PostgreSQL.
 *
 * Before this fix, `approveJoinRequest` committed the join-request UPDATE,
 * the beta_allowed_emails upsert and the access.join_approved audit row as
 * three independent statements on the auth pool. A failure on either of the
 * last two left a request recorded as approved without the email actually
 * being allowlisted, or an approval live with no audit row. The fix moves
 * all three into one `authSql.begin` transaction with `auditInTransaction`
 * for the audit row, keeping the existing `WHERE id = ? AND status =
 * 'pending'` predicate as both the eligibility check and the concurrency
 * boundary.
 *
 * THE THINGS PROVED HERE, and why each needs a real database:
 *
 *   1. THE HAPPY PATH really writes all three rows.
 *   2. A GENUINE MID-TRANSACTION FAILURE rolls all three back. The failure
 *      is forced with a real constraint, not a mocked rejection:
 *      beta_allowed_emails carries both a byte-wise UNIQUE(email) (the
 *      ON CONFLICT arbiter) and a separate case-insensitive
 *      uq_beta_allowed_emails_lower (migration 044). Every real write path
 *      lowercases before storing, so the two never disagree in production —
 *      but a fixture inserted directly, bypassing that lowercasing, can
 *      hold a different-case twin of the request's email. The INSERT then
 *      misses the ON CONFLICT (email) arbiter (different exact case) and
 *      hits the lower(email) index instead, a genuine 23505 no mock could
 *      produce. This also proves the "already-existing revoked row" case:
 *      its revoked_at/note must survive untouched, not end up reactivated.
 *   3. TWO CONCURRENT APPROVALS of the same row: PostgreSQL's row lock on
 *      the first UPDATE, not application logic, decides the race — only a
 *      real second connection blocking on a real lock proves that.
 *   4. APPROVE RACING DENY: the same `WHERE status = 'pending'` predicate
 *      already serializes this on both actions without any shared lock
 *      being written for this issue.
 *
 * requireCapability is mocked to skip the cookie/session round-trip (unit
 * coverage for who is authorised to call this action lives elsewhere in the
 * capability system); auditInTransaction and authSql are the real
 * implementations, redirected at afldb_test.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Before anything imports src/db/authClient.ts (lazily, on first query) --
// same convention as tests/integration/admin-draft.test.ts.
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// requestIp() (src/lib/auth/session.ts) reads next/headers with no request
// scope here; same stub as tests/integration/admin-lifecycle.test.ts.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));

const fixtureAdmin = vi.hoisted(() => ({ id: 0, email: '' }));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    requireCapability: vi.fn(async () => ({ id: fixtureAdmin.id, email: fixtureAdmin.email })),
  };
});

// After the mocks, which vitest hoists above every import in this file.
import { approveJoinRequest, denyJoinRequest } from '@/app/admin/access/actions';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-178';
const FIXTURE_ADMIN_EMAIL = 'issue-178-fixture-admin@example.test';

const joinRequestIds = new Set<number>();
const allowedEmails = new Set<string>();

function form(id: number): FormData {
  const data = new FormData();
  data.set('id', String(id));
  return data;
}

async function createJoinRequest(email: string): Promise<number> {
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO beta_join_requests (email, status)
    VALUES (${email}, 'pending')
    RETURNING id
  `;
  joinRequestIds.add(row.id);
  return row.id;
}

async function readJoinRequest(id: number) {
  const [row] = await owner<{
    status: string; reviewedBy: number | null; reviewedAt: Date | null;
  }[]>`
    SELECT status, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt"
      FROM beta_join_requests WHERE id = ${id}
  `;
  return row;
}

async function readAllowedEmail(email: string) {
  const [row] = await owner<{ note: string | null; revokedAt: Date | null }[]>`
    SELECT note, revoked_at AS "revokedAt" FROM beta_allowed_emails WHERE email = ${email}
  `;
  return row ?? null;
}

async function auditActionsFor(requestId: number): Promise<string[]> {
  const rows = await owner<{ action: string }[]>`
    SELECT action FROM auth_audit_log
     WHERE detail->>'requestId' = ${String(requestId)}
     ORDER BY id
  `;
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  await owner`
    INSERT INTO auth_users (email, role)
    VALUES (${FIXTURE_ADMIN_EMAIL}, 'admin')
    ON CONFLICT (email) DO NOTHING
  `;
  const [admin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users WHERE email = ${FIXTURE_ADMIN_EMAIL}
  `;
  fixtureAdmin.id = admin.id;
  fixtureAdmin.email = FIXTURE_ADMIN_EMAIL;
});

afterEach(async () => {
  if (joinRequestIds.size > 0) {
    await owner`
      DELETE FROM auth_audit_log
       WHERE detail->>'requestId' = ANY(${[...joinRequestIds].map(String)})
    `;
    await owner`DELETE FROM beta_join_requests WHERE id = ANY(${[...joinRequestIds]}::int[])`;
    joinRequestIds.clear();
  }
  if (allowedEmails.size > 0) {
    await owner`DELETE FROM beta_allowed_emails WHERE email = ANY(${[...allowedEmails]})`;
    allowedEmails.clear();
  }
});

afterAll(async () => {
  // The fixture admin row is intentionally retained -- shared afldb_test,
  // same rationale as tests/integration/submission-promotion.test.ts.
  await owner.end({ timeout: 5 });
});

describe('AFLDB-ISSUE-178 approveJoinRequest happy path', () => {
  it('approves the request, allowlists the email and audits it, atomically', async () => {
    const email = `${MARKER.toLowerCase()}-happy@example.test`;
    allowedEmails.add(email);
    const id = await createJoinRequest(email);

    const result = await approveJoinRequest({}, form(id));

    expect(result.error).toBeUndefined();
    expect(result.message).toBe(`${email} approved and allowlisted.`);

    const request = await readJoinRequest(id);
    expect(request.status).toBe('approved');
    expect(request.reviewedBy).toBe(fixtureAdmin.id);
    expect(request.reviewedAt).toBeInstanceOf(Date);

    const allowed = await readAllowedEmail(email);
    expect(allowed).not.toBeNull();
    expect(allowed!.note).toBe('via join request');
    expect(allowed!.revokedAt).toBeNull();

    expect(await auditActionsFor(id)).toEqual(['access.join_approved']);
  });

  it('reports the same refusal for an unknown id as an already-reviewed one', async () => {
    const email = `${MARKER.toLowerCase()}-already@example.test`;
    allowedEmails.add(email);
    const id = await createJoinRequest(email);
    await owner`UPDATE beta_join_requests SET status = 'denied' WHERE id = ${id}`;

    const reviewed = await approveJoinRequest({}, form(id));
    const unknown = await approveJoinRequest({}, form(999999999));

    expect(reviewed.error).toBe('Already reviewed or not found.');
    expect(unknown.error).toBe(reviewed.error);
    expect(await readAllowedEmail(email)).toBeNull();
  });
});

describe('AFLDB-ISSUE-178 a genuine mid-transaction failure rolls everything back', () => {
  it('leaves the request pending and the prior revoked allowlist row untouched', async () => {
    const email = `${MARKER.toLowerCase()}-rollback@example.test`;
    const differentCaseTwin = `${MARKER}-ROLLBACK@EXAMPLE.TEST`;
    allowedEmails.add(email);
    allowedEmails.add(differentCaseTwin);

    // Planted directly, bypassing the application's lowercasing, so this
    // row's exact-case email differs from the request's while lower(email)
    // collides -- the case migration 044 says application code alone
    // prevents, not the database.
    const revokedAt = new Date('2026-01-01T00:00:00.000Z');
    await owner`
      INSERT INTO beta_allowed_emails (email, note, revoked_at)
      VALUES (${differentCaseTwin}, 'prior revoked note', ${revokedAt})
    `;

    const id = await createJoinRequest(email);

    await expect(approveJoinRequest({}, form(id))).rejects.toThrow(
      /uq_beta_allowed_emails_lower|duplicate key value/,
    );

    // 1. The join request UPDATE did not survive the rollback.
    const request = await readJoinRequest(id);
    expect(request.status).toBe('pending');
    expect(request.reviewedBy).toBeNull();
    expect(request.reviewedAt).toBeNull();

    // 2. No new allowlist row for the request's own email exists.
    expect(await readAllowedEmail(email)).toBeNull();

    // 3. The pre-existing (differently-cased) row is exactly as it was --
    //    not reactivated, note untouched.
    const twin = await readAllowedEmail(differentCaseTwin);
    expect(twin).not.toBeNull();
    expect(twin!.revokedAt).toEqual(revokedAt);
    expect(twin!.note).toBe('prior revoked note');

    // 4. No partial audit row survives.
    expect(await auditActionsFor(id)).toEqual([]);
  });
});

describe('AFLDB-ISSUE-178 concurrency', () => {
  it('lets exactly one of two concurrent approvals of the same request succeed', async () => {
    const email = `${MARKER.toLowerCase()}-concurrent@example.test`;
    allowedEmails.add(email);
    const id = await createJoinRequest(email);

    const [a, b] = await Promise.all([
      approveJoinRequest({}, form(id)),
      approveJoinRequest({}, form(id)),
    ]);

    const succeeded = [a, b].filter((r) => r.message);
    const refused = [a, b].filter((r) => r.error);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.error).toBe('Already reviewed or not found.');

    const request = await readJoinRequest(id);
    expect(request.status).toBe('approved');
    expect(request.reviewedBy).toBe(fixtureAdmin.id);

    const allowed = await readAllowedEmail(email);
    expect(allowed).not.toBeNull();
    expect(allowed!.revokedAt).toBeNull();

    // Only the winner's approval was audited.
    expect(await auditActionsFor(id)).toEqual(['access.join_approved']);
  });

  it('lets exactly one of a concurrent approve and deny of the same request win', async () => {
    const email = `${MARKER.toLowerCase()}-approve-vs-deny@example.test`;
    allowedEmails.add(email);
    const id = await createJoinRequest(email);

    const [approveResult, denyResult] = await Promise.all([
      approveJoinRequest({}, form(id)),
      denyJoinRequest({}, form(id)),
    ]);

    const outcomes = [approveResult, denyResult];
    const succeeded = outcomes.filter((r) => r.message);
    const refused = outcomes.filter((r) => r.error);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.error).toBe('Already reviewed or not found.');

    const request = await readJoinRequest(id);
    const approveWon = approveResult.message !== undefined;
    expect(request.status).toBe(approveWon ? 'approved' : 'denied');

    const allowed = await readAllowedEmail(email);
    const audits = await auditActionsFor(id);
    if (approveWon) {
      expect(allowed).not.toBeNull();
      expect(audits).toEqual(['access.join_approved']);
    } else {
      expect(allowed).toBeNull();
      expect(audits).toEqual(['access.join_denied']);
    }
  });
});
