/**
 * logNlSearch scheduling boundary (AFLDB-ISSUE-110).
 *
 * answerNlQuestion is legitimately callable outside a Next.js request
 * scope (vitest integration suites, server-side scripts), where Next 16's
 * after() throws synchronously. logNlSearch must schedule the telemetry
 * write through after() when a request scope exists, fall back to a
 * detached write otherwise, and in neither path let a telemetry failure
 * reach the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const afterMock = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ after: afterMock }));

const insertCalls = vi.hoisted(() => [] as unknown[][]);
const insertFailure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('@/db/authClient', () => {
  const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    if (insertFailure.error) return Promise.reject(insertFailure.error);
    insertCalls.push(values);
    return Promise.resolve([]);
  };
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return { authSql: sql };
});

import type postgres from 'postgres';

import { clearNlSearchTelemetry } from '@/db/queries/nl-search-telemetry-clear';
import { logNlSearch, type NlSearchLogEntry } from '@/db/queries/nl/log';

type TransactionSql = postgres.TransactionSql;

/** The exact synchronous error the installed Next 16 throws when no request scope exists (dist/server/after/after.js): message prefix plus non-enumerable __NEXT_ERROR_CODE E468. */
const OUTSIDE_REQUEST_SCOPE = Object.defineProperty(
  new Error('`after` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context'),
  '__NEXT_ERROR_CODE',
  { value: 'E468', enumerable: false, configurable: true },
);

function entry(): NlSearchLogEntry {
  return { question: 'most goals in a game', outcome: 'answered', durationMs: 12 };
}

/** Settles the detached write's already-queued microtasks/macrotasks. */
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

beforeEach(() => {
  afterMock.mockReset();
  insertCalls.length = 0;
  insertFailure.error = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logNlSearch request-scope boundary', () => {
  it('defers the write through after() inside a request scope', async () => {
    let scheduled: (() => Promise<void>) | null = null;
    afterMock.mockImplementation((cb: () => Promise<void>) => { scheduled = cb; });

    logNlSearch(entry());

    expect(afterMock).toHaveBeenCalledTimes(1);
    // Deferred, not inline: nothing is written until Next runs the callback.
    expect(insertCalls).toHaveLength(0);
    await scheduled!();
    expect(insertCalls).toHaveLength(1);
  });

  it('does not throw outside a request scope and still writes the row', async () => {
    afterMock.mockImplementation(() => { throw OUTSIDE_REQUEST_SCOPE; });

    expect(() => logNlSearch(entry())).not.toThrow();
    await flush();
    expect(insertCalls).toHaveLength(1);
  });

  it('keeps a genuine write failure on the fallback path out of the caller', async () => {
    afterMock.mockImplementation(() => { throw OUTSIDE_REQUEST_SCOPE; });
    insertFailure.error = new Error('connection refused');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logNlSearch(entry())).not.toThrow();
    await flush();
    expect(insertCalls).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith('failed to write nl_search_log row', insertFailure.error);
  });

  it('recognises the no-request-scope failure by its stable error code even if the message changes', async () => {
    const renamed = Object.defineProperty(
      new Error('some future rewording of the same condition'),
      '__NEXT_ERROR_CODE',
      { value: 'E468', enumerable: false, configurable: true },
    );
    afterMock.mockImplementation(() => { throw renamed; });

    expect(() => logNlSearch(entry())).not.toThrow();
    await flush();
    expect(insertCalls).toHaveLength(1);
  });

  it('does not classify an unrelated synchronous after() exception as non-request execution', async () => {
    // A scheduler invariant breaking inside a real request must not be
    // misread as a legitimate non-request caller: no detached write, no
    // throw into the answer -- reported and swallowed.
    const schedulerFailure = new Error('Invariant: afterContext was closed before the response finished');
    afterMock.mockImplementation(() => { throw schedulerFailure; });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logNlSearch(entry())).not.toThrow();
    await flush();
    expect(insertCalls).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      'unexpected synchronous after() failure scheduling nl_search_log write',
      schedulerFailure,
    );
  });
});

