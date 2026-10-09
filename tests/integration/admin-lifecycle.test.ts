/**
 * The account lifecycle against a real PostgreSQL (AFLDB-ISSUE-155 Phase B
 * §26.15). Everything here needs a database and can be proven nowhere else:
 * that the compare-and-set really matches, that the required audit row and
 * the mutation really share one transaction, that a deactivated account
 * really cannot authenticate, that the foreign keys really refuse to let it
 * be deleted, and that two concurrent super admins really cannot both
 * remove the last one.
 *
 * The unit half — which statements are issued, in which order, on which
 * handle — is tests/admin-lifecycle-actions.test.ts. Read them together.
 *
 * Two deliberate choices, both sanctioned by §26.15:
 *
 *   1. `applyLifecycleMutation` (the production entry point) is used
 *      wherever the invariant count is not the thing under test. Where it
 *      is, the suite calls `runLifecycleSteps` with `countScope` narrowed
 *      to its own fixture ids. afldb_test is shared and carries durable
 *      fixture super admins of its own, so a table-wide count would make
 *      "refuses the last one" depend on what another suite left behind —
 *      and the alternative, deactivating real fixture accounts mid-run,
 *      would be far more intrusive. `countScope` exists only on the
 *      test-facing entry point; the Server Actions cannot pass it.
 *   2. Fixtures are created per test with random emails and cleaned up by
 *      id, never by a table-wide delete.
 */
import './guard';

import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// session.ts's audit writer reads the request IP through next/headers,
// which has no request scope here. requestIp() already absorbs that by
// returning null, but mocking it keeps the suite free of the thrown-and-
// caught error on every audit row.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));

// After the mock, which vitest hoists above the imports.
import {
  INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS,
  redeemInviteInTransaction,
  type InviteRedemptionTestHooks,
  type RedeemableInvite,
} from '@/db/queries/admin-invites';
import {
  applyLifecycleMutation,
  listAdminAccounts,
  runLifecycleSteps,
  type LifecycleMutationInput,
} from '@/db/queries/admin-users';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;

const sql = postgres(testDbUrl, { max: 1 });
const sql1 = postgres(testDbUrl, { max: 1 });
const sql2 = postgres(testDbUrl, { max: 1 });
const observer = postgres(testDbUrl, { max: 1 });
/**
 * AFLDB-ISSUE-270: a connection bounded exactly as confirmEnrolment bounds
 * its dedicated redemption connection, for the statement-timeout case.
 */
const bounded = postgres(testDbUrl, {
  max: 1,
  connection: { statement_timeout: INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS },
});

/** Every auth_users row this run created, for cleanup by id. */
const createdUserIds: number[] = [];
/** Every admin_invites row this run created (AFLDB-ISSUE-270), for cleanup by id. */
const createdInviteIds: number[] = [];

type Fixture = { id: number; email: string };

async function createAccount(options: {
  role: 'contributor' | 'admin' | 'super_admin';
  disabled?: boolean;
  hasPassword?: boolean;
  hasTotp?: boolean;
  canManageAdmins?: boolean;
}): Promise<Fixture> {
  const [row] = await observer<Fixture[]>`
    INSERT INTO auth_users (email, role, password_hash, totp_secret,
                            can_manage_admins, disabled_at)
    VALUES (${`i155-${randomUUID()}@example.test`}, ${options.role},
            ${options.hasPassword === false ? null : 'scrypt$test$dummy'},
            ${options.hasTotp === false ? null : 'JBSWY3DPEHPK3PXP'},
            ${options.canManageAdmins ?? false},
            ${options.disabled ? new Date('2026-09-01T00:00:00Z') : null})
    RETURNING id, email
  `;
  createdUserIds.push(row.id);
  return row;
}

async function createSession(userId: number): Promise<number> {
  const [row] = await observer<{ id: number }[]>`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at)
    VALUES (${randomUUID()}, ${userId}, now() + interval '1 day')
    RETURNING id
  `;
  return row.id;
}

async function readAccount(id: number) {
  const [row] = await observer<{
    role: string; disabledAt: Date | null; canManageAdmins: boolean;
  }[]>`
    SELECT role, disabled_at AS "disabledAt", can_manage_admins AS "canManageAdmins"
      FROM auth_users WHERE id = ${id}
  `;
  return row;
}

async function auditRowsFor(targetId: number) {
  // Compared as text, never cast: auth_audit_log is shared with every
  // other suite's rows and a cast would be evaluated on all of them.
  return observer<{ action: string; actorUserId: number; detail: Record<string, unknown> }[]>`
    SELECT action, actor_user_id AS "actorUserId", detail
      FROM auth_audit_log
     WHERE detail->>'targetUserId' = ${String(targetId)}
     ORDER BY id
  `;
}

async function liveSessionCount(userId: number): Promise<number> {
  const [row] = await observer<{ count: number }[]>`
    SELECT count(*)::int AS count FROM auth_sessions
     WHERE user_id = ${userId} AND revoked_at IS NULL
  `;
  return row.count;
}

/** The mutation input, with the two hidden fields matching the current row. */
function input(
  action: LifecycleMutationInput['action'],
  actor: Fixture,
  target: Fixture,
  over: Partial<LifecycleMutationInput> = {},
): LifecycleMutationInput {
  return {
    action,
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: target.id,
    expectedRole: 'admin',
    expectedActive: true,
    ...(action === 'deactivate'
      ? { reason: 'left the project', confirmEmail: target.email }
      : {}),
    ...over,
  };
}

afterEach(async () => {
  // admin_invites.invited_by references auth_users, so this run's invites
  // go before its users -- by id, never by email pattern.
  if (createdInviteIds.length > 0) {
    await observer`DELETE FROM admin_invites WHERE id = ANY(${createdInviteIds})`;
    createdInviteIds.length = 0;
  }
  if (createdUserIds.length === 0) return;
  // The audit trail's actor FK would refuse the user delete, so this run's
  // rows go first. Sessions cascade with the user.
  await observer`
    DELETE FROM auth_audit_log
     WHERE actor_user_id = ANY(${createdUserIds})
        OR detail->>'targetUserId' = ANY(${createdUserIds.map(String)})
  `;
  await observer`DELETE FROM auth_users WHERE id = ANY(${createdUserIds})`;
  createdUserIds.length = 0;
});

