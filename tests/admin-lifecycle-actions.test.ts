/**
 * The account lifecycle Server Actions (AFLDB-ISSUE-155 Phase B §26.15).
 *
 * The mocked-handle style of tests/admin-access-actions.test.ts: the auth
 * pool and the transaction are fake tagged templates that record every
 * statement in order, so what is asserted is which statements the action
 * issues, on which handle, and in what sequence — the shape of the
 * transaction, not a paraphrase of it. The database half (that PostgreSQL
 * really serialises two of these, and really rolls the UPDATE back when
 * the audit INSERT fails) is tests/integration/admin-lifecycle.test.ts.
 * The two files are meant to be read together; neither is sufficient
 * alone.
 *
 * Deliberately not asserted here: that a contributor or a plain admin is
 * turned away. That is `requireSuperAdmin`'s redirect, exercised against
 * the real guard in tests/auth.test.ts and in the browser pass; what this
 * file proves is that every action calls it -- and, since AFLDB-ISSUE-158,
 * asserts `people.admins.lifecycle` beside it -- and that nothing runs when
 * the guard does not return.
 */
import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revokeSession } from '@/app/admin/admins/actions';
import {
  deactivateAccount,
  demoteSuperAdmin,
  promoteAdmin,
  reactivateAccount,
} from '@/app/admin/admins/lifecycle-actions';
import { audit, auditInTransaction, requireCapability, requireSuperAdmin } from '@/lib/auth/session';

type Statement = { sql: string; values: unknown[]; on: 'pool' | 'tx' };

const ACTOR = { id: 1, email: 'super@example.test', role: 'super_admin', canManageAdmins: false };

const state = vi.hoisted(() => ({
  statements: [] as { sql: string; values: unknown[]; on: 'pool' | 'tx' }[],
  /** The rows the `FOR UPDATE` re-read comes back with. */
  lockedRows: [] as unknown[],
  /** What the invariant count sees, when the mutation asks for it. */
  viableOthers: 5,
  /** The compare-and-set UPDATE's RETURNING rows. */
  updateRows: [{ id: 2 }] as unknown[],
  /** The session revoke's RETURNING rows. */
  revokedRows: [{ id: 11 }, { id: 12 }] as unknown[],
  /** The row revokeSession's ownership lookup finds. */
  sessionRow: [] as unknown[],
  lastTx: null as unknown,
  /** The signed-in admin the guards return. */
  viewer: { id: 1, email: 'super@example.test', role: 'super_admin', canManageAdmins: false },
  guardThrows: false,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/db/authClient', () => {
  const run = (on: 'pool' | 'tx') =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ? ');
      // Nested fragments (`NULL`, `now()`, `disabled_at IS NULL`, the
      // optional count scope) are interpolated, never executed, so they
      // are not statements and must not appear in the order assertions.
      if (/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql)) {
        state.statements.push({ sql, values, on });
      }
      if (/pg_advisory_xact_lock/.test(sql)) return Promise.resolve([]);
      if (/FOR UPDATE/.test(sql)) return Promise.resolve(state.lockedRows);
      if (/count\(\*\)/.test(sql)) return Promise.resolve([{ count: state.viableOthers }]);
      if (/UPDATE\s+auth_users/.test(sql)) return Promise.resolve(state.updateRows);
      if (/UPDATE\s+auth_sessions/.test(sql)) return Promise.resolve(state.revokedRows);
      if (/FROM\s+auth_sessions/.test(sql)) return Promise.resolve(state.sessionRow);
      return Promise.resolve([]);
    };

  const authSql = Object.assign(run('pool'), {
    begin: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = run('tx');
      state.lastTx = tx;
      return cb(tx);
    }),
  });

  return { authSql };
});

