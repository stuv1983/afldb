/**
 * AFLDB-ISSUE-274 §19, §20. DB-free checks of the holder/settle orchestration the integration
 * suite uses (tests/integration/behind-holder.ts): completion precedes cleanup on every path, every
 * test-owned control (observation, termination, close/confirm) is bounded and reported, and an
 * unresolved scenario blocks every other fixture removal in the integration file.
 * No database, no driver; the operations are fakes whose timing is explicit.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CONTROL_CONNECTION, createCleanupGate, runBehindHolder, SCENARIO_BUDGET, SCENARIO_TIMEOUT_MS,
  UnresolvedWorkError, worstCaseBudgetMs, type BehindHolderOps, type BehindHolderSteps,
} from './integration/behind-holder';

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const never = (): Promise<never> => new Promise<never>(() => {});

type Knobs = {
  /** The holder never gets the lock. */
  holderNeverHolds?: boolean;
  /** The holder's work throws once released. */
  holderWorkFails?: boolean;
  /** The settle ignores the holder's release and only ends when it is terminated. */
  settleHangs?: boolean;
  /** The settle cannot be stopped at all. */
  settleUnstoppable?: boolean;
  /** The settle ends before it ever blocks. */
  settleSkipsTheWait?: boolean;
  /** The settle rejects once released. */
  settleFails?: boolean;
  /** The caller cannot confirm every backend is gone. */
  stillBackends?: boolean;
  /** The blocked-statement observation never returns. */
  observeHangs?: boolean;
  /** The blocked-statement observation throws (the control connection failed). */
  observeThrows?: boolean;
  /** Both terminations never return, and do not stop anything. */
  terminateHangs?: boolean;
  /** The settle termination stops the settle and then never returns. */
  terminateStopsThenHangs?: boolean;
  /** The settle termination throws without stopping anything. */
  terminateThrows?: boolean;
  /** Closing the connections / confirming no backend remains never returns. */
  closeHangs?: boolean;
  /** Closing the connections / confirming no backend remains throws. */
  closeThrows?: boolean;
};

const BOUNDS = { boundMs: 60, controlBoundMs: 40, pollMs: 5 } as const;

function harness(knobs: Knobs = {}) {
  const events: string[] = [];
  const log = (event: string): void => { events.push(event); };

  let released = false;
  let releaseHolder: () => void = () => {};
  const holderGate = new Promise<void>((resolve) => { releaseHolder = resolve; });
  let stopSettle: () => void = () => {};
  const settleStopped = new Promise<void>((resolve) => { stopSettle = resolve; });
  let stopHolder: () => void = () => {};
  const holderStopped = new Promise<void>((resolve) => { stopHolder = resolve; });
  let holderEnded = false;
  let settleEnded = false;

  const ops: BehindHolderOps<string> = {
    ...BOUNDS,
    startHolder: () => {
      log('holder:start');
      const held = knobs.holderNeverHolds ? new Promise<void>(() => {}) : Promise.resolve();
      const done = (async () => {
        if (knobs.holderNeverHolds) { await holderStopped; holderEnded = true; log('holder:done'); return; }
        await Promise.race([holderGate, holderStopped]);
        await delay(8); // committing takes time: cleanup must wait for it
        holderEnded = true;
        log('holder:done');
        if (knobs.holderWorkFails) throw new Error('check violation');
      })();
      return { held, done, release: () => { if (!released) { released = true; log('holder:release'); } releaseHolder(); } };
    },
    startSettle: () => {
      log('settle:start');
      return (async () => {
        if (knobs.settleSkipsTheWait) { settleEnded = true; log('settle:done'); return 'early'; }
        if (knobs.settleHangs || knobs.settleUnstoppable || knobs.terminateStopsThenHangs) {
          await (knobs.settleUnstoppable ? new Promise<void>(() => {}) : settleStopped);
          settleEnded = true; log('settle:done');
          throw new Error('terminating connection due to administrator command');
        }
        await holderGate; // blocked behind the holder until it is released
        await delay(8);   // the settle's own commit lags the holder's
        settleEnded = true;
        log('settle:done');
        if (knobs.settleFails) throw new Error('boom');
        return 'ran';
      })();
    },
    observeBlocked: async () => {
      if (knobs.observeHangs) return never();
      if (knobs.observeThrows) throw new Error('canceling statement due to statement timeout');
      return holderEnded || settleEnded ? null : 'SELECT id FROM matches WHERE match_key = $1 FOR NO KEY UPDATE';
    },
    terminateHolder: async () => {
      log('holder:terminate');
      if (knobs.terminateHangs) return never();
      stopHolder();
    },
    terminateSettle: async () => {
      log('settle:terminate');
      if (knobs.terminateThrows) throw new Error('connection terminated unexpectedly');
      if (knobs.terminateStopsThenHangs) { stopSettle(); return never(); }
      if (knobs.terminateHangs) return never();
      stopSettle();
    },
    closeAndConfirmGone: async () => {
      log('closed');
      if (knobs.closeHangs) return never();
      if (knobs.closeThrows) throw new Error('read ECONNRESET');
      return !knobs.stillBackends;
    },
  };

  const steps: BehindHolderSteps<string> & { assertionsRan: boolean } = {
    assertionsRan: false,
    assertions: () => { steps.assertionsRan = true; log('assertions'); },
    cleanup: () => { log('cleanup'); },
  };
  return { ops, steps, events };
}