afterAll(async () => {
  await Promise.all([sql.end(), sql1.end(), sql2.end(), observer.end(), bounded.end()]);
});

// Before ANY test in this file writes (AFLDB-ISSUE-270 moved it here from
// that issue's own describe). tests/setup.ts and ./guard check the URL's
// database name and that it connects; this asks the server which database
// the connection actually landed in.
beforeAll(async () => {
  const [{ database }] = await observer<{ database: string }[]>`SELECT current_database() AS database`;
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to write admin fixtures: connected to ${database}, not a _test database.`);
  }
});

describe('preconditions', () => {
  it('has migration 082\'s object-detail constraint, which the atomicity case relies on', async () => {
    const [row] = await observer<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'auth_audit_log_detail_is_object_ck'
           AND conrelid = 'public.auth_audit_log'::regclass
      ) AS present
    `;
    expect(row.present, 'apply migration 082 to this database').toBe(true);
  });
});

describe('promotion', () => {
  it('changes the role, revokes the sessions and writes one audit row, atomically', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin', canManageAdmins: true });
    await createSession(target.id);
    await createSession(target.id);

    const result = await applyLifecycleMutation(sql, input('promote', actor, target));

    expect(result).toMatchObject({ ok: true, email: target.email, revokedSessions: 2 });
    expect(await readAccount(target.id)).toMatchObject({
      role: 'super_admin',
      disabledAt: null,
      // Promotion leaves the delegation flag as it found it (§26.2.7).
      canManageAdmins: true,
    });
    expect(await liveSessionCount(target.id)).toBe(0);

    const audits = await auditRowsFor(target.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('admin.promoted');
    expect(audits[0].actorUserId).toBe(actor.id);
    expect(audits[0].detail).toMatchObject({
      targetEmail: target.email,
      before: { role: 'admin', active: true, canManageAdmins: true },
      after: { role: 'super_admin', active: true, canManageAdmins: true },
      revokedSessions: 2,
    });
  });

  it('writes the mutation and its audit row in one transaction', async () => {
    // xmin is the inserting/updating transaction id: equal on both rows
    // means one transaction wrote them, which is what §26.12 requires.
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });

    await applyLifecycleMutation(sql, input('promote', actor, target));

    const [user] = await observer<{ xmin: string }[]>`
      SELECT xmin::text AS xmin FROM auth_users WHERE id = ${target.id}
    `;
    const [audit] = await observer<{ xmin: string }[]>`
      SELECT xmin::text AS xmin FROM auth_audit_log
       WHERE detail->>'targetUserId' = ${String(target.id)}
    `;
    expect(audit.xmin).toBe(user.xmin);
  });
});

describe('demotion', () => {
  it('demotes, clears the delegation and revokes sessions while another viable super admin remains',
    async () => {
      const actor = await createAccount({ role: 'super_admin' });
      const target = await createAccount({ role: 'super_admin', canManageAdmins: true });
      await createSession(target.id);

      const result = await applyLifecycleMutation(
        sql, input('demote', actor, target, { expectedRole: 'super_admin' }),
      );

      expect(result.ok).toBe(true);
      expect(await readAccount(target.id)).toMatchObject({
        role: 'admin', canManageAdmins: false, disabledAt: null,
      });
      expect(await liveSessionCount(target.id)).toBe(0);
      expect((await auditRowsFor(target.id))[0].action).toBe('admin.demoted');
    });

  it('refuses the last viable super admin, changing nothing', async () => {
    // The scope is the three fixtures: one viable target, one disabled
    // super admin and one that never finished enrolling. Neither of the
    // latter two can sign in, so demoting the target would leave the
    // scope with no one who can administer the site.
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'super_admin' });
    const disabled = await createAccount({ role: 'super_admin', disabled: true });
    const unenrolled = await createAccount({ role: 'super_admin', hasTotp: false });
    await createSession(target.id);

    const result = await sql.begin((tx) => runLifecycleSteps(
      tx,
      input('demote', actor, target, { expectedRole: 'super_admin' }),
      { countScope: [target.id, disabled.id, unenrolled.id] },
    ));

    expect(result).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect(await readAccount(target.id)).toMatchObject({ role: 'super_admin' });
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await auditRowsFor(target.id)).toEqual([]);
  });
});

describe('deactivation', () => {
  it('disables an admin, ends every session and records the reason', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    await createSession(target.id);

    const result = await applyLifecycleMutation(sql, input('deactivate', actor, target));

    expect(result.ok).toBe(true);
    const account = await readAccount(target.id);
    expect(account.disabledAt).toBeInstanceOf(Date);
    expect(account.role).toBe('admin');
    expect(await liveSessionCount(target.id)).toBe(0);

    const audits = await auditRowsFor(target.id);
    expect(audits[0].action).toBe('admin.deactivated');
    expect(audits[0].detail).toMatchObject({
      reason: 'left the project',
      before: { active: true },
      after: { active: false },
    });
  });

  it('deactivates a super admin while another viable one remains', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'super_admin' });

    const result = await applyLifecycleMutation(
      sql, input('deactivate', actor, target, { expectedRole: 'super_admin' }),
    );

    expect(result.ok).toBe(true);
    expect((await readAccount(target.id)).disabledAt).toBeInstanceOf(Date);
  });

  it('refuses the last viable super admin', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'super_admin' });

    const result = await sql.begin((tx) => runLifecycleSteps(
      tx,
      input('deactivate', actor, target, { expectedRole: 'super_admin' }),
      { countScope: [target.id] },
    ));

    expect(result).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect((await readAccount(target.id)).disabledAt).toBeNull();
  });

  it('refuses a mismatched typed email without writing anything', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });

    const result = await applyLifecycleMutation(
      sql, input('deactivate', actor, target, { confirmEmail: 'someone-else@example.test' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect((await readAccount(target.id)).disabledAt).toBeNull();
    expect(await auditRowsFor(target.id)).toEqual([]);
  });
});

