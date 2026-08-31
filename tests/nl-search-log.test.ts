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

import { logNlSearch, type NlSearchLogEntry } from '@/db/queries/nl/log';

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
