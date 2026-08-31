/**
 * The access-key lifecycle (AFLDB-ISSUE-117).
 *
 * A code is deletable once it is RETIRED -- revoked, or spent. A spent
 * code goes directly, with no ceremonial revoke first; a code that could
 * still be redeemed must be revoked before it can be destroyed.
 *
 * Deletion is the only control on /admin/access that destroys a row, so
 * what is asserted here is not that the happy path works but that the
 * refusals do, and that they live on the server. The database half --
 * that the predicate really does match a revoked or spent row and really
 * does not match a still-redeemable one when PostgreSQL evaluates it,
 * and that afldb_auth holds the DELETE at all -- is asserted against a
 * real cluster in tests/integration/access-codes.test.ts and
 * tests/integration/privileges.test.ts. These files are meant to be read
 * together; neither is sufficient alone.
 */
import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteAccessCode, revokeAccessCode } from '@/app/admin/access/actions';
import { authSql } from '@/db/authClient';
import { audit, requireAdmin } from '@/lib/auth/session';

const state = vi.hoisted(() => ({
  /** Every statement either the pool or the transaction ran, in order. */
  statements: [] as { sql: string; values: unknown[]; on: 'pool' | 'tx' }[],
  /** What the next DELETE ... RETURNING should come back with. */
  deleteRows: [] as unknown[],
  /** What the next UPDATE ... RETURNING (revoke) should come back with. */
  updateRows: [] as unknown[],
  /** The handle handed to the transaction callback, to prove audit got it. */
  lastTx: null as unknown,
  /** Set to make requireAdmin throw, standing in for its redirect(). */
  adminThrows: false,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/db/authClient', () => {
  const run = (on: 'pool' | 'tx') =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // postgres.js interpolates the parameters; joining the literal
      // fragments on a placeholder reconstructs the statement text.
      const sql = strings.join(' ? ');
      state.statements.push({ sql, values, on });
      if (/DELETE\s+FROM\s+beta_access_codes/.test(sql)) return Promise.resolve(state.deleteRows);
      if (/UPDATE\s+beta_access_codes/.test(sql)) return Promise.resolve(state.updateRows);
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
  requireAdmin: vi.fn(async () => {
    if (state.adminThrows) throw new Error('NEXT_REDIRECT');
    return { id: 7, email: 'admin@example.com' };
  }),
  audit: vi.fn(async () => undefined),
}));

const REVOKED_AT = new Date('2026-08-01T02:03:04.000Z');

function form(id: unknown): FormData {
  const data = new FormData();
  data.set('id', String(id));
  return data;
}

/** The row a DELETE against a revoked code comes back with. */
function deletedRow() {
  return [{
    id: 42, label: 'footy forum wave 1',
    revokedAt: REVOKED_AT, useCount: 1, maxUses: 5,
  }];
}

/** A code deleted for being spent: never revoked, uses exhausted. */
function spentRow() {
  return [{
    id: 43, label: 'trade period wave 2',
    revokedAt: null, useCount: 5, maxUses: 5,
  }];
}

beforeEach(() => {
  state.statements.length = 0;
  state.deleteRows = [];
  state.updateRows = [];
  state.lastTx = null;
  state.adminThrows = false;
  vi.clearAllMocks();
});