describe('reactivation', () => {
  it('clears disabled_at, revives no session and audits the change', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin', disabled: true });
    const sessionId = await createSession(target.id);
    await observer`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${sessionId}`;

    const result = await applyLifecycleMutation(
      sql, input('reactivate', actor, target, { expectedActive: false }),
    );

    expect(result.ok).toBe(true);
    expect((await readAccount(target.id)).disabledAt).toBeNull();
    // The session that ended at deactivation stays ended: reactivation is
    // "you may sign in again", not "you are signed in again".
    expect(await liveSessionCount(target.id)).toBe(0);
    expect((await auditRowsFor(target.id))[0].action).toBe('admin.reactivated');
  });
});

describe('refusals that need no invariant', () => {
  it('refuses a stale request and writes nothing', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });

    const result = await applyLifecycleMutation(
      sql, input('promote', actor, target, { expectedRole: 'contributor' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'stale' });
    expect((await readAccount(target.id)).role).toBe('admin');
    expect(await auditRowsFor(target.id)).toEqual([]);
  });

  it('refuses a super admin acting on their own account', async () => {
    const actor = await createAccount({ role: 'super_admin' });

    const result = await applyLifecycleMutation(
      sql, input('demote', actor, actor, { expectedRole: 'super_admin' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'self' });
    expect((await readAccount(actor.id)).role).toBe('super_admin');
  });

  it('refuses an actor who is no longer an enabled super admin', async () => {
    const actor = await createAccount({ role: 'admin' });
    const target = await createAccount({ role: 'admin' });

    const result = await applyLifecycleMutation(sql, input('promote', actor, target));

    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await readAccount(target.id)).role).toBe('admin');
  });
});

describe('required audit and the mutation share one outcome', () => {
  it('rolls the role change and the session revoke back when the audit INSERT fails', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    await createSession(target.id);

    // A non-object detail violates auth_audit_log_detail_is_object_ck, so
    // the required audit row cannot be written. auditInTransaction does
    // not swallow that, which is the whole contract: the UPDATE and the
    // session revoke must go with it.
    await expect(sql.begin((tx) => runLifecycleSteps(
      tx,
      input('promote', actor, target),
      { auditDetail: 'not-an-object' },
    ))).rejects.toThrow();

    expect((await readAccount(target.id)).role).toBe('admin');
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await auditRowsFor(target.id)).toEqual([]);
  });
});