vi.mock('@/lib/auth/session', () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (state.guardThrows) throw new Error('NEXT_REDIRECT');
    return state.viewer;
  }),
  // revokeSession's door (people.admins.read) and the lifecycle actions'
  // second assertion (people.admins.lifecycle), AFLDB-ISSUE-158.
  requireCapability: vi.fn(async () => {
    if (state.guardThrows) throw new Error('NEXT_REDIRECT');
    return state.viewer;
  }),
  // The real implementation; the module is mocked wholesale, and this is
  // the rule revokeSession's delegated-manager limb consults.
  hasAdminManagementAccess: (admin: { role: string; canManageAdmins: boolean }) =>
    admin.role === 'super_admin' || admin.canManageAdmins,
  audit: vi.fn(async () => undefined),
  auditInTransaction: vi.fn(async () => undefined),
}));

/** An account as the `FOR UPDATE` re-read returns it. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 2,
    email: 'target@example.test',
    role: 'admin',
    canManageAdmins: false,
    disabledAt: null,
    hasPassword: true,
    hasTotp: true,
    ...over,
  };
}

function lifecycleForm(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('userId', '2');
  data.set('expectedRole', 'admin');
  data.set('expectedActive', '1');
  for (const [key, value] of Object.entries(over)) data.set(key, value);
  return data;
}

const on = (predicate: RegExp): Statement | undefined =>
  state.statements.find((s) => predicate.test(s.sql));

beforeEach(() => {
  state.statements.length = 0;
  state.lockedRows = [ACTOR_ROW(), row()];
  state.viableOthers = 5;
  state.updateRows = [{ id: 2 }];
  state.revokedRows = [{ id: 11 }, { id: 12 }];
  state.sessionRow = [];
  state.lastTx = null;
  state.viewer = { ...ACTOR };
  state.guardThrows = false;
  vi.clearAllMocks();
});

function ACTOR_ROW(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'super@example.test',
    role: 'super_admin',
    canManageAdmins: false,
    disabledAt: null,
    hasPassword: true,
    hasTotp: true,
    ...over,
  };
}

describe('every lifecycle action is behind requireSuperAdmin', () => {
  const actions = [
    ['promote', promoteAdmin],
    ['demote', demoteSuperAdmin],
    ['deactivate', deactivateAccount],
    ['reactivate', reactivateAccount],
  ] as const;

  it.each(actions)('%s calls the guard', async (_name, action) => {
    await action({}, lifecycleForm({ expectedRole: 'admin' }));
    expect(requireSuperAdmin).toHaveBeenCalled();
  });

  it.each(actions)('%s asserts people.admins.lifecycle beside the role guard, not instead of it', async (_name, action) => {
    // ISSUE-156 §11 P2: the explicit super-admin boundary stays, and the
    // capability is enforced alongside so the table's entry is real.
    await action({}, lifecycleForm({ expectedRole: 'admin' }));
    expect(requireSuperAdmin).toHaveBeenCalled();
    expect(requireCapability).toHaveBeenCalledWith('people.admins.lifecycle');
  });

  it.each(actions)('%s issues no statement when the guard does not return', async (_n, action) => {
    state.guardThrows = true;
    await expect(action({}, lifecycleForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(state.statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('promotion runs one transaction in the approved order', () => {
  it('locks, re-reads, compares-and-sets, revokes and audits — all on the transaction', async () => {
    const result = await promoteAdmin({}, lifecycleForm());

    expect(result.error).toBeUndefined();
    expect(result.message).toContain('super admin');

    // Nothing on the pool: a lifecycle mutation and its required audit
    // row have one atomic outcome (§26.12).
    expect(state.statements.every((s) => s.on === 'tx')).toBe(true);

    const order = state.statements.map((s) => s.sql.replace(/\s+/g, ' ').trim().slice(0, 40));
    expect(order[0]).toContain('pg_advisory_xact_lock');
    expect(order[1]).toContain('SELECT id, email, role');
    expect(state.statements[1].sql).toContain('FOR UPDATE');
    expect(order[2]).toContain('UPDATE auth_users');
    expect(order[3]).toContain('UPDATE auth_sessions');
    expect(order).toHaveLength(4);

    // The audit row goes on the handle the transaction callback was given.
    expect(auditInTransaction).toHaveBeenCalledWith(
      state.lastTx, 'admin.promoted', expect.any(Object),
      { userId: 1, label: 'super@example.test' },
    );
    expect(audit).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/admins');
  });

  it('never asks the invariant count for a promotion', async () => {
    await promoteAdmin({}, lifecycleForm());
    expect(on(/count\(\*\)/)).toBeUndefined();
  });

  it('repeats the observed role and status in the UPDATE, and revokes the target\'s sessions', async () => {
    await promoteAdmin({}, lifecycleForm());

    const update = on(/UPDATE\s+auth_users/)!;
    expect(update.sql).toMatch(/AND role = /);
    expect(update.sql).toMatch(/disabled_at IS NULL/);
    expect(update.values).toContain('super_admin');

    const revoke = on(/UPDATE\s+auth_sessions/)!;
    expect(revoke.sql).toMatch(/revoked_at = now\(\)/);
    expect(revoke.values).toContain(2);
  });

  it('records before, after, the expected state and the revoked session count', async () => {
    await promoteAdmin({}, lifecycleForm());

    const [, , detail] = vi.mocked(auditInTransaction).mock.calls[0];
    expect(detail).toMatchObject({
      targetUserId: 2,
      targetEmail: 'target@example.test',
      before: { role: 'admin', active: true, canManageAdmins: false },
      after: { role: 'super_admin', active: true, canManageAdmins: false },
      expected: { role: 'admin', active: true },
      revokedSessions: 2,
    });
    // No hash, secret or token is ever part of the detail object.
    expect(JSON.stringify(detail)).not.toMatch(/password|totp|token/i);
  });
});

describe('demotion', () => {
  const demoteForm = () => lifecycleForm({ expectedRole: 'super_admin' });

  beforeEach(() => {
    state.lockedRows = [ACTOR_ROW(), row({ role: 'super_admin', canManageAdmins: true })];
  });

  it('counts the viable super admins inside the transaction, not before it', async () => {
    await demoteSuperAdmin({}, demoteForm());

    const count = on(/count\(\*\)/)!;
    expect(count.on).toBe('tx');
    expect(count.sql).toMatch(/password_hash IS NOT NULL/);
    expect(count.sql).toMatch(/totp_secret IS NOT NULL/);
    expect(count.sql).toMatch(/disabled_at IS NULL/);
    expect(count.sql).toMatch(/id <> /);
    // Ordered after the lock and the row read, so the answer cannot be
    // overtaken by another demotion (§26.7).
    expect(state.statements.indexOf(count)).toBe(2);
  });

  it('clears can_manage_admins on the way down', async () => {
    await demoteSuperAdmin({}, demoteForm());
    expect(on(/UPDATE\s+auth_users/)!.values).toEqual(
      expect.arrayContaining(['admin', false]),
    );
    const [, , detail] = vi.mocked(auditInTransaction).mock.calls[0];
    expect(detail).toMatchObject({
      before: { canManageAdmins: true },
      after: { role: 'admin', canManageAdmins: false },
    });
  });

  it('refuses the last viable super admin, writes no mutation and audits the refusal', async () => {
    state.viableOthers = 0;

    const result = await demoteSuperAdmin({}, demoteForm());

    expect(result.code).toBe('last_super_admin');
    expect(result.error).toContain('target@example.test');
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
    expect(on(/UPDATE\s+auth_sessions/)).toBeUndefined();
    expect(auditInTransaction).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      'admin.lifecycle_refused',
      { action: 'demote', targetUserId: 2, targetEmail: 'target@example.test', code: 'last_super_admin' },
      { userId: 1, label: 'super@example.test' },
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses your own account before it counts anything', async () => {
    state.lockedRows = [ACTOR_ROW({ id: 1 })];
    const form = lifecycleForm({ userId: '1', expectedRole: 'super_admin' });

    const result = await demoteSuperAdmin({}, form);

    expect(result.code).toBe('self');
    expect(on(/count\(\*\)/)).toBeUndefined();
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
  });

  it('refuses when the actor is no longer an enabled super admin', async () => {
    // The page was rendered by a super admin; another one demoted them
    // while this form sat open (§26.6).
    state.lockedRows = [ACTOR_ROW({ role: 'admin' }), row({ role: 'super_admin' })];

    const result = await demoteSuperAdmin({}, demoteForm());

    expect(result.code).toBe('forbidden');
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(
      'admin.lifecycle_refused', expect.objectContaining({ code: 'forbidden' }), expect.any(Object),
    );
  });
});

describe('stale and invalid requests', () => {
  it('answers a duplicate promotion `stale`, never a silent success', async () => {
    // The page rendered "Promote" for an admin; the account is already a
    // super admin because another tab did it first.
    state.lockedRows = [ACTOR_ROW(), row({ role: 'super_admin' })];

    const result = await promoteAdmin({}, lifecycleForm());

    expect(result.code).toBe('stale');
    expect(result.message).toBeUndefined();
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(
      'admin.lifecycle_refused', expect.objectContaining({ code: 'stale' }), expect.any(Object),
    );
  });

  it('answers a duplicate deactivation `stale` too', async () => {
    state.lockedRows = [ACTOR_ROW(), row({ disabledAt: new Date('2026-09-01') })];

    const result = await deactivateAccount({}, lifecycleForm({
      reason: 'left the project', confirmEmail: 'target@example.test',
    }));

    expect(result.code).toBe('stale');
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
  });

  it('reports an unknown account as not found, and does not audit it', async () => {
    state.lockedRows = [ACTOR_ROW()];

    const result = await promoteAdmin({}, lifecycleForm({ userId: '404' }));

    expect(result.code).toBe('not_found');
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects a malformed request before opening a transaction', async () => {
    for (const form of [
      lifecycleForm({ userId: 'seven' }),
      lifecycleForm({ expectedRole: 'owner' }),
      lifecycleForm({ expectedActive: 'yes' }),
    ]) {
      state.statements.length = 0;
      const result = await promoteAdmin({}, form);
      expect(result.code).toBe('invalid');
      expect(state.statements).toEqual([]);
    }
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('deactivation asks for a reason and the typed email', () => {
  const activeSuper = () => [ACTOR_ROW(), row({ role: 'super_admin' })];

  it('refuses a missing reason before opening a transaction', async () => {
    const result = await deactivateAccount({}, lifecycleForm({
      confirmEmail: 'target@example.test', reason: '  ',
    }));

    expect(result.code).toBe('invalid');
    expect(state.statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses a mismatched typed email against the row read under the lock', async () => {
    const result = await deactivateAccount({}, lifecycleForm({
      reason: 'left the project', confirmEmail: 'target@example.tests',
    }));

    expect(result.code).toBe('invalid');
    expect(result.error).toMatch(/Type the account's email/);
    // It got as far as the locked re-read — that is the row it compares
    // against — but wrote nothing.
    expect(on(/FOR UPDATE/)).toBeDefined();
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
    expect(audit).not.toHaveBeenCalled();
  });

  it('accepts the typed email case-insensitively and stores the reason in the audit', async () => {
    const result = await deactivateAccount({}, lifecycleForm({
      reason: '  left the project  ', confirmEmail: 'TARGET@Example.test',
    }));

    expect(result.error).toBeUndefined();
    const [, action, detail] = vi.mocked(auditInTransaction).mock.calls[0];
    expect(action).toBe('admin.deactivated');
    expect(detail).toMatchObject({ reason: 'left the project' });
    // The timestamp is the database's own clock, written in the statement
    // rather than bound into it, and the guard still names the status the
    // page rendered.
    const update = on(/UPDATE\s+auth_users/)!;
    expect(update.sql).toMatch(/disabled_at\s+= now\(\)/);
    expect(update.sql).toMatch(/AND disabled_at IS NULL/);
  });

  it('applies the invariant to a super admin target', async () => {
    state.lockedRows = activeSuper();
    state.viableOthers = 0;

    const result = await deactivateAccount({}, lifecycleForm({
      expectedRole: 'super_admin', reason: 'compromised', confirmEmail: 'target@example.test',
    }));

    expect(result.code).toBe('last_super_admin');
    expect(on(/UPDATE\s+auth_users/)).toBeUndefined();
  });
});

describe('reactivation', () => {
  it('clears the deactivation and revives no session', async () => {
    state.lockedRows = [ACTOR_ROW(), row({ disabledAt: new Date('2026-09-01') })];
    state.revokedRows = [];

    const result = await reactivateAccount({}, lifecycleForm({ expectedActive: '0' }));

    expect(result.error).toBeUndefined();
    const update = on(/UPDATE\s+auth_users/)!;
    expect(update.sql).toMatch(/disabled_at IS NOT NULL/); // the compare-and-set guard
    // The defensive revoke still runs: reactivation must not be the thing
    // that lets a pre-deactivation session back in.
    expect(on(/UPDATE\s+auth_sessions/)).toBeDefined();
    const [, action] = vi.mocked(auditInTransaction).mock.calls[0];
    expect(action).toBe('admin.reactivated');
  });
});

/**
 * The Phase B session-revocation tightening (§26.3): until now any admin
 * could sign any other account out, a super admin's session included.
 */