describe('deleteAccessCode refuses a code that could still be redeemed', () => {
  it('will not delete an active unused code, because the statement will not match one', async () => {
    // The action cannot tell "still live" from "already gone" by itself
    // and does not try: it asks the database to delete a RETIRED row with
    // this id and believes the row count. So the predicate being in the
    // SQL is the assertion here, not an implementation detail behind it.
    state.deleteRows = [];

    const result = await deleteAccessCode({}, form(42));

    const del = state.statements.find((s) => /DELETE\s+FROM\s+beta_access_codes/.test(s.sql));
    expect(del, 'the action must issue the guarded DELETE').toBeDefined();
    // Both limbs, and both required: revoked OR spent, never neither.
    expect(del!.sql).toMatch(/revoked_at\s+IS\s+NOT\s+NULL/);
    expect(del!.sql).toMatch(/max_uses\s+IS\s+NOT\s+NULL\s+AND\s+use_count\s*>=\s*max_uses/);
    expect(result.error).toBeTruthy();
    expect(result.message).toBeUndefined();
  });

  it('does not audit or revalidate when nothing was deleted', async () => {
    // A refusal is not an event. Auditing one would fill the trail with
    // rows saying a code that still exists had been destroyed.
    state.deleteRows = [];

    await deleteAccessCode({}, form(42));

    expect(audit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('gives an unknown id the same answer as a still-redeemable one', async () => {
    // Both miss the WHERE clause, and the endpoint deliberately does not
    // say which: telling them apart would confirm which ids exist.
    state.deleteRows = [];
    const unknown = await deleteAccessCode({}, form(999999));

    state.statements.length = 0;
    state.deleteRows = [];
    const live = await deleteAccessCode({}, form(42));

    expect(unknown.error).toBe(live.error);
  });

  it('rejects a non-integer id before touching the database', async () => {
    const result = await deleteAccessCode({}, form('42; DROP TABLE beta_access_codes'));

    expect(result.error).toBe('Bad code id.');
    expect(authSql.begin).not.toHaveBeenCalled();
    expect(state.statements).toEqual([]);
  });

  it('requires an admin session before any statement runs', async () => {
    // requireAdmin re-checks the database row, so a forged or stale cookie
    // stops here. If it ever stopped being the first thing this action
    // did, this is the test that notices.
    state.adminThrows = true;
    state.deleteRows = deletedRow();

    await expect(deleteAccessCode({}, form(42))).rejects.toThrow('NEXT_REDIRECT');

    expect(authSql.begin).not.toHaveBeenCalled();
    expect(state.statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('deleteAccessCode removes a retired code with a durable record', () => {
  it('deletes the row and reports it', async () => {
    state.deleteRows = deletedRow();

    const result = await deleteAccessCode({}, form(42));

    expect(result.error).toBeUndefined();
    expect(result.message).toContain('footy forum wave 1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('writes access.code_deleted naming what was destroyed, and no secret', async () => {
    state.deleteRows = deletedRow();

    await deleteAccessCode({}, form(42));

    expect(audit).toHaveBeenCalledTimes(1);
    const [action, detail, actor] = vi.mocked(audit).mock.calls[0]!;
    expect(action).toBe('access.code_deleted');
    expect(detail).toEqual({
      codeId: 42,
      label: 'footy forum wave 1',
      reason: 'revoked',
      revokedAt: REVOKED_AT.toISOString(),
      useCount: 1,
      maxUses: 5,
    });
    // The acting admin, through the existing mechanism.
    expect(actor).toEqual({ userId: 7, label: 'admin@example.com' });
    // Only the sha256 of the code was ever stored, and it leaves with the
    // row; the trail must not have acquired anything code-shaped.
    expect(JSON.stringify(detail)).not.toMatch(/code_hash|afldb-/);
  });

  it('audits inside the deleting transaction, not after it', async () => {
    // This is the difference between "we try to log destructive actions"
    // and "the database cannot hold the deletion without the log". Moving
    // the audit back onto the pool still satisfies the assertion above and
    // silently drops that guarantee, so the handle itself is checked.
    state.deleteRows = deletedRow();

    await deleteAccessCode({}, form(42));

    const tx = vi.mocked(audit).mock.calls[0]![3];
    expect(tx, 'audit must be given the transaction handle').toBe(state.lastTx);
    expect(state.statements.every((s) => s.on === 'tx')).toBe(true);
  });

  it('deletes a SPENT code that was never revoked, with no revoke first', async () => {
    // The manual-validation finding: requiring a revoke here was ceremony.
    // The database already refuses a spent code, so the revoke changed
    // nothing a redeemer could observe.
    state.deleteRows = spentRow();

    const result = await deleteAccessCode({}, form(43));

    expect(result.error).toBeUndefined();
    expect(result.message).toContain('trade period wave 2');
    // No UPDATE was issued: deletion did not quietly revoke on the way past.
    expect(state.statements.some((s) => /UPDATE\s+beta_access_codes/.test(s.sql))).toBe(false);
  });

  it('records a spent deletion as spent, with a null revocation time', async () => {
    // The trail has to say WHICH rule allowed the row to go, or a reader
    // cannot tell a revoked disposal from a spent one after the fact.
    state.deleteRows = spentRow();

    await deleteAccessCode({}, form(43));

    const [, detail] = vi.mocked(audit).mock.calls[0]!;
    expect(detail).toEqual({
      codeId: 43,
      label: 'trade period wave 2',
      reason: 'spent',
      revokedAt: null,
      useCount: 5,
      maxUses: 5,
    });
  });

  it('revalidates /admin/access so the row leaves the list', async () => {
    state.deleteRows = deletedRow();

    await deleteAccessCode({}, form(42));

    expect(revalidatePath).toHaveBeenCalledWith('/admin/access');
  });
});

describe('revoking is unchanged by the delete path', () => {
  it('still only revokes a code that is not already revoked', async () => {
    state.updateRows = [{ label: 'footy forum wave 1' }];

    const result = await revokeAccessCode({}, form(42));

    const update = state.statements.find((s) => /UPDATE\s+beta_access_codes/.test(s.sql));
    expect(update!.sql).toMatch(/SET\s+revoked_at\s*=\s*now\(\)/);
    expect(update!.sql).toMatch(/revoked_at\s+IS\s+NULL/);
    // Still a one-shot statement on the pool: revoke was not quietly
    // dragged into the transactional shape that deletion needs.
    expect(update!.on).toBe('pool');
    expect(result.message).toContain('revoked');
    expect(audit).toHaveBeenCalledWith(
      'access.code_revoked',
      { codeId: 42, label: 'footy forum wave 1' },
      { userId: 7, label: 'admin@example.com' },
    );
  });

  it('reports a code that is already revoked or absent', async () => {
    state.updateRows = [];

    const result = await revokeAccessCode({}, form(42));

    expect(result.error).toBe('Already revoked or not found.');
    expect(audit).not.toHaveBeenCalled();
  });
});