describe('a deactivated account keeps its history and loses its access', () => {
  it('cannot sign in, holds no live session, and is still refused by the delete', async () => {
    const actor = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    await createSession(target.id);

    // Something the account did, before it was deactivated.
    await observer`
      INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
      VALUES (${target.id}, ${target.email}, 'admin.login', ${observer.json({ historical: true })})
    `;

    await applyLifecycleMutation(sql, input('deactivate', actor, target));

    // 1. The adminLogin predicate (src/app/admin/login/actions.ts). Kept in
    //    step with that file's real role list by
    //    tests/auth.test.ts's source-contract check (AFLDB-ISSUE-186).
    const login = await observer`
      SELECT id FROM auth_users
       WHERE lower(email) = lower(${target.email})
         AND role IN ('admin', 'super_admin')
         AND disabled_at IS NULL
    `;
    expect(login).toEqual([]);

    // 2. And no session survives to carry it past getAdminUser either.
    expect(await liveSessionCount(target.id)).toBe(0);

    // 3. The attribution is intact, and the row cannot be deleted: this is
    //    why the lifecycle is deactivation and there is no delete path.
    const history = await observer<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth_audit_log
       WHERE actor_user_id = ${target.id} AND action = 'admin.login'
    `;
    expect(history[0].count).toBe(1);

    await expect(observer.begin(async (tx) => {
      await tx`DELETE FROM auth_users WHERE id = ${target.id}`;
    })).rejects.toMatchObject({ code: '23503' });
  });
});

/**
 * AFLDB-ISSUE-186 Phase A: the deprecated contributor CSV pipeline is
 * retired at the account/access boundary only -- no schema change, no
 * DEV/PROD mutation, no disabled_at backfill. A fixture contributor row is
 * created here with disabled_at left NULL on purpose (createAccount's
 * default): retirement must hold even for a contributor account nobody has
 * ever explicitly deactivated, which is the state every real contributor
 * row is left in by this issue.
 */
describe('AFLDB-ISSUE-186: the retired contributor role cannot authenticate, but its history survives', () => {
  it('is excluded from the login predicate by role alone, disabled_at IS NULL and all', async () => {
    const target = await createAccount({ role: 'contributor' });
    expect((await readAccount(target.id)).disabledAt).toBeNull();

    // Same predicate as adminLogin() (src/app/admin/login/actions.ts) --
    // kept accurate by tests/auth.test.ts's source-contract check.
    const login = await observer`
      SELECT id FROM auth_users
       WHERE lower(email) = lower(${target.email})
         AND role IN ('admin', 'super_admin')
         AND disabled_at IS NULL
    `;
    expect(login).toEqual([]);
  });

  it('is excluded from getAdminUser even with a live, unexpired, unrevoked session', async () => {
    const target = await createAccount({ role: 'contributor' });
    await createSession(target.id);

    // Same predicate as getAdminUser() (src/lib/auth/session.ts) -- proven
    // against the real function, via its captured SQL text, in
    // tests/auth.test.ts. Reproduced here against a real row/session pair
    // so the DB half of the claim -- a contributor session issued before
    // retirement, still perfectly live by every OTHER predicate here -- is
    // proven too, not merely asserted.
    const found = await observer`
      SELECT u.id
        FROM auth_sessions s
        JOIN auth_users u ON u.id = s.user_id
       WHERE s.user_id = ${target.id}
         AND s.expires_at > now()
         AND s.revoked_at IS NULL
         AND u.disabled_at IS NULL
         AND u.role IN ('admin', 'super_admin')
    `;
    expect(found).toEqual([]);
    // The session row itself is untouched -- no revocation sweep was run
    // or is needed; the row lookup above is simply never satisfied again.
    expect(await liveSessionCount(target.id)).toBe(1);
  });

  it('test B: remains fully readable in the admin roster, unmutated', async () => {
    const target = await createAccount({ role: 'contributor', hasPassword: true, hasTotp: true });

    const { accounts } = await listAdminAccounts(observer, { id: target.id, role: 'super_admin' });
    const row = accounts.find((a) => a.id === target.id);

    expect(row).toBeDefined();
    expect(row).toMatchObject({
      role: 'contributor',
      disabledAt: null,
      hasPassword: true,
      hasTotp: true,
    });
  });

  it('test H: uploaded_by/reviewed_by FK attribution to a contributor row is untouched by retirement', async () => {
    // This issue changes no schema and mutates no data_submissions row; the
    // FK that makes that history durable is migration 023's, unmodified
    // here. Proven the same way the deactivation case above proves it: the
    // referencing row exists and the referenced account cannot be deleted
    // out from under it -- retirement narrows WHO can sign in, never what
    // a past submission is attributed to.
    const target = await createAccount({ role: 'contributor' });
    const [submission] = await observer<{ id: number }[]>`
      INSERT INTO data_submissions (dataset, filename, content, content_sha256, uploaded_by, row_count)
      VALUES ('match_results', 'i186-fixture.csv', '\\x'::bytea, ${randomUUID()}, ${target.id}, 0)
      RETURNING id
    `;
    try {
      await expect(observer.begin(async (tx) => {
        await tx`DELETE FROM auth_users WHERE id = ${target.id}`;
      })).rejects.toMatchObject({ code: '23503' });

      const [row] = await observer<{ uploadedBy: number }[]>`
        SELECT uploaded_by AS "uploadedBy" FROM data_submissions WHERE id = ${submission.id}
      `;
      expect(row.uploadedBy).toBe(target.id);
    } finally {
      // Must run before afterEach's DELETE FROM auth_users, or this
      // fixture's own FK would refuse that cleanup for every later test.
      await observer`DELETE FROM data_submissions WHERE id = ${submission.id}`;
    }
  });
});

/**
 * The concurrency contract (§26.7, required).
 *
 * Blocking is proven with pg_blocking_pids() on a third connection, the
 * idiom tests/integration/player-link-concurrency.test.ts established.
 * No sleep is load-bearing: the poll below waits for a fact, and the
 * transactions are released in a fixed order.
 */
/**
 * Polls until backend `t2Pid` is waiting on a lock held by `t1Pid`. Shared
 * by the lifecycle and invite-redemption concurrency cases below.
 */
async function waitForBlock(t1Pid: number, t2Pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [{ blocking }] = await observer<{ blocking: number[] }[]>`
      SELECT pg_blocking_pids(${t2Pid}) AS blocking
    `;
    if (blocking?.includes(t1Pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for PID ${t2Pid} to be blocked by PID ${t1Pid}`);
}

/** A promise with its settle functions exposed: a barrier or a readiness signal. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** How long a background transaction may take to reach its announced point. */
const READY_TIMEOUT_MS = 10_000;

/** `promise`, or a rejection naming `what` after `ms`: a readiness wait never hangs. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Background = {
  /** Registers a started transaction or watcher; a rejection is handled at once and reported after the body. */
  track<T>(promise: Promise<T>): Promise<T>;
  /** Registers a barrier release, run after the body whether it resolved or threw. */
  onRelease(release: () => void): void;
};

/**
 * Runs `body` (AFLDB-ISSUE-270's concurrency cases), then -- on every path,
 * including the body throwing -- runs every registered release and awaits
 * every tracked promise before returning, so no transaction or watcher
 * outlives the test into the file's afterEach cleanup. The body's own error
 * wins; otherwise the first background failure is thrown.
 */
async function withBackground<T>(body: (bg: Background) => Promise<T>): Promise<T> {
  const tracked: Promise<unknown>[] = [];
  const releases: (() => void)[] = [];
  const bg: Background = {
    track(promise) {
      promise.catch(() => undefined);
      tracked.push(promise);
      return promise;
    },
    onRelease(release) { releases.push(release); },
  };
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await body(bg) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  for (const release of releases) release();
  const settled = await Promise.allSettled(tracked);
  if (!outcome.ok) throw outcome.error;
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  return outcome.value;
}

/**
 * Starts `body` as the second transaction on `sql2` and returns it tracked
 * by `bg` (so withBackground awaits it on every path), together with its
 * backend PID. The PID wait is bounded by READY_TIMEOUT_MS and fails at once
 * if the transaction ends, or fails, before announcing itself, so a broken
 * start never leaves the first transaction holding its locks until Vitest's
 * own timeout.
 */
async function startTracked<T>(
  bg: Background,
  body: (tx2: postgres.TransactionSql) => Promise<T>,
  what: string,
): Promise<{ done: Promise<unknown>; pid: number }> {
  const started = deferred<number>();
  const done = bg.track(sql2.begin(async (tx2) => {
    const [{ pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    started.resolve(pid);
    return body(tx2);
  }));
  done.then(
    () => started.reject(new Error(`${what} ended before announcing itself`)),
    (error) => started.reject(error),
  );
  return { done, pid: await within(started.promise, READY_TIMEOUT_MS, what) };
}

describe('two super admins acting at once', () => {
  // Both cases start the second transaction inside the first one's
  // afterLock hook, under withBackground: whatever fails -- the PID wait,
  // the block wait, the first transaction, an assertion inside the body --
  // the second transaction is still awaited before the file's afterEach
  // deletes the fixtures. No barrier is needed: the second transaction is
  // held only by the first one's own locks, which end with it.
  it('mutual demotion: the loser waits, re-reads its own row and refuses', async () => {
    const a = await createAccount({ role: 'super_admin' });
    const b = await createAccount({ role: 'super_admin' });
    await createSession(a.id);
    await createSession(b.id);

    const { t1Result, t2Result } = await withBackground(async (bg) => {
      const race: { t2?: Promise<unknown> } = {};

      const t1Result = await sql1.begin(async (tx1) => {
        const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

        return runLifecycleSteps(
          tx1,
          input('demote', a, b, { expectedRole: 'super_admin' }),
          {
            // Hold the advisory lock and both row locks while B's attempt
            // on A is started and proven blocked.
            afterLock: async () => {
              const t2 = await startTracked(bg, (tx2) => runLifecycleSteps(
                tx2,
                input('demote', b, a, { expectedRole: 'super_admin' }),
              ), 'B\'s demotion of A');
              race.t2 = t2.done;
              await waitForBlock(t1Pid, t2.pid);
            },
          },
        );
      });

      if (!race.t2) throw new Error('B\'s demotion of A was never started');
      return { t1Result, t2Result: await race.t2 };
    });

    // A demoted B. B's transaction then woke up, re-read its OWN row, and
    // found it is no longer a super admin: the request that would have
    // left the pair with no administrator is refused.
    expect(t1Result).toMatchObject({ ok: true });
    expect(t2Result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await readAccount(a.id)).role).toBe('super_admin');
    expect((await readAccount(b.id)).role).toBe('admin');
    expect(await liveSessionCount(b.id)).toBe(0);
    expect(await liveSessionCount(a.id)).toBe(1);
  });

  it('the invariant is counted under the lock, so the second deactivation refuses', async () => {
    // Actor C is never a target (self is refused), so it survives whatever
    // happens. The count scope is the two targets, which makes the second
    // transaction's answer decisive: after the first commits, deactivating
    // the other would leave the scope with no viable super admin.
    const actor = await createAccount({ role: 'super_admin' });
    const x = await createAccount({ role: 'super_admin' });
    const y = await createAccount({ role: 'super_admin' });
    const scope = { countScope: [x.id, y.id] };

    const { t1Result, t2Result } = await withBackground(async (bg) => {
      const race: { t2?: Promise<unknown> } = {};

      const t1Result = await sql1.begin(async (tx1) => {
        const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

        return runLifecycleSteps(
          tx1,
          input('deactivate', actor, x, { expectedRole: 'super_admin' }),
          {
            ...scope,
            afterLock: async () => {
              const t2 = await startTracked(bg, (tx2) => runLifecycleSteps(
                tx2,
                input('deactivate', actor, y, { expectedRole: 'super_admin' }),
                scope,
              ), 'the deactivation of Y');
              race.t2 = t2.done;
              await waitForBlock(t1Pid, t2.pid);
            },
          },
        );
      });

      if (!race.t2) throw new Error('the deactivation of Y was never started');
      return { t1Result, t2Result: await race.t2 };
    });

    expect(t1Result).toMatchObject({ ok: true });
    expect(t2Result).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect((await readAccount(x.id)).disabledAt).toBeInstanceOf(Date);
    // The invariant held: one of the two is still an enabled super admin.
    expect(await readAccount(y.id)).toMatchObject({ role: 'super_admin', disabledAt: null });
  });
});

/**
 * AFLDB-ISSUE-270: the invite redemption's account write against a real
 * PostgreSQL. The unit half (tests/auth.test.ts) proves which decision is
 * taken and which statements are issued; only a database can prove that
 * the upsert's `ON CONFLICT ... WHERE` really refuses a row created after
 * the lock read, and that the issuer row really stays locked to commit.
 *
 * `redeemInviteInTransaction` is the body confirmEnrolment runs, driven
 * here on the suite's own connections. It writes no audit row (the Server
 * Action does that after the transaction), so these fixtures leave none.
 *
 * Fixture rules: the file-wide beforeAll has checked current_database()
 * ends in `_test` before any write; every new address is a fresh
 * `i270-<uuid>@example.test` that is refused if it already exists anywhere;
 * a row is recorded as this run's only once its creating transaction has
 * committed, and only when this run created it (see `redeem`); everything
 * is removed by id in the file's afterEach, never by email pattern. The
 * concurrency cases run their background transactions under
 * `withBackground`, which releases every barrier and awaits every started
 * transaction and watcher on every path. No real administrator is touched.
 */
describe('invite redemption cannot overwrite a peer (AFLDB-ISSUE-270)', () => {
  /** Addresses this run reserved: the only ones at which a redemption may create a row this run owns. */
  const reservedEmails = new Set<string>();

  /** A fresh reserved address, refused if any row already uses it. */
  async function reservedEmail(): Promise<string> {
    const email = `i270-${randomUUID()}@example.test`;
    const [row] = await observer<{ users: number; invites: number }[]>`
      SELECT (SELECT count(*)::int FROM auth_users    WHERE email = ${email}) AS users,
             (SELECT count(*)::int FROM admin_invites WHERE email = ${email}) AS invites
    `;
    if (row.users !== 0 || row.invites !== 0) {
      throw new Error(`Reserved fixture address ${email} already exists; refusing to touch it.`);
    }
    reservedEmails.add(email);
    return email;
  }

  /** Staged on every fixture invite, so a refusal can be shown to leave them in place. */
  const PENDING_HASH = 'scrypt$i270$pending';
  const PENDING_SECRET = 'I270PENDINGSECRET';
  /** An unconsumed invite: unused, its staged credentials intact. */
  const unconsumed = { usedAt: null, pendingPasswordHash: PENDING_HASH, pendingTotpSecret: PENDING_SECRET };

  /** Records a committed row this run created; idempotent. */
  function own(id: number): void {
    if (!createdUserIds.includes(id)) createdUserIds.push(id);
  }

  /** The competing writer's account: committed at once on the observer connection. */
  async function createAccountAt(email: string, role: 'admin'): Promise<Fixture> {
    const [row] = await observer<Fixture[]>`
      INSERT INTO auth_users (email, role, password_hash, totp_secret)
      VALUES (${email}, ${role}, 'scrypt$i270$competitor', 'I270COMPETITORSECRET')
      RETURNING id, email
    `;
    // Autocommitted: the row is committed by the time it is returned.
    own(row.id);
    return row;
  }

  async function createInvite(
    issuer: Fixture,
    email: string,
    role: 'admin' | 'super_admin' = 'admin',
    canManageAdmins = false,
  ): Promise<RedeemableInvite> {
    const [row] = await observer<RedeemableInvite[]>`
      INSERT INTO admin_invites (email, role, can_manage_admins, token_hash, invited_by, expires_at,
                                 pending_password_hash, pending_totp_secret)
      VALUES (${email}, ${role}, ${canManageAdmins}, ${`i270-${randomUUID()}`}, ${issuer.id},
              now() + interval '1 day', ${PENDING_HASH}, ${PENDING_SECRET})
      RETURNING id, email, role, can_manage_admins AS "canManageAdmins", invited_by AS "invitedBy"
    `;
    createdInviteIds.push(row.id);
    return row;
  }

  async function redeem(
    db: postgres.Sql,
    invite: RedeemableInvite,
    label: string,
    hooks?: InviteRedemptionTestHooks,
  ) {
    // The upsert returns an id whether it inserted or overwrote, so the id
    // alone never makes a row this run's. A row is adopted only when the
    // address is one this run reserved and held no row when the redemption
    // began: then the row there afterwards was inserted by it (or by a
    // competitor this test started, which registers its own row). Any other
    // returned id is an existing row, owned already or not ours to delete.
    const [before] = await observer<{ id: number }[]>`SELECT id FROM auth_users WHERE email = ${invite.email}`;
    const mayInsert = reservedEmails.has(invite.email) && before === undefined;
    const result = await db.begin((tx) => redeemInviteInTransaction(tx, {
      invite,
      passwordHash: `scrypt$i270$${label}`,
      totpSecret: `I270${label.toUpperCase()}SECRET`,
      totpStep: 1,
    }, hooks));
    // begin() has resolved, so the transaction has committed.
    if (result.ok && mayInsert) own(result.userId);
    return result;
  }

  async function accountCountAt(email: string): Promise<number> {
    const [row] = await observer<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth_users WHERE email = ${email}
    `;
    return row.count;
  }

  async function credentialsAt(email: string) {
    const [row] = await observer<{
      id: number; role: string; passwordHash: string; totpSecret: string; disabledAt: Date | null;
    }[]>`
      SELECT id, role, password_hash AS "passwordHash", totp_secret AS "totpSecret",
             disabled_at AS "disabledAt"
        FROM auth_users WHERE email = ${email}
    `;
    return row;
  }

  async function inviteState(id: number) {
    const [row] = await observer<{
      usedAt: Date | null; pendingPasswordHash: string | null; pendingTotpSecret: string | null;
    }[]>`
      SELECT used_at AS "usedAt", pending_password_hash AS "pendingPasswordHash",
             pending_totp_secret AS "pendingTotpSecret"
        FROM admin_invites WHERE id = ${id}
    `;
    return row;
  }

  const refusedPeer = { ok: false, reason: 'target_requires_super_admin', existingRole: 'admin' };

  it('a spare invite cannot overwrite the admin its sibling invite created', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const email = await reservedEmail();
    const first = await createInvite(manager, email);
    const spare = await createInvite(manager, email);

    const enrolled = await redeem(sql, first, 'alice');
    expect(enrolled).toMatchObject({ ok: true });
    const alice = await credentialsAt(email);
    await createSession(alice.id);

    const takeover = await redeem(sql, spare, 'manager');

    expect(takeover).toMatchObject(refusedPeer);
    expect(await credentialsAt(email)).toMatchObject({
      role: 'admin', passwordHash: 'scrypt$i270$alice', totpSecret: 'I270ALICESECRET',
    });
    expect(await liveSessionCount(alice.id)).toBe(1);
    expect(await inviteState(spare.id)).toEqual(unconsumed);
  });

  it('refuses a target promoted to admin after the invite was issued', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const target = await createAccount({ role: 'contributor' });
    const invite = await createInvite(manager, target.email);
    await observer`UPDATE auth_users SET role = 'admin' WHERE id = ${target.id}`;
    await createSession(target.id);

    expect(await redeem(sql, invite, 'manager')).toMatchObject(refusedPeer);
    expect(await credentialsAt(target.email)).toMatchObject({ role: 'admin', passwordHash: 'scrypt$test$dummy' });
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('refuses an admin created, and committed, after the lock read found the address free', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const email = await reservedEmail();
    const invite = await createInvite(manager, email);
    const holder: { peer?: Fixture } = {};

    const result = await redeem(sql1, invite, 'manager', {
      // The lock read has run and found no account. Another writer now
      // creates the address as an admin, committed, with a live session.
      afterLock: async () => {
        holder.peer = await createAccountAt(email, 'admin');
        await createSession(holder.peer.id);
      },
    });

    expect(result).toMatchObject(refusedPeer);
    expect(await credentialsAt(email)).toMatchObject({
      id: holder.peer!.id, role: 'admin', passwordHash: 'scrypt$i270$competitor',
      totpSecret: 'I270COMPETITORSECRET',
    });
    expect(await liveSessionCount(holder.peer!.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('refuses an admin whose creation is still uncommitted when the upsert arrives', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const email = await reservedEmail();
    const invite = await createInvite(manager, email);

    const result = await withBackground(async (bg) => {
      // The creator commits only once this gate opens: when the redemption's
      // upsert is proven to be waiting on it, or -- on any failure path --
      // when withBackground releases it.
      const gate = deferred<void>();
      bg.onRelease(() => gate.resolve());

      return sql1.begin(async (tx1) => {
        const [{ pid: redeemerPid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        return redeemInviteInTransaction(tx1, {
          invite, passwordHash: 'scrypt$i270$manager', totpSecret: 'I270MANAGERSECRET', totpStep: 1,
        }, {
          afterLock: async () => {
            const inserted = deferred<number>();
            // The competing writer inserts the admin row and holds its
            // transaction open until the redemption's upsert is proven to be
            // waiting on it; only then does it commit.
            const creator = bg.track(sql2.begin(async (tx2) => {
              const [{ pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
              const [row] = await tx2<{ id: number }[]>`
                INSERT INTO auth_users (email, role, password_hash, totp_secret)
                VALUES (${email}, 'admin', 'scrypt$i270$competitor', 'I270COMPETITORSECRET')
                RETURNING id
              `;
              inserted.resolve(pid);
              await gate.promise;
              return row.id;
            }).then((id) => {
              // begin() resolved: committed, so the row is now this run's.
              own(id);
              return id;
            }));
            // A creator that fails (or finishes) before announcing fails the
            // wait below instead of leaving it pending forever.
            creator.then(
              () => inserted.reject(new Error('the competing insert ended before announcing itself')),
              (error) => inserted.reject(error),
            );
            const creatorPid = await within(inserted.promise, READY_TIMEOUT_MS, 'the competing insert');
            // Not awaited here: the upsert must run while this watches it.
            bg.track(waitForBlock(creatorPid, redeemerPid).finally(() => gate.resolve()));
          },
        });
      });
    });

    expect(result).toMatchObject(refusedPeer);
    expect(await credentialsAt(email)).toMatchObject({
      role: 'admin', passwordHash: 'scrypt$i270$competitor', totpSecret: 'I270COMPETITORSECRET',
    });
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('does not let a super admin demoted since issuing the invite reset a peer', async () => {
    const formerBoss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    const invite = await createInvite(formerBoss, target.email);
    await observer`UPDATE auth_users SET role = 'admin' WHERE id = ${formerBoss.id}`;
    await createSession(target.id);

    // D-270-2: a demoted issuer (no delegation) authorises nothing, so the
    // authority refusal comes before the target rule.
    expect(await redeem(sql, invite, 'formerboss')).toMatchObject({
      ok: false, reason: 'issuer_not_admin_manager', existingRole: 'admin',
    });
    expect(await credentialsAt(target.email)).toMatchObject({ passwordHash: 'scrypt$test$dummy' });
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  /*
   * D-270-2 (operator decision, 2026-10-09): the issuer's current authority
   * is required for every redemption. Each case changes the issuer after
   * issuance, then proves the redemption creates no account at a free
   * address, changes nothing about an existing contributor, and leaves the
   * invite unconsumed.
   */
  it('refuses a stale super_admin grant at a free address once its issuer is no longer a super admin', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const email = await reservedEmail();
    const invite = await createInvite(boss, email, 'super_admin');
    // Demoted, then (separately) given the delegation: an admin manager
    // still, but one who may no longer grant super_admin.
    await observer`UPDATE auth_users SET role = 'admin', can_manage_admins = true WHERE id = ${boss.id}`;

    expect(await redeem(sql, invite, 'stalesuper')).toEqual({
      ok: false,
      reason: 'grant_exceeds_issuer',
      existingRole: null,
      issuer: { role: 'admin', active: true, canManageAdmins: true },
    });
    expect(await accountCountAt(email)).toBe(0);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('refuses a stale can_manage_admins grant over a contributor once its issuer is no longer a super admin', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'contributor' });
    const invite = await createInvite(boss, target.email, 'admin', true);
    await observer`UPDATE auth_users SET role = 'admin', can_manage_admins = true WHERE id = ${boss.id}`;
    await createSession(target.id);

    expect(await redeem(sql, invite, 'staledelegation')).toMatchObject({
      ok: false, reason: 'grant_exceeds_issuer', existingRole: 'contributor',
    });
    expect(await credentialsAt(target.email)).toMatchObject({
      id: target.id, role: 'contributor', passwordHash: 'scrypt$test$dummy', totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    expect((await readAccount(target.id)).canManageAdmins).toBe(false);
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('refuses a free-address enrolment once the issuing manager loses the delegation', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const email = await reservedEmail();
    const invite = await createInvite(manager, email);
    await observer`UPDATE auth_users SET can_manage_admins = false WHERE id = ${manager.id}`;

    expect(await redeem(sql, invite, 'nodelegation')).toMatchObject({
      ok: false, reason: 'issuer_not_admin_manager', existingRole: null,
    });
    expect(await accountCountAt(email)).toBe(0);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('refuses enrolment over a contributor once the issuing manager is deactivated', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const target = await createAccount({ role: 'contributor' });
    const invite = await createInvite(manager, target.email);
    await observer`UPDATE auth_users SET disabled_at = now() WHERE id = ${manager.id}`;
    await createSession(target.id);

    expect(await redeem(sql, invite, 'deactivated')).toMatchObject({
      ok: false, reason: 'issuer_deactivated', existingRole: 'contributor',
    });
    expect(await credentialsAt(target.email)).toMatchObject({ role: 'contributor', passwordHash: 'scrypt$test$dummy' });
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
  });

  it('lets a current super admin\'s invite reset an existing admin', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    const invite = await createInvite(boss, target.email);
    await createSession(target.id);
    await createSession(target.id);

    expect(await redeem(sql, invite, 'reset')).toEqual({ ok: true, userId: target.id });
    expect(await credentialsAt(target.email)).toMatchObject({
      role: 'admin', passwordHash: 'scrypt$i270$reset', totpSecret: 'I270RESETSECRET', disabledAt: null,
    });
    expect(await liveSessionCount(target.id)).toBe(0);
    expect((await inviteState(invite.id)).usedAt).toBeInstanceOf(Date);
  });

  it('holds the issuer row through an authorised reset, so a demotion waits for it', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    const invite = await createInvite(boss, target.email);

    // No gate: the demotion is held by the redemption's own issuer lock and
    // finishes when that transaction ends, by commit or by rollback.
    // withBackground awaits it on every path.
    const result = await withBackground(async (bg) => sql1.begin(async (tx1) => {
      const [{ pid: redeemerPid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      return redeemInviteInTransaction(tx1, {
        invite, passwordHash: 'scrypt$i270$held', totpSecret: 'I270HELDSECRET', totpStep: 1,
      }, {
        afterLock: async () => {
          const started = deferred<number>();
          const demotion = bg.track(sql2.begin(async (tx2) => {
            const [{ pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            started.resolve(pid);
            await tx2`UPDATE auth_users SET role = 'admin' WHERE id = ${boss.id}`;
          }));
          demotion.then(
            () => started.reject(new Error('the demotion ended before announcing itself')),
            (error) => started.reject(error),
          );
          const demoterPid = await within(started.promise, READY_TIMEOUT_MS, 'the demotion to start');
          await waitForBlock(redeemerPid, demoterPid);
        },
      });
    }));

    // The reset committed under the authority it read; the demotion applied after.
    expect(result).toEqual({ ok: true, userId: target.id });
    expect(await credentialsAt(target.email)).toMatchObject({ passwordHash: 'scrypt$i270$held' });
    expect((await readAccount(boss.id)).role).toBe('admin');
  });

  it('times out, writing nothing, while another transaction holds the issuer row', async () => {
    // A reset that would succeed (a current super admin's invite over an
    // admin), so only the timeout stands between it and the target's
    // credentials, sessions and the invite.
    const boss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'admin' });
    const invite = await createInvite(boss, target.email);
    await createSession(target.id);
    const before = await credentialsAt(target.email);

    const attempt = await withBackground(async (bg) => {
      // The holder keeps the issuer row locked until this opens: after the
      // redemption has settled, or -- on any failure path -- when
      // withBackground releases it. It changes nothing and commits.
      const gate = deferred<void>();
      bg.onRelease(() => gate.resolve());
      const locked = deferred<number>();
      const holder = bg.track(sql2.begin(async (tx2) => {
        const [{ pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx2`SELECT id FROM auth_users WHERE id = ${boss.id} FOR UPDATE`;
        locked.resolve(pid);
        await gate.promise;
      }));
      holder.then(
        () => locked.reject(new Error('the issuer-row holder ended before announcing its lock')),
        (error) => locked.reject(error),
      );
      const holderPid = await within(locked.promise, READY_TIMEOUT_MS, 'the issuer-row lock');

      // `bounded` has one connection, so this is the backend the redemption runs on.
      const [{ pid: redeemerPid }] = await bounded<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      // Settled into a value, so a rejection is this case's evidence rather
      // than a background failure withBackground would rethrow.
      const settled = bg.track(redeem(bounded, invite, 'timedout').then(
        (result) => ({ completed: true as const, result }),
        (error: unknown) => ({ completed: false as const, error }),
      ));
      // Proven blocked on the holder, not failing for some other reason.
      await waitForBlock(holderPid, redeemerPid);
      // The server must cancel the read at the statement timeout; the
      // client-side deadline only keeps a server that never does from hanging
      // the case. Expiry throws here, so withBackground opens the gate and
      // awaits every tracked promise, and the error fails the case.
      const outcome = await within(
        settled,
        INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS + READY_TIMEOUT_MS,
        `PostgreSQL to cancel the blocked redemption at its ${INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS} ms statement timeout`,
      );
      gate.resolve();
      return outcome;
    });

    // The server cancelled the redemption's lock read at the bound.
    if (attempt.completed) {
      throw new Error(`the redemption completed while the issuer row was held: ${JSON.stringify(attempt.result)}`);
    }
    const error = attempt.error as { code?: string; message?: string };
    expect(error.code).toBe('57014');
    expect(error.message).toMatch(/statement timeout/);
    // Rolled back as a whole: the target's credentials, its session and the
    // invite are exactly as they were.
    expect(await credentialsAt(target.email)).toEqual(before);
    expect(await liveSessionCount(target.id)).toBe(1);
    expect(await inviteState(invite.id)).toEqual(unconsumed);
    // The holder committed without changing the issuer.
    expect(await readAccount(boss.id)).toMatchObject({ role: 'super_admin', disabledAt: null });
  });

  it('completes a super admin\'s invite to their own address without deadlocking on itself', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const invite = await createInvite(boss, boss.email, 'super_admin');

    expect(await redeem(sql, invite, 'self')).toEqual({ ok: true, userId: boss.id });
    expect(await credentialsAt(boss.email)).toMatchObject({ role: 'super_admin', passwordHash: 'scrypt$i270$self' });
  });

  it('still lets a delegated manager\'s invite enrol over an existing contributor', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const target = await createAccount({ role: 'contributor' });
    const invite = await createInvite(manager, target.email);

    expect(await redeem(sql, invite, 'contrib')).toEqual({ ok: true, userId: target.id });
    expect(await credentialsAt(target.email)).toMatchObject({ role: 'admin', passwordHash: 'scrypt$i270$contrib' });
  });

  it('still lets a delegated manager\'s invite enrol a free address', async () => {
    const manager = await createAccount({ role: 'admin', canManageAdmins: true });
    const email = await reservedEmail();
    const invite = await createInvite(manager, email);

    const result = await redeem(sql, invite, 'newcomer');

    expect(result).toMatchObject({ ok: true });
    expect(await credentialsAt(email)).toMatchObject({ role: 'admin', passwordHash: 'scrypt$i270$newcomer' });
    expect((await inviteState(invite.id)).usedAt).toBeInstanceOf(Date);
  });

  it('keeps refusing an account that outranks the invite, even from a super admin', async () => {
    const boss = await createAccount({ role: 'super_admin' });
    const target = await createAccount({ role: 'super_admin' });
    const invite = await createInvite(boss, target.email, 'admin');

    expect(await redeem(sql, invite, 'demote')).toMatchObject({
      ok: false, reason: 'outranked', existingRole: 'super_admin',
    });
    expect(await credentialsAt(target.email)).toMatchObject({ role: 'super_admin', passwordHash: 'scrypt$test$dummy' });
  });
});