const index = (events: string[], event: string): number => events.indexOf(event);

function expectCleanupAfterCompletion(events: string[]): void {
  const cleanup = index(events, 'cleanup');
  expect(cleanup, events.join(' > ')).toBeGreaterThan(-1);
  for (const before of ['holder:done', 'settle:done', 'closed']) {
    expect(index(events, before), `${before} before cleanup: ${events.join(' > ')}`)
      .toBeGreaterThan(-1);
    expect(index(events, before)).toBeLessThan(cleanup);
  }
}

/** Runs the harness and returns the failure (null if it passed) and the time it took. */
async function runTimed(knobs: Knobs) {
  const run = harness(knobs);
  const started = Date.now();
  const failure = await runBehindHolder(run.ops, run.steps).then(() => null, (error: unknown) => error);
  return { ...run, failure, elapsedMs: Date.now() - started };
}

describe('ISSUE-274 §19 — runBehindHolder: completion precedes cleanup', () => {
  it('success: assertions see a finished settle; cleanup comes after both ended', async () => {
    const { ops, steps, events } = harness();
    await runBehindHolder(ops, steps);
    expect(steps.assertionsRan).toBe(true);
    expect(index(events, 'holder:release')).toBeGreaterThan(index(events, 'settle:start'));
    expect(index(events, 'settle:done')).toBeLessThan(index(events, 'assertions'));
    expectCleanupAfterCompletion(events);
  });

  it('an assertion that fails while the settle is parked still releases and completes both before cleanup', async () => {
    const { ops, steps, events } = harness();
    steps.whileBlocked = () => { throw new Error('the blocked statement was the final UPDATE'); };
    await expect(runBehindHolder(ops, steps)).rejects.toThrow('the blocked statement was the final UPDATE');
    expect(steps.assertionsRan).toBe(false);
    expect(index(events, 'holder:release')).toBeGreaterThan(-1);
    expectCleanupAfterCompletion(events);
    expect(events).not.toContain('settle:terminate');
  });

  it('a failing assertion after the run still reports it, and cleanup still ran last', async () => {
    const { ops, steps, events } = harness();
    steps.assertions = () => { throw new Error('home_score was overwritten'); };
    await expect(runBehindHolder(ops, steps)).rejects.toThrow('home_score was overwritten');
    expectCleanupAfterCompletion(events);
  });

  it('a settle that outlives its bound is stopped with the test-owned control, awaited, THEN cleaned up; the timeout is the failure', async () => {
    const { ops, steps, events } = harness({ settleHangs: true });
    await expect(runBehindHolder(ops, steps)).rejects.toThrow(/the settle did not finish within 60 ms/);
    expect(events).toContain('settle:terminate');
    expect(index(events, 'settle:terminate')).toBeLessThan(index(events, 'settle:done'));
    expectCleanupAfterCompletion(events);
    expect(steps.assertionsRan).toBe(false);
  });

  it('a settle that cannot be stopped SKIPS cleanup and reports unresolved work', async () => {
    const { ops, steps, events } = harness({ settleUnstoppable: true });
    const failure = await runBehindHolder(ops, steps).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(UnresolvedWorkError);
    expect((failure as Error).message).toMatch(/the settle still running/);
    expect((failure as Error).message).toMatch(/cleanup was SKIPPED/);
    expect(events).toContain('settle:terminate');
    expect(events).not.toContain('cleanup');
  });

  it('backends that cannot be confirmed gone SKIP cleanup even though both operations ended', async () => {
    const { ops, steps, events } = harness({ stillBackends: true });
    const failure = await runBehindHolder(ops, steps).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(UnresolvedWorkError);
    expect((failure as Error).message).toMatch(/a backend of this scenario/);
    expect(events).not.toContain('cleanup');
  });

  it('the FIRST wait is bounded: a holder that never gets the lock times out, is stopped, and only then is cleanup allowed', async () => {
    const { ops, steps, events } = harness({ holderNeverHolds: true });
    await expect(runBehindHolder(ops, steps)).rejects.toThrow(/the holder taking the row lock did not finish within 60 ms/);
    expect(events).not.toContain('settle:start');
    expect(events).toContain('holder:terminate');
    // No settle was ever started, so only the holder and the connections have to be gone.
    const order = ['holder:terminate', 'holder:done', 'closed', 'cleanup'].map((e) => index(events, e));
    expect(order.every((at) => at > -1), events.join(' > ')).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('a holder whose own work fails is reported as such, after the settle ended', async () => {
    const { ops, steps, events } = harness({ holderWorkFails: true });
    await expect(runBehindHolder(ops, steps)).rejects.toThrow(/the holder's work failed: check violation/);
    expectCleanupAfterCompletion(events);
  });

  it('a settle that fails is reported, after both ended and before cleanup', async () => {
    const { ops, steps, events } = harness({ settleFails: true });
    await expect(runBehindHolder(ops, steps)).rejects.toThrow(/the settle failed: boom/);
    expectCleanupAfterCompletion(events);
  });

  it('a settle that finishes without ever blocking is a failure, not a pass', async () => {
    const { ops, steps, events } = harness({ settleSkipsTheWait: true });
    ops.observeBlocked = async () => null;
    await expect(runBehindHolder(ops, steps)).rejects.toThrow(/finished without waiting on the row holder/);
    expectCleanupAfterCompletion(events);
  });

  it('a cleanup failure never masks the first failure, and is reported when there is none', async () => {
    const first = harness();
    first.steps.assertions = () => { throw new Error('first'); };
    first.steps.cleanup = () => { throw new Error('cleanup'); };
    await expect(runBehindHolder(first.ops, first.steps)).rejects.toThrow('first');

    const only = harness();
    only.steps.cleanup = () => { throw new Error('cleanup'); };
    await expect(runBehindHolder(only.ops, only.steps)).rejects.toThrow('cleanup');
  });
});

describe('ISSUE-274 §20 — the test-owned controls are bounded and never silent', () => {
  const budget = worstCaseBudgetMs(BOUNDS);

  it('the documented budget is the sum the code can take, and fits the scenario timeout', () => {
    // 8 bounds + 3 control actions + 2 polls, from the documented worst case.
    expect(budget).toBe(8 * 60 + 3 * 40 + 2 * 5);
    expect(worstCaseBudgetMs({ boundMs: 10, pollMs: 1 })).toBe(8 * 10 + 3 * 10 + 2);
    expect(worstCaseBudgetMs(SCENARIO_BUDGET)).toBe(162_200);
    // Leaves the scenario's own seeding and assertions at least two minutes.
    expect(worstCaseBudgetMs(SCENARIO_BUDGET)).toBeLessThanOrEqual(SCENARIO_TIMEOUT_MS - 120_000);
  });

  it('the control connection\'s own limits sit inside the control bound', () => {
    const c = CONTROL_CONNECTION;
    const bound = SCENARIO_BUDGET.controlBoundMs;
    // A statement (or the driver) gives up before the harness does, and the lock wait before that.
    expect(c.statementTimeoutMs).toBeLessThan(bound);
    expect(c.lockTimeoutMs).toBeLessThan(c.statementTimeoutMs);
    // close/confirm: close the clients, then a first statement that may have to connect, then at
    // most one more statement past the confirm window.
    const closeAndConfirm = c.endTimeoutS * 1000
      + Math.max(c.confirmWindowMs, c.connectTimeoutS * 1000) + c.statementTimeoutMs;
    expect(closeAndConfirm).toBeLessThanOrEqual(bound);
    // A stop is a single statement, possibly after a connect.
    expect(c.connectTimeoutS * 1000 + c.statementTimeoutMs).toBeLessThanOrEqual(bound);
  });

  describe('observation of the blocked statement never resolves', () => {
    it('fails explicitly within the budget, after the work ended, and only then cleans up', async () => {
      const run = await runTimed({ observeHangs: true });
      expect(run.failure).toBeInstanceOf(Error);
      expect(run.failure).not.toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: observing the blocked statement did not finish within 70 ms/);
      expect(run.steps.assertionsRan).toBe(false);
      expectCleanupAfterCompletion(run.events);
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });

    it('with a settle that cannot be stopped it is unresolved work: cleanup is prevented', async () => {
      const run = await runTimed({ observeHangs: true, settleUnstoppable: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message).toMatch(/first failure: test-owned control: observing the blocked statement did not finish/);
      expect(run.events).not.toContain('cleanup');
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });

    it('an observation that throws is a reported control failure, not a pass', async () => {
      const run = await runTimed({ observeThrows: true });
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: observing the blocked statement failed: canceling statement due to statement timeout/);
      expect(run.steps.assertionsRan).toBe(false);
      expectCleanupAfterCompletion(run.events);
    });
  });

  describe('termination never resolves', () => {
    it('a settle that cannot be stopped: explicit failure within the budget, cleanup prevented', async () => {
      const run = await runTimed({ settleHangs: true, terminateHangs: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      const failure = run.failure as UnresolvedWorkError;
      expect(failure.message).toMatch(/the settle still running or unconfirmed/);
      expect(failure.message).toMatch(/test-owned control: terminating the settle did not finish within 40 ms/);
      expect(failure.message).toMatch(/cleanup was SKIPPED/);
      expect(failure.controlProblems).toEqual([
        'test-owned control: terminating the settle did not finish within 40 ms',
      ]);
      expect(run.events).toContain('settle:terminate');
      expect(run.events).not.toContain('cleanup');
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });

    it('a holder that cannot be stopped: explicit failure within the budget, cleanup prevented', async () => {
      const run = await runTimed({ holderNeverHolds: true, terminateHangs: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message).toMatch(/the holder still running or unconfirmed/);
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: terminating the holder did not finish within 40 ms/);
      expect(run.events).not.toContain('cleanup');
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });

    it('a termination that throws without stopping the settle is reported and prevents cleanup', async () => {
      const run = await runTimed({ settleHangs: true, terminateThrows: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: terminating the settle failed: connection terminated unexpectedly/);
      expect(run.events).not.toContain('cleanup');
    });

    it('a termination that stopped the settle but never returned is STILL a failure, not a pass', async () => {
      // The work is verifiably gone, so cleanup may proceed; the control timeout is reported anyway.
      const run = await runTimed({ terminateStopsThenHangs: true });
      expect(run.failure).toBeInstanceOf(Error);
      expect(run.failure).not.toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message).toMatch(/the settle did not finish within 60 ms/);
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: terminating the settle did not finish within 40 ms/);
      expectCleanupAfterCompletion(run.events);
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });
  });

  describe('closing the connections / confirming no backend remains never resolves', () => {
    it('is unresolved work: explicit failure within the budget, cleanup prevented', async () => {
      const run = await runTimed({ closeHangs: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      const failure = run.failure as UnresolvedWorkError;
      expect(failure.message).toMatch(/a backend of this scenario/);
      expect(failure.message).toMatch(
        /test-owned control: closing the scenario connections and confirming no backend remains did not finish within 40 ms/,
      );
      expect(failure.controlProblems).toHaveLength(1);
      // Both operations really ended; it is the unconfirmed backends alone that prevent cleanup.
      expect(run.events).toContain('holder:done');
      expect(run.events).toContain('settle:done');
      expect(run.events).not.toContain('cleanup');
      expect(run.elapsedMs).toBeLessThanOrEqual(budget);
    });

    it('a close that throws is unresolved work too, with the cause reported', async () => {
      const run = await runTimed({ closeThrows: true });
      expect(run.failure).toBeInstanceOf(UnresolvedWorkError);
      expect((run.failure as Error).message)
        .toMatch(/test-owned control: closing the scenario connections and confirming no backend remains failed: read ECONNRESET/);
      expect(run.events).not.toContain('cleanup');
    });

    it('also holds when the main path had already failed: the first failure is still named', async () => {
      const run = harness({ closeHangs: true });
      run.steps.assertions = () => { throw new Error('home_score was overwritten'); };
      const failure = await runBehindHolder(run.ops, run.steps).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(UnresolvedWorkError);
      expect((failure as Error).message).toMatch(/first failure: home_score was overwritten/);
      expect(run.events).not.toContain('cleanup');
    });
  });
});

describe('ISSUE-274 §20 — the cleanup gate stops every fixture removal after unresolved work', () => {
  const unresolvedError = (): UnresolvedWorkError =>
    new UnresolvedWorkError('the settle still running or unconfirmed; fixture cleanup was SKIPPED', undefined);

  it('a scenario that ends unresolved skips its own cleanup, rethrows, and records the work', async () => {
    const reports: string[] = [];
    const gate = createCleanupGate((line) => reports.push(line));
    let cleaned = false;
    const failure = await gate.scenario(async () => { throw unresolvedError(); }, async () => { cleaned = true; })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(UnresolvedWorkError);
    expect(cleaned).toBe(false);
    expect(gate.unresolved()).toBe(failure);
    expect(reports.join('\n')).toMatch(/the scenario fixture cleanup was SKIPPED/);
  });

  it('afterwards no teardown hook removes anything, and no later scenario starts', async () => {
    const reports: string[] = [];
    const gate = createCleanupGate((line) => reports.push(line));
    await gate.scenario(async () => { throw unresolvedError(); }, async () => {}).catch(() => undefined);

    const removed: string[] = [];
    for (const hook of ['inner afterAll', 'S5 afterAll', 'file afterAll']) {
      expect(await gate.removeFixtures(hook, async () => { removed.push(hook); })).toBe(false);
    }
    expect(removed).toEqual([]);
    expect(reports.filter((line) => /was SKIPPED/.test(line))).toHaveLength(4);

    let started = false;
    const refusal = await gate.scenario(async () => { started = true; }, async () => { removed.push('cleanup'); })
      .then(() => null, (error: unknown) => error);
    expect((refusal as Error).message).toMatch(/refusing to start a scenario: earlier work is unresolved/);
    expect(started).toBe(false);
    expect(removed).toEqual([]);
  });

  it('an unresolved failure recorded by the helper (not the wrapper) gates the same way', async () => {
    const gate = createCleanupGate(() => {});
    gate.record(unresolvedError());
    // Only the typed error counts: an ordinary error never blocks cleanup.
    const other = createCleanupGate(() => {});
    other.record(new Error('ordinary'));
    expect(other.unresolved()).toBeNull();
    let removed = false;
    expect(await gate.removeFixtures('hook', async () => { removed = true; })).toBe(false);
    expect(removed).toBe(false);
  });

  it('an ordinary failure still cleans up, and teardown hooks still run', async () => {
    const gate = createCleanupGate(() => {});
    let cleaned = false;
    await expect(gate.scenario(async () => { throw new Error('assertion'); }, async () => { cleaned = true; }))
      .rejects.toThrow('assertion');
    expect(cleaned).toBe(true);
    expect(gate.unresolved()).toBeNull();
    let removed = false;
    expect(await gate.removeFixtures('hook', async () => { removed = true; })).toBe(true);
    expect(removed).toBe(true);
  });

  it('the harness and the gate together: an unconfirmed backend blocks cleanup, the hooks and the next scenario', async () => {
    const gate = createCleanupGate(() => {});
    const run = harness({ closeHangs: true });
    const removed: string[] = [];
    await gate.scenario(
      () => runBehindHolder(run.ops, run.steps),
      async () => { removed.push('wrapper'); },
    ).catch(() => undefined);
    await gate.removeFixtures('afterAll', async () => { removed.push('afterAll'); });
    expect(removed).toEqual([]);
    expect(run.events).not.toContain('cleanup');
    expect(gate.unresolved()).toBeInstanceOf(UnresolvedWorkError);
  });

  /* The surrounding definitions of the real suite (the scenario wrapper and the afterAll hooks)
     are in tests/integration/settle-afltables.test.ts, which needs a database. They are pinned
     from SOURCE: every fixture-removing call a hook or the wrapper makes goes through the gate. */
  describe('the integration suite routes its removals through the gate', () => {
    const source = readFileSync('tests/integration/settle-afltables.test.ts', 'utf8').replace(/\r\n/g, '\n');
    const REMOVERS = /\b(cleanupAuthority|cleanup122|cleanupIssue099|cleanupMatchesOnly)\b/;

    /** The text of every `afterAll(` / `afterEach(` hook: from the call to the closing line at its indent. */
    const hooks = [...source.matchAll(/^( *)(afterAll|afterEach)\(/gm)].map((match) => {
      const start = match.index as number;
      const close = source.indexOf(`\n${match[1]}});`, start);
      expect(close, `the end of the ${match[2]} at offset ${start}`).toBeGreaterThan(start);
      return { kind: match[2], body: source.slice(start, close + 1), line: source.slice(0, start).split('\n').length };
    });

    it('there is no afterEach, and exactly the hooks that remove fixtures are gated', () => {
      expect(hooks.filter((hook) => hook.kind === 'afterEach')).toEqual([]);
      const removing = hooks.filter((hook) => REMOVERS.test(hook.body));
      // The ISSUE-099 file hook, the ISSUE-122 S5 hook, the durable-authority hook and the
      // matches-only (ISSUE-274) hook.
      expect(removing).toHaveLength(4);
      for (const hook of removing) {
        expect(hook.body, `afterAll at line ${hook.line}`).toContain('cleanupGate.removeFixtures(');
        // Whatever removes sits INSIDE the gated callback: nothing precedes it in the hook.
        const before = hook.body.slice(0, hook.body.indexOf('cleanupGate.removeFixtures('));
        expect(before, `afterAll at line ${hook.line}`).not.toMatch(REMOVERS);
      }
    });

    it('the scenario wrapper cleans up only through the gate, and every scenario uses the wrapper timeout', () => {
      expect(source).toContain('await cleanupGate.scenario(body, cleanupAuthority);');
      expect(source).toContain('await cleanupGate.scenario(body, cleanupMatchesOnly);');
      // One timeout per wrapper: the durable-authority wrapper and the matches-only wrapper.
      expect(source.split('}, SCENARIO_TIMEOUT_MS);').length - 1).toBe(2);
      // Every direct call of a remover is a PRE-clean in a beforeAll or sits inside a gated hook.
      const direct = [...source.matchAll(/^ *await (cleanupAuthority|cleanup122|cleanupIssue099|cleanupMatchesOnly)\(/gm)]
        .map((match) => match.index as number);
      // Four pre-cleans in beforeAll hooks, and the two removers that sit inside a gated callback.
      expect(direct).toHaveLength(6);
      for (const at of direct) {
        const before = source.slice(0, at);
        const line = before.split('\n').length;
        const inBeforeAll = before.lastIndexOf('beforeAll(') > before.lastIndexOf('afterAll(');
        if (inBeforeAll) continue;
        const hookStart = before.lastIndexOf('afterAll(');
        expect(before.slice(hookStart), `the direct remover at line ${line} is in an ungated afterAll`)
          .toContain('cleanupGate.removeFixtures(');
      }
    });

    /* ISSUE-274 cases need no migration 110. They used to sit in the durable-authority describe, whose
       `scenario()` wrapper returns early unless `storable` (migration 110 applied), which would have made
       them pass vacuously in State A. Pinned from source: they live in their own describe, which has no
       schema-state guard, and the durable-authority describe no longer contains any of them. */
    describe('the ISSUE-274 cases are independent of the migration-110 schema state', () => {
      const DURABLE = "describe('Durable Match Sheet authority through the settle (AFLDB-ISSUE-257 F-S9-03)'";
      const MATCHES_ONLY = "describe('AFLDB-ISSUE-274 \u2014 a matches-only settle unit locks the match row (needs no migration 110)'";
      const durableStart = source.indexOf(DURABLE);
      const matchesOnlyStart = source.indexOf(MATCHES_ONLY);
      // The matches-only block (its header comment, then its describe) is the last in the file; the
      // durable-authority describe ends where that header comment begins.
      const headerStart = source.lastIndexOf('/* ---', matchesOnlyStart);
      const durable = source.slice(durableStart, headerStart);
      const matchesOnly = source.slice(matchesOnlyStart);

      it('finds both describes, durable first', () => {
        expect(durableStart).toBeGreaterThan(0);
        expect(matchesOnlyStart).toBeGreaterThan(durableStart);
        expect(headerStart).toBeGreaterThan(durableStart);
        expect(source.split(DURABLE).length - 1).toBe(1);
        expect(source.split(MATCHES_ONLY).length - 1).toBe(1);
      });

      it('the durable-authority describe holds none of the ISSUE-274 cases or their harness', () => {
        // (A comment in the wrapper still names the helper; its definition and calls must be gone.)
        expect(durable).not.toContain('const settleBehindHolder');
        expect(durable).not.toContain('await settleBehindHolder(');
        expect(durable).not.toContain('ISSUE-274: ');
        expect(durable).not.toContain('FOR NO KEY UPDATE');
      });

      it('the matches-only describe has no migration-110 guard, and holds every ISSUE-274 case', () => {
        // Code only: the explanatory comments name `storable` and `player_match_stats` on purpose.
        const code = matchesOnly.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/\bstorable\b/);
        expect(code).not.toContain('playerMatchStatsAuthorityStorable');
        expect(code).not.toMatch(/if \(!\w+\) return;/);
        expect(code).not.toContain('player_match_stats');
        // The wrapper cleans through the gate with the matches-only remover, with the shared timeout.
        expect(matchesOnly).toContain('await cleanupGate.scenario(body, cleanupMatchesOnly);');
        // The two lock scenarios, the driver count check, and the blocked-query discriminator.
        expect(matchesOnly.split("scenario274('ISSUE-274:").length - 1).toBe(2);
        expect(matchesOnly).toContain("it('ISSUE-274: the driver reports count 0");
        expect(matchesOnly.split("expect(blockedQuery).toContain('FOR NO KEY UPDATE');").length - 1).toBe(2);
        expect(matchesOnly).toContain('expect(blockedQuery).not.toMatch(/^\\s*UPDATE matches/);');
        // The editor-override and deletion assertions are still present.
        expect(matchesOnly).toContain('expect((await matchRow122(f.matchKey))?.homeScore).toBe(112);');
        expect(matchesOnly).toContain('expect(await matchRow122(f.matchKey)).toBeUndefined();');
        expect(matchesOnly.split('expect(run.counters.canonicalRowsUpdated).toBe(0);').length - 1).toBe(2);
      });
    });

    it('settleBehindHolder records an UnresolvedWorkError in the gate and ends its control connection', () => {
      expect(source).toMatch(/error instanceof UnresolvedWorkError[\s\S]*cleanupGate\.record\(named\)/);
      expect(source).toMatch(/connect_timeout: CONTROL_CONNECTION\.connectTimeoutS/);
      expect(source).toMatch(/statement_timeout: CONTROL_CONNECTION\.statementTimeoutMs/);
      expect(source).toMatch(/\.\.\.SCENARIO_BUDGET,/);
    });
  });
});
