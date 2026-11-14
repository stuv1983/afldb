/**
 * AFLDB-ISSUE-144 Stage 7 — the URL contract of /clubs/compare.
 *
 * Database-free by construction: these are statements about what a URL
 * means, and the two URLs this surface produces must never be confused.
 * The state resolution that reads canonical rows is proved separately in
 * tests/integration/club-comparison-route.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ConcurrencyGateBusyError,
  createConcurrencyGate,
  gateLimitFromEnv,
  gateWaitMsFromEnv,
} from '@/lib/concurrency-gate';

import {
  CLUB_COMPARE_PATH,
  canonicalClubComparePath,
  canonicalPairOrder,
  clubCompareBaseParams,
  clubComparePath,
  isMatchType,
} from '@/lib/club-comparison-url';

describe('AFLDB-ISSUE-144 Stage 7: shareable current-state URLs', () => {
  it('carries the pair in the order it was asked for', () => {
    expect(clubComparePath({ club1: 'brisbane-lions', club2: 'adelaide' }))
      .toBe('/clubs/compare?club1=brisbane-lions&club2=adelaide');
  });

  it('carries match filter and page', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', page: 3,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood&matchType=finals&page=3');
  });

  it('carries the era (Club Rivalry Explorer follow-up, FR-2)', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', era: 1990,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood&era=1990');
  });

  it('omits the defaults so the shared URL stays the short one', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', matchType: 'all', page: 1,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood');
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', era: null,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood');
  });

  it('is the bare surface when nothing is selected', () => {
    expect(clubComparePath({})).toBe(CLUB_COMPARE_PATH);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: SEO canonical URL', () => {
  it('orders the pair alphabetically whichever way it was requested', () => {
    const canonical = '/clubs/compare?club1=adelaide&club2=brisbane-lions';
    expect(canonicalClubComparePath('adelaide', 'brisbane-lions')).toBe(canonical);
    expect(canonicalClubComparePath('brisbane-lions', 'adelaide')).toBe(canonical);
  });

  it('omits match filter and page', () => {
    const canonical = canonicalClubComparePath('carlton', 'collingwood');
    expect(canonical).toBe('/clubs/compare?club1=carlton&club2=collingwood');
    expect(canonical).not.toContain('matchType');
    expect(canonical).not.toContain('page');
  });

  it('never invents a pair from an incomplete selection', () => {
    expect(canonicalClubComparePath(null, null)).toBe(CLUB_COMPARE_PATH);
    expect(canonicalClubComparePath('carlton', null)).toBe(CLUB_COMPARE_PATH);
    expect(canonicalClubComparePath(null, 'carlton')).toBe(CLUB_COMPARE_PATH);
  });

  it('sorts independently of presentation order', () => {
    const [lower, higher] = canonicalPairOrder('western-bulldogs', 'essendon');
    expect([lower, higher]).toEqual(['essendon', 'western-bulldogs']);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: match-type recognition', () => {
  it('accepts exactly the three canonical filters', () => {
    expect(isMatchType('all')).toBe(true);
    expect(isMatchType('home-and-away')).toBe(true);
    expect(isMatchType('finals')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMatchType('Finals')).toBe(false);
    expect(isMatchType('practice')).toBe(false);
    expect(isMatchType(undefined)).toBe(false);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: pagination base parameters', () => {
  it('carries the view state the pager must preserve, without the page', () => {
    expect(clubCompareBaseParams({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', page: 4,
    })).toEqual({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals',
    });
  });

  it('drops the default match filter', () => {
    expect(clubCompareBaseParams({ club1: 'carlton', club2: 'collingwood', matchType: 'all' }))
      .toEqual({
        club1: 'carlton', club2: 'collingwood', matchType: undefined,
      });
  });

  it('carries the era so an era-filtered match history keeps its era across pages', () => {
    expect(clubCompareBaseParams({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', era: 1990, page: 4,
    })).toEqual({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', era: '1990',
    });
  });

  it('drops an absent era', () => {
    expect(clubCompareBaseParams({ club1: 'carlton', club2: 'collingwood' }))
      .toEqual({ club1: 'carlton', club2: 'collingwood', matchType: undefined, era: undefined });
  });
});

describe('AFLDB-ISSUE-361 (FE-6): the concurrency gate behind pair comparisons', () => {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('never runs more than its limit at once and runs every task in arrival order', async () => {
    const gate = createConcurrencyGate(2);
    let running = 0;
    let highest = 0;
    const started: number[] = [];
    const tasks = Array.from({ length: 7 }, (_, i) => gate.run(async () => {
      started.push(i);
      running += 1;
      highest = Math.max(highest, running);
      for (let n = 0; n < 3; n += 1) await tick();
      running -= 1;
      return i * 10;
    }));
    expect(await Promise.all(tasks)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(highest).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(gate.stats()).toEqual({ active: 0, waiting: 0, peakActive: 2 });
  });

  it('gives the slot back when a task rejects, and passes the rejection on', async () => {
    const gate = createConcurrencyGate(1);
    const failing = gate.run(async () => { throw new Error('boom'); });
    const next = gate.run(async () => 'after');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('after');
    expect(gate.stats().active).toBe(0);
  });

  it('releases a slot once even when the release function is called twice', async () => {
    const gate = createConcurrencyGate(1);
    const release = await gate.acquire();
    const waiter = gate.acquire();
    release();
    release();
    const second = await waiter;
    const third = gate.acquire();
    await tick();
    expect(gate.stats()).toEqual({ active: 1, waiting: 1, peakActive: 1 });
    second();
    (await third)();
    expect(gate.stats().active).toBe(0);
  });

  it('treats a limit of 0 as ungated', async () => {
    const gate = createConcurrencyGate(0);
    const releases = await Promise.all(Array.from({ length: 5 }, () => gate.acquire()));
    expect(gate.stats()).toEqual({ active: 5, waiting: 0, peakActive: 5 });
    for (const release of releases) release();
    expect(gate.limit).toBe(0);
  });

  it('reads the environment limit: blank or junk fall back, 0 disables', () => {
    expect(gateLimitFromEnv(undefined, 2)).toBe(2);
    expect(gateLimitFromEnv('  ', 2)).toBe(2);
    expect(gateLimitFromEnv('abc', 2)).toBe(2);
    expect(gateLimitFromEnv('-1', 2)).toBe(2);
    expect(gateLimitFromEnv('1.5', 2)).toBe(2);
    expect(gateLimitFromEnv('0', 2)).toBe(0);
    expect(gateLimitFromEnv('4', 2)).toBe(4);
  });
});

// Review B-06 (remediation run 2): the queue behind the gate is bounded in length and in time.
// A waiter beyond either bound is refused, holds no slot, and never remains queued.
describe('review B-06: the concurrency gate bounds its queue and its wait', () => {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('refuses a waiter beyond maxQueue with queue_full, without queueing it', async () => {
    const gate = createConcurrencyGate(1, { maxQueue: 2 });
    const holder = await gate.acquire();
    const w1 = gate.acquire();
    const w2 = gate.acquire();
    await expect(gate.acquire()).rejects.toMatchObject({ name: 'ConcurrencyGateBusyError', reason: 'queue_full' });
    await expect(gate.acquire()).rejects.toBeInstanceOf(ConcurrencyGateBusyError);
    expect(gate.stats()).toEqual({ active: 1, waiting: 2, peakActive: 1 });
    expect(gate.refusals()).toEqual({ queueFull: 2, timeout: 0 });
    // The two queued waiters are unaffected, and still go in arrival order.
    holder();
    const r1 = await w1;
    expect(gate.stats()).toEqual({ active: 1, waiting: 1, peakActive: 1 });
    r1();
    (await w2)();
    await tick();
    expect(gate.stats()).toEqual({ active: 0, waiting: 0, peakActive: 1 });
  });

  it('maxQueue 0 lets nobody wait: refused as soon as the slots are full', async () => {
    const gate = createConcurrencyGate(2, { maxQueue: 0 });
    const a = await gate.acquire();
    const b = await gate.acquire();
    await expect(gate.acquire()).rejects.toMatchObject({ reason: 'queue_full' });
    expect(gate.stats().waiting).toBe(0);
    a();
    const c = await gate.acquire();
    b();
    c();
    expect(gate.stats().active).toBe(0);
  });

  it('refuses a waiter whose wait runs out with timeout, and the slot it never took is not leaked', async () => {
    vi.useFakeTimers();
    try {
      const gate = createConcurrencyGate(1, { maxWaitMs: 100 });
      const holder = await gate.acquire();
      const waiter = gate.acquire();
      const settled = waiter.then(() => 'granted', (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(99);
      expect(gate.stats().waiting).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      const outcome = await settled;
      expect(outcome).toBeInstanceOf(ConcurrencyGateBusyError);
      expect((outcome as ConcurrencyGateBusyError).reason).toBe('timeout');
      expect(gate.stats()).toEqual({ active: 1, waiting: 0, peakActive: 1 });
      expect(gate.refusals()).toEqual({ queueFull: 0, timeout: 1 });
      // The holder still owns the one slot; releasing it frees exactly one, and the next caller gets it at once.
      holder();
      expect(gate.stats().active).toBe(0);
      const next = await gate.acquire();
      expect(gate.stats().active).toBe(1);
      next();
      expect(gate.stats().active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a timed-out waiter leaves the line without disturbing the others, and a granted waiter never times out later', async () => {
    vi.useFakeTimers();
    try {
      const gate = createConcurrencyGate(1, { maxWaitMs: 100 });
      const holder = await gate.acquire();
      const early = gate.acquire(); // times out at t=100
      const earlyOutcome = early.then(() => 'granted', (error: unknown) => (error as ConcurrencyGateBusyError).reason);
      await vi.advanceTimersByTimeAsync(60);
      const late = gate.acquire(); // would time out at t=160
      await vi.advanceTimersByTimeAsync(40); // t=100: early is refused, late still queued
      expect(await earlyOutcome).toBe('timeout');
      expect(gate.stats()).toEqual({ active: 1, waiting: 1, peakActive: 1 });
      holder(); // t=100: late is next in line and is granted
      const release = await late;
      expect(gate.stats()).toEqual({ active: 1, waiting: 0, peakActive: 1 });
      await vi.advanceTimersByTimeAsync(500); // well past late's own deadline: its timer must be gone
      expect(gate.refusals()).toEqual({ queueFull: 0, timeout: 1 });
      expect(gate.stats().active).toBe(1);
      release();
      expect(gate.stats().active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the normal flow unchanged when the bounds are generous', async () => {
    const gate = createConcurrencyGate(2, { maxQueue: 50, maxWaitMs: 60_000 });
    const started: number[] = [];
    const tasks = Array.from({ length: 7 }, (_, i) => gate.run(async () => {
      started.push(i);
      for (let n = 0; n < 3; n += 1) await tick();
      return i;
    }));
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(gate.stats()).toEqual({ active: 0, waiting: 0, peakActive: 2 });
    expect(gate.refusals()).toEqual({ queueFull: 0, timeout: 0 });
  });

  it('run() passes a refusal on and holds nothing', async () => {
    const gate = createConcurrencyGate(1, { maxQueue: 0 });
    const holder = await gate.acquire();
    let ran = false;
    await expect(gate.run(async () => { ran = true; })).rejects.toMatchObject({ reason: 'queue_full' });
    expect(ran).toBe(false);
    holder();
    expect(gate.stats().active).toBe(0);
  });

  it('an ungated gate (limit 0) never queues, so the bounds never apply', async () => {
    const gate = createConcurrencyGate(0, { maxQueue: 0, maxWaitMs: 1 });
    const releases = await Promise.all(Array.from({ length: 4 }, () => gate.acquire()));
    expect(gate.stats()).toEqual({ active: 4, waiting: 0, peakActive: 4 });
    for (const release of releases) release();
  });

  it('reads the wait bound from the environment: blank, junk, zero and negative fall back', () => {
    expect(gateWaitMsFromEnv(undefined, 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv(' ', 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv('abc', 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv('0', 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv('-5', 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv('2.5', 10_000)).toBe(10_000);
    expect(gateWaitMsFromEnv('2500', 10_000)).toBe(2500);
  });
});
