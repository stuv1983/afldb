/**
 * AFLDB-ISSUE-274 §19, §20. Orchestration for "start a settle behind a session that holds a row".
 *
 * Pure: no database, no driver. The integration suite supplies the operations (holder
 * session, independently connected settle, blocked-query observation, test-owned
 * termination); `tests/behind-holder.test.ts` drives the same code with fakes, DB-free.
 *
 * The guarantees, in one place:
 *   1. Every wait is bounded, including the first one (the holder taking its lock).
 *   2. A timeout is never swallowed. It becomes the failure, after the work is stopped.
 *   3. Releasing the holder does not prove the settle ended, so the holder and the settle are
 *      each awaited. Work that outlives its bound is stopped with the TEST-OWNED controls the
 *      caller supplies (they act only on the sessions this scenario created), and awaited again.
 *   4. The controls themselves are bounded (§20): observing the blocked statement, terminating a
 *      session, and closing the scenario's connections / confirming no backend remains each get
 *      `controlBoundMs`. A control that times out or throws is RECORDED, never ignored: it is
 *      reported in the failure, and a control that cannot confirm anything leaves the work
 *      unconfirmed. It never turns into a pass.
 *   5. Fixture cleanup runs only after both operations have ended AND the caller has confirmed
 *      no backend of this scenario remains. If that cannot be confirmed, cleanup is SKIPPED and
 *      `UnresolvedWorkError` is thrown: removing rows under a running settle is worse than
 *      leaving them for the suite's own pre-clean.
 *   6. The first failure is the one reported; a later cleanup problem never masks it.
 *
 * `createCleanupGate()` carries guarantee 5 beyond this function: once a scenario ended with
 * unresolved work, NO other fixture removal in the file (the scenario wrapper's `finally`, the
 * `afterAll` hooks) may run, and no further scenario may start.
 */

export type HolderHandle = {
  /** Resolves once the holder owns the row lock. Rejects if the holder ends first. */
  held: Promise<void>;
  /** Settles when the holder's transaction has ended, either way. */
  done: Promise<void>;
  /** Lets the parked holder do its work and commit. Idempotent. */
  release: () => void;
};

export type BehindHolderOps<R> = {
  /** Upper bound of every wait on the holder, the settle and the observation phase, ms. */
  boundMs: number;
  /** Upper bound of every test-owned control action (observe-free: terminate, close/confirm), ms. Default `boundMs`. */
  controlBoundMs?: number;
  /** Interval between observations of the blocked statement, milliseconds. */
  pollMs: number;
  startHolder: () => HolderHandle;
  /** Starts the settle on its OWN connection; resolves with its result when it ends. */
  startSettle: () => Promise<R>;
  /** The statement the settle is blocked on, behind the holder, or null if it is not blocked. */
  observeBlocked: () => Promise<string | null>;
  /** Test-owned controls: stop only the session this scenario created. */
  terminateHolder: () => Promise<void>;
  terminateSettle: () => Promise<void>;
  /** Closes this scenario's connections; true only when none of its backends remains. */
  closeAndConfirmGone: () => Promise<boolean>;
};

export type BehindHolderSteps<R> = {
  /** Runs while the settle is parked behind the holder, before the holder is released. */
  whileBlocked?: (blockedQuery: string) => void | Promise<void>;
  /** Runs after both operations ended successfully. */
  assertions: (result: { run: R; blockedQuery: string }) => void | Promise<void>;
  /** Fixture removal. Runs last, and only once nothing of the scenario is still running. */
  cleanup?: () => void | Promise<void>;
};

/**
 * The numbers the harness may take, and the longest it can take (§20). The worst case is the sum of
 * every bounded wait that can follow another: main path 4 bounds (holder takes the lock;
 * observation, which is `boundMs + 2 * pollMs`; holder ends; settle ends) plus the always-run
 * cleanup path 4 bounds (holder and settle each awaited once, then once more after their stop)
 * plus 3 control actions (stop holder, stop settle, close/confirm). `whileBlocked` and `assertions`
 * are the caller's own steps and are bounded by the caller's client, not counted here.
 */
export type BehindHolderBudget = { boundMs: number; controlBoundMs?: number; pollMs: number };

export const worstCaseBudgetMs = (budget: BehindHolderBudget): number =>
  8 * budget.boundMs + 3 * (budget.controlBoundMs ?? budget.boundMs) + 2 * budget.pollMs;

/** The `it()` timeout of an integration scenario that uses `runBehindHolder`. */
export const SCENARIO_TIMEOUT_MS = 300_000;

/**
 * What the integration suite runs with. `worstCaseBudgetMs` of it is 162.2 s, which leaves the
 * scenario's own seeding and assertions about 137 s of `SCENARIO_TIMEOUT_MS` (asserted DB-free).
 */
