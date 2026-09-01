import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';

/**
 * DB-free Server Action tests for clearTelemetry (AFLDB-ISSUE-119 §6, §8,
 * §9, §11). authSql.begin() is faked with a sentinel transaction handle so
 * these tests can assert clearNlSearchTelemetry() and auditInTransaction()
 * ride the *same* handle without a real PostgreSQL connection. The
 * PostgreSQL-level contract -- the retained closure, the locks, the
 * restricted role -- is proven separately by
 * tests/integration/nl-search-telemetry-clear.test.ts; requireSuperAdmin()'s
 * own role/session logic is proven by tests/auth.test.ts. What this file
 * proves is that the action wires the approved contract together correctly:
 * guard first, phrase second, one transaction, the approved count payload
 * only, and revalidation gated on committed success.
 */

const FAKE_TX = Symbol('tx') as unknown;

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  auditInTransaction: vi.fn(),
  audit: vi.fn(),
  clearNlSearchTelemetry: vi.fn(),
  saveNlSearchReview: vi.fn(),
  begin: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/db/authClient', () => ({
  authSql: { begin: mocks.begin },
}));

vi.mock('@/db/queries/nl-search-log', () => ({
  saveNlSearchReview: mocks.saveNlSearchReview,
}));

vi.mock('@/db/queries/nl-search-telemetry-clear', () => ({
  clearNlSearchTelemetry: mocks.clearNlSearchTelemetry,
}));

vi.mock('@/lib/auth/session', () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
  auditInTransaction: mocks.auditInTransaction,
  audit: mocks.audit,
}));

import { clearTelemetry, NL_TELEMETRY_CLEAR_PHRASE } from '@/app/admin/nl-search/actions';

const COUNTS = {
  deletedLogRows: 12,
  retainedLogRows: 340,
  retainedReviewRows: 8,
  retainedFeedbackRows: 5,
  detachedAppHealthLinks: 2,
};

const ADMIN = { id: 9, email: 'super@example.test' };

function formWith(confirmation?: string): FormData {
  const fd = new FormData();
  if (confirmation !== undefined) fd.set('confirmation', confirmation);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdmin.mockResolvedValue(ADMIN);
  // Mirrors postgres.js: the callback runs on the transaction handle, and
  // whatever it returns (or throws) is what begin() resolves (or rejects)
  // with -- no swallowing, so a thrown auditInTransaction/clear failure
  // propagates out of clearTelemetry exactly as it would against a real
  // rolled-back transaction.
  mocks.begin.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(FAKE_TX));
  mocks.clearNlSearchTelemetry.mockResolvedValue(COUNTS);
  mocks.auditInTransaction.mockResolvedValue(undefined);
});

describe('clearTelemetry', () => {
  it('succeeds for a Super Admin with the exact confirmation phrase', async () => {
    const result = await clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE));

    expect(result.error).toBeUndefined();
    expect(result.counts).toEqual(COUNTS);
    expect(mocks.requireSuperAdmin).toHaveBeenCalledOnce();
  });

  it('stops at the guard before any mutation when requireSuperAdmin rejects', async () => {
    // requireSuperAdmin() redirects (throws) for an unauthenticated caller,
    // a plain admin and a contributor alike -- all three collapse to the
    // same "the guard rejected" case from this action's point of view; the
    // guard's own role-by-role logic is exercised in tests/auth.test.ts.
    mocks.requireSuperAdmin.mockRejectedValue(new Error('redirect: /admin'));

    await expect(clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE))).rejects.toThrow('redirect: /admin');

    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.clearNlSearchTelemetry).not.toHaveBeenCalled();
    expect(mocks.auditInTransaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('performs no transaction, clear or audit when the confirmation is missing', async () => {
    const result = await clearTelemetry({}, formWith());

    expect(result.error).toBeTruthy();
    expect(result.counts).toBeUndefined();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.clearNlSearchTelemetry).not.toHaveBeenCalled();
    expect(mocks.auditInTransaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('performs no transaction, clear or audit when the confirmation is wrong', async () => {
    const result = await clearTelemetry({}, formWith('clear search telemetry'));

    expect(result.error).toBeTruthy();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.clearNlSearchTelemetry).not.toHaveBeenCalled();
    expect(mocks.auditInTransaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('still requires requireSuperAdmin() even when the confirmation is absent', async () => {
    // The guard must run before confirmation parsing (§6), not merely
    // before the transaction -- so it fires on every call, not only the
    // ones that reach a valid phrase.
    await clearTelemetry({}, formWith());
    expect(mocks.requireSuperAdmin).toHaveBeenCalledOnce();
  });

  it('runs clearNlSearchTelemetry and auditInTransaction on the same transaction handle', async () => {
    await clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE));

    expect(mocks.clearNlSearchTelemetry).toHaveBeenCalledWith(FAKE_TX);
    expect(mocks.auditInTransaction).toHaveBeenCalledWith(
      FAKE_TX,
      'nl_search.telemetry_cleared',
      COUNTS,
      { userId: ADMIN.id, label: ADMIN.email },
    );
  });

  it('audits only the five approved counts and nothing else', async () => {
    await clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE));

    const [, , detail] = mocks.auditInTransaction.mock.calls[0];
    expect(Object.keys(detail).sort()).toEqual([
      'deletedLogRows', 'detachedAppHealthLinks', 'retainedFeedbackRows',
      'retainedLogRows', 'retainedReviewRows',
    ]);
  });

  it('propagates a clear failure and performs no audit, revalidation or success result', async () => {
    mocks.clearNlSearchTelemetry.mockRejectedValue(new Error('function unavailable'));

    await expect(clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE))).rejects.toThrow('function unavailable');

    expect(mocks.auditInTransaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates an audit failure and prevents successful completion', async () => {
    mocks.auditInTransaction.mockRejectedValue(new Error('audit unavailable'));

    await expect(clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE))).rejects.toThrow('audit unavailable');

    // The clear itself was invoked (it runs before the audit inside the
    // transaction) but nothing downstream of the failed audit did.
    expect(mocks.clearNlSearchTelemetry).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns the deleted/retained counts as returned by clearNlSearchTelemetry', async () => {
    const result = await clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE));
    expect(result.counts).toEqual(COUNTS);
  });

  it('revalidates the two required admin paths on committed success', async () => {
    await clearTelemetry({}, formWith(NL_TELEMETRY_CLEAR_PHRASE));

    expect(revalidatePath).toHaveBeenCalledWith('/admin/nl-search', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/app-health');
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });
});