describe('revokeSession ownership rule', () => {
  const sessionOf = (userId: number, role: string, email = 'target@example.test') => [
    { userId, role, email },
  ];

  it('refuses a plain admin another account\'s session, and records the refusal', async () => {
    state.viewer = { id: 5, email: 'admin@example.test', role: 'admin', canManageAdmins: false };
    state.sessionRow = sessionOf(2, 'super_admin');

    const data = new FormData();
    data.set('sessionId', '11');
    const result = await revokeSession({}, data);

    expect(result.error).toMatch(/Only a super admin/);
    expect(on(/UPDATE\s+auth_sessions/)).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(
      'session.revoke_refused',
      expect.objectContaining({ sessionId: 11, targetUserId: 2, targetRole: 'super_admin' }),
      { userId: 5, label: 'admin@example.test' },
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets any admin end their own session', async () => {
    state.viewer = { id: 5, email: 'admin@example.test', role: 'admin', canManageAdmins: false };
    state.sessionRow = sessionOf(5, 'admin', 'admin@example.test');
    state.revokedRows = [{ userId: 5, email: 'admin@example.test' }];

    const data = new FormData();
    data.set('sessionId', '11');
    const result = await revokeSession({}, data);

    expect(result.message).toContain('admin@example.test');
    expect(on(/UPDATE\s+auth_sessions/)).toBeDefined();
    expect(audit).toHaveBeenCalledWith('session.revoked', expect.any(Object), expect.any(Object));
  });

  it('lets a super admin end anyone\'s session', async () => {
    state.sessionRow = sessionOf(2, 'admin');
    state.revokedRows = [{ userId: 2, email: 'target@example.test' }];

    const data = new FormData();
    data.set('sessionId', '11');
    const result = await revokeSession({}, data);

    expect(result.message).toContain('target@example.test');
    expect(on(/UPDATE\s+auth_sessions/)).toBeDefined();
  });

  it('lets a delegated manager end a contributor\'s session and no one better', async () => {
    state.viewer = { id: 5, email: 'manager@example.test', role: 'admin', canManageAdmins: true };
    state.sessionRow = sessionOf(9, 'contributor', 'up@example.test');
    state.revokedRows = [{ userId: 9, email: 'up@example.test' }];

    const data = new FormData();
    data.set('sessionId', '11');
    expect((await revokeSession({}, data)).message).toContain('up@example.test');

    state.statements.length = 0;
    state.sessionRow = sessionOf(2, 'admin');
    const refused = await revokeSession({}, data);
    expect(refused.error).toMatch(/Only a super admin/);
    expect(on(/UPDATE\s+auth_sessions/)).toBeUndefined();
  });

  it('reads the target\'s role from the database, never from the form', async () => {
    state.sessionRow = sessionOf(2, 'admin');
    state.revokedRows = [{ userId: 2, email: 'target@example.test' }];

    const data = new FormData();
    data.set('sessionId', '11');
    data.set('role', 'contributor');
    await revokeSession({}, data);

    const lookup = on(/FROM\s+auth_sessions/)!;
    expect(lookup.sql).toMatch(/JOIN auth_users/);
    expect(lookup.values).toEqual([11]);
  });
});