export const SCENARIO_BUDGET = { boundMs: 15_000, controlBoundMs: 14_000, pollMs: 100 } as const;

/**
 * The test-owned CONTROL connection (observation, stop, close/confirm). Its own limits sit inside
 * `controlBoundMs`, so the database reports a control timeout before the harness's bound does:
 * a statement ends after `statementTimeoutMs`, a connect after `connectTimeoutS`, the close of the
 * scenario's clients after `endTimeoutS`, and the "no backend remains" poll stops after
 * `confirmWindowMs` (plus at most one more statement; a first statement that has to reconnect may
 * instead take `connectTimeoutS` plus one statement). Asserted DB-free to fit `controlBoundMs`.
 */
export const CONTROL_CONNECTION = {
  statementTimeoutMs: 4_000,
  lockTimeoutMs: 2_000,
  connectTimeoutS: 5,
  endTimeoutS: 3,
  confirmWindowMs: 4_000,
} as const;

export class UnresolvedWorkError extends Error {
  constructor(
    message: string,
    readonly firstFailure: unknown,
    readonly controlProblems: readonly string[] = [],
  ) {
    super(message);
    this.name = 'UnresolvedWorkError';
  }
}

type Tracked<T> = { ok: true; value: T } | { ok: false; error: unknown };

const track = <T>(work: Promise<T>): Promise<Tracked<T>> => work.then(
  (value): Tracked<T> => ({ ok: true, value }),
  (error: unknown): Tracked<T> => ({ ok: false, error }),
);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Rejects after `ms`; the work itself keeps running (the caller stops it). */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** True if `work` settled (either way) within `ms`. Never rejects. */
async function endedWithin(work: Promise<unknown> | undefined, ms: number): Promise<boolean> {
  if (work === undefined) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runBehindHolder<R>(
  ops: BehindHolderOps<R>, steps: BehindHolderSteps<R>,
): Promise<void> {
  const controlMs = ops.controlBoundMs ?? ops.boundMs;
  let holder: HolderHandle | undefined;
  let holderEnd: Promise<Tracked<void>> | undefined;
  let settleEnd: Promise<Tracked<R>> | undefined;
  let failed = false;
  let firstFailure: unknown;
  const fail = (error: unknown): void => {
    if (!failed) { failed = true; firstFailure = error; }
  };

  // A test-owned control, bounded and never silent: a timeout or a throw is recorded here and
  // reported in the failure; the caller learns only that it did not confirm.
  const controlProblems: string[] = [];
  const control = async <T>(
    what: string, work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    try {
      const value = await within(Promise.resolve().then(work), controlMs, `test-owned control: ${what}`);
      return { ok: true, value };
    } catch (error) {
      controlProblems.push(
        error instanceof Error && error.message.startsWith('test-owned control:')
          ? error.message : `test-owned control: ${what} failed: ${message(error)}`,
      );
      return { ok: false };
    }
  };

  try {
    holder = ops.startHolder();
    holderEnd = track(holder.done);
    // The first wait is bounded too: a holder that never gets the lock must not hang the test.
    await within(
      Promise.race([
        holder.held,
        holderEnd.then((ended): never => {
          throw new Error(`the holder ended before it held the row lock${
            ended.ok ? '' : `: ${message(ended.error)}`}`);
        }),
      ]),
      ops.boundMs, 'the holder taking the row lock',
    );

    const settling = track(ops.startSettle());
    settleEnd = settling;

    // The observation phase as a whole is bounded, so a control query that never returns is
    // a timeout and not a hang. The loop is told to stop afterwards so it cannot outlive the phase.
    let observing = true;
    const observeUntilBlocked = async (): Promise<string> => {
      const deadline = Date.now() + ops.boundMs;
      while (observing) {
        let blocked: string | null;
        try {
          blocked = await ops.observeBlocked();
        } catch (error) {
          throw new Error(`test-owned control: observing the blocked statement failed: ${message(error)}`);
        }
        if (blocked !== null) return blocked;
        if (Date.now() > deadline) throw new Error('the settle never blocked behind the row holder');
        const early = await Promise.race([settling, sleep(ops.pollMs).then(() => null)]);
        if (early !== null) {
          throw new Error(`the settle finished without waiting on the row holder: ${
            early.ok ? 'ok' : message(early.error)}`);
        }
      }
      throw new Error('the observation of the blocked statement was stopped');
    };
    let blockedQuery: string;
    try {
      blockedQuery = await within(
        observeUntilBlocked(), ops.boundMs + 2 * ops.pollMs,
        'test-owned control: observing the blocked statement',
      );
    } finally {
      observing = false;
    }

    if (steps.whileBlocked) await steps.whileBlocked(blockedQuery);

    holder.release();
    const heldEnd = await within(holderEnd, ops.boundMs, 'the row holder');
    if (!heldEnd.ok) throw new Error(`the holder's work failed: ${message(heldEnd.error)}`);
    const run = await within(settling, ops.boundMs, 'the settle');
    if (!run.ok) throw new Error(`the settle failed: ${message(run.error)}`);

    await steps.assertions({ run: run.value, blockedQuery });
  } catch (error) {
    fail(error);
  }

  // From here on, on EVERY path (success, early assertion failure, timeout): release the
  // holder FIRST (the settle may be parked behind it), wait for both, stop what outlives
  // its bound with the test-owned controls, and only then allow cleanup.
  holder?.release();
  let holderDone = await endedWithin(holderEnd, ops.boundMs);
  let settleDone = await endedWithin(settleEnd, ops.boundMs);
  if (!holderDone) {
    await control('terminating the holder', ops.terminateHolder);
    holderDone = await endedWithin(holderEnd, ops.boundMs);
  }
  if (!settleDone) {
    await control('terminating the settle', ops.terminateSettle);
    settleDone = await endedWithin(settleEnd, ops.boundMs);
  }
  const closed = await control(
    'closing the scenario connections and confirming no backend remains', ops.closeAndConfirmGone,
  );
  const gone = closed.ok && closed.value;

  if (!(holderDone && settleDone && gone)) {
    const unresolved = [
      holderDone ? null : 'the holder',
      settleDone ? null : 'the settle',
      gone ? null : 'a backend of this scenario',
    ].filter((part): part is string => part !== null).join(', ');
    throw new UnresolvedWorkError(
      `${unresolved} still running or unconfirmed after the bounded wait and the test-owned stop; `
      + `fixture cleanup was SKIPPED so nothing is removed under live work${
        controlProblems.length > 0 ? ` (${controlProblems.join('; ')})` : ''}${
        failed ? ` (first failure: ${message(firstFailure)})` : ''}`,
      firstFailure,
      controlProblems,
    );
  }

  // Everything ended and the backends are confirmed gone, so cleanup is safe; but a control that
  // had to be recorded along the way is a failure of the run even though the outcome was verified.
  // The earlier failure stays the headline, with the control problems alongside it and the
  // original as `cause`; neither replaces the other.
  if (controlProblems.length > 0) {
    if (failed) {
      firstFailure = Object.assign(
        new Error(`${message(firstFailure)} (also: ${controlProblems.join('; ')})`),
        { cause: firstFailure },
      );
    } else {
      fail(new Error(controlProblems.join('; ')));
    }
  }

  if (steps.cleanup) {
    try { await steps.cleanup(); } catch (error) { fail(error); }
  }
  if (failed) throw firstFailure;
}

/* ------------------------------------------------------------------ *
 * The cleanup gate
 * ------------------------------------------------------------------ */

export type CleanupGate = {
  /** Remembers an `UnresolvedWorkError`; every other error is ignored. Idempotent. */
  record: (error: unknown) => void;
  /** The recorded unresolved work, or null. */
  unresolved: () => UnresolvedWorkError | null;
  /**
   * One scenario. Refuses to start while earlier work is unresolved. Runs `cleanup` after `body`
   * on every path EXCEPT when this scenario (or an earlier one) left unresolved work.
   */
  scenario: (body: () => Promise<void>, cleanup: () => Promise<void>) => Promise<void>;
  /**
   * A fixture removal in a hook. Runs `removal` only when no work is unresolved; otherwise the
   * removal is skipped, reported through `report`, and `false` is returned.
   */
  removeFixtures: (what: string, removal: () => Promise<void>) => Promise<boolean>;
};

export function createCleanupGate(
  report: (line: string) => void = (line) => { console.error(line); },
): CleanupGate {
  let unresolved: UnresolvedWorkError | null = null;
  const record = (error: unknown): void => {
    if (error instanceof UnresolvedWorkError && unresolved === null) unresolved = error;
  };
  const skip = (what: string): void => {
    report(`ISSUE-274: ${what} was SKIPPED because work is unresolved: ${unresolved?.message ?? ''}`);
  };
  return {
    record,
    unresolved: () => unresolved,
    async scenario(body, cleanup) {
      if (unresolved !== null) {
        throw new Error(`refusing to start a scenario: earlier work is unresolved (${unresolved.message})`);
      }
      try {
        await body();
      } catch (error) {
        record(error);
        throw error;
      } finally {
        if (unresolved === null) await cleanup();
        else skip('the scenario fixture cleanup');
      }
    },
    async removeFixtures(what, removal) {
      if (unresolved !== null) { skip(what); return false; }
      await removal();
      return true;
    },
  };
}