/**
 * Telemetry-clear count boundary (AFLDB-ISSUE-119 risk R3).
 *
 * clearNlSearchTelemetry() is the query layer over migration 081's
 * public.nl_search_telemetry_clear(). Its five returned counts are
 * bigint, and postgres.js hands int8 back as a string, so the whole job
 * of these tests is proving no string reaches the caller: those counts
 * become the audit event, and a concatenated or silently-zeroed total is
 * a false audit record. The integration suite proves the function; this
 * proves the conversion, which the integration suite deliberately
 * sidesteps by casting ::int in its own query.
 */
describe('clearNlSearchTelemetry count boundary', () => {
  /** Stands in for a postgres.js transaction handle: one tagged-template call, one result set. */
  function fakeTx(rows: unknown[]): { tx: TransactionSql; calls: number } {
    const state = { calls: 0 };
    const tx = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      state.calls += 1;
      return Promise.resolve(rows);
    }) as unknown as TransactionSql;
    return { tx, get calls() { return state.calls; } };
  }

  const stringRow = {
    deletedLogRows: '412',
    retainedLogRows: '38',
    retainedReviewRows: '7',
    retainedFeedbackRows: '11',
    detachedAppHealthLinks: '3',
  };

  it('converts the driver\'s int8 strings to numbers', async () => {
    const { tx } = fakeTx([stringRow]);

    const counts = await clearNlSearchTelemetry(tx);

    expect(counts).toEqual({
      deletedLogRows: 412,
      retainedLogRows: 38,
      retainedReviewRows: 7,
      retainedFeedbackRows: 11,
      detachedAppHealthLinks: 3,
    });
    // The bug this exists to prevent: "412" + "38" === "41238".
    expect(counts.deletedLogRows + counts.retainedLogRows).toBe(450);
    for (const value of Object.values(counts)) expect(typeof value).toBe('number');
  });

  it('accepts zero counts and a bigint-typed driver result', async () => {
    const { tx } = fakeTx([{
      deletedLogRows: '0',
      retainedLogRows: 0,
      retainedReviewRows: 0n,
      retainedFeedbackRows: '0',
      detachedAppHealthLinks: '0',
    }]);

    // A clear that deleted nothing is a legitimate outcome and must be
    // auditable as 0, not rejected alongside the unreadable values below.
    await expect(clearNlSearchTelemetry(tx)).resolves.toEqual({
      deletedLogRows: 0,
      retainedLogRows: 0,
      retainedReviewRows: 0,
      retainedFeedbackRows: 0,
      detachedAppHealthLinks: 0,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['non-numeric text', 'many'],
    ['negative', '-1'],
    ['fractional', '1.5'],
  ])('refuses to audit a count it cannot read: %s', async (_label, value) => {
    const { tx } = fakeTx([{ ...stringRow, deletedLogRows: value }]);

    // Number(null) and Number('') are both 0, so coercion here would
    // report a real deletion as "deleted 0 rows" in the audit trail.
    await expect(clearNlSearchTelemetry(tx)).rejects.toThrow(/deletedLogRows/);
  });

  it('refuses an empty result set rather than reporting no deletion', async () => {
    const { tx } = fakeTx([]);

    await expect(clearNlSearchTelemetry(tx)).rejects.toThrow(/expected exactly 1/);
  });

  it('refuses a multi-row result set rather than reading the first row', async () => {
    const { tx } = fakeTx([stringRow, stringRow]);

    await expect(clearNlSearchTelemetry(tx)).rejects.toThrow(/expected exactly 1/);
  });

  it('issues exactly one statement on the transaction it is given', async () => {
    const handle = fakeTx([stringRow]);

    await clearNlSearchTelemetry(handle.tx);

    // No second connection, no pool fallback: the caller's transaction is
    // load-bearing for both the lock cutoff and the atomic clear+audit.
    expect(handle.calls).toBe(1);
  });
});
