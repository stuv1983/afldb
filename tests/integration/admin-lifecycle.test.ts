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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

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
  applyLifecycleMutation,
  runLifecycleSteps,
  type LifecycleMutationInput,
} from '@/db/queries/admin-users';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;

const sql = postgres(testDbUrl, { max: 1 });
const sql1 = postgres(testDbUrl, { max: 1 });
const sql2 = postgres(testDbUrl, { max: 1 });
const observer = postgres(testDbUrl, { max: 1 });

/** Every auth_users row this run created, for cleanup by id. */
const createdUserIds: number[] = [];

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
  await Promise.all([sql.end(), sql1.end(), sql2.end(), observer.end()]);
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

    // 1. The adminLogin predicate (src/lib/auth/login.ts) finds nothing.
    const login = await observer`
      SELECT id FROM auth_users
       WHERE lower(email) = lower(${target.email})
         AND role IN ('admin', 'super_admin', 'contributor')
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
 * The concurrency contract (§26.7, required).
 *
 * Blocking is proven with pg_blocking_pids() on a third connection, the
 * idiom tests/integration/player-link-concurrency.test.ts established.
 * No sleep is load-bearing: the poll below waits for a fact, and the
 * transactions are released in a fixed order.
 */
describe('two super admins acting at once', () => {
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

  it('mutual demotion: the loser waits, re-reads its own row and refuses', async () => {
    const a = await createAccount({ role: 'super_admin' });
    const b = await createAccount({ role: 'super_admin' });
    await createSession(a.id);
    await createSession(b.id);

    const race: { t2?: Promise<unknown> } = {};

    const t1Result = await sql1.begin(async (tx1) => {
      const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

      let resolveT2Pid!: (pid: number) => void;
      const t2PidPromise = new Promise<number>((r) => { resolveT2Pid = r; });

      return runLifecycleSteps(
        tx1,
        input('demote', a, b, { expectedRole: 'super_admin' }),
        {
          // Hold the advisory lock and both row locks while B's attempt
          // on A is started and proven blocked.
          afterLock: async () => {
            race.t2 = sql2.begin(async (tx2) => {
              const [{ pid: t2Pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
              resolveT2Pid(t2Pid);
              return runLifecycleSteps(
                tx2,
                input('demote', b, a, { expectedRole: 'super_admin' }),
              );
            });
            await waitForBlock(t1Pid, await t2PidPromise);
          },
        },
      );
    });

    const t2Result = await race.t2;

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

    const race: { t2?: Promise<unknown> } = {};

    const t1Result = await sql1.begin(async (tx1) => {
      const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

      let resolveT2Pid!: (pid: number) => void;
      const t2PidPromise = new Promise<number>((r) => { resolveT2Pid = r; });

      return runLifecycleSteps(
        tx1,
        input('deactivate', actor, x, { expectedRole: 'super_admin' }),
        {
          ...scope,
          afterLock: async () => {
            race.t2 = sql2.begin(async (tx2) => {
              const [{ pid: t2Pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
              resolveT2Pid(t2Pid);
              return runLifecycleSteps(
                tx2,
                input('deactivate', actor, y, { expectedRole: 'super_admin' }),
                scope,
              );
            });
            await waitForBlock(t1Pid, await t2PidPromise);
          },
        },
      );
    });

    const t2Result = await race.t2;

    expect(t1Result).toMatchObject({ ok: true });
    expect(t2Result).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect((await readAccount(x.id)).disabledAt).toBeInstanceOf(Date);
    // The invariant held: one of the two is still an enabled super admin.
    expect(await readAccount(y.id)).toMatchObject({ role: 'super_admin', disabledAt: null });
  });
});
