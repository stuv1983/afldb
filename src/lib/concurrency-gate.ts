/**
 * A first-in-first-out concurrency gate: at most `limit` holders run at once
 * and the rest wait their turn without holding anything (no database
 * connection, no timer). Pure and dependency-free.
 *
 * `limit` of 0 (or any non-positive or non-finite value) means "no gate": every
 * holder starts immediately, which is the pre-gate behaviour and the rollback
 * setting for callers that read their limit from the environment.
 *
 * AFLDB-ISSUE-361 (FE-6): the club comparison page fires a dozen composite
 * queries, each itself a handful of statements, at a pool of ten connections.
 * A few simultaneous comparisons queue far more statements than the pool can
 * start, and every unrelated page waits behind them. Gating whole comparisons
 * keeps that backlog short without changing any result.
 */
export type ConcurrencyGate = {
  /**
   * Wait for a slot and take it. The returned function gives the slot back and
   * is idempotent; the caller must call it (use try/finally).
   */
  acquire(): Promise<() => void>;
  /** Run `task` while holding a slot; resolves or rejects with the task's outcome. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** The configured limit; 0 means ungated. */
  readonly limit: number;
  /** Holders now, waiters now, and the highest holder count seen. */
  stats(): { active: number; waiting: number; peakActive: number };
};

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  const bounded = Number.isFinite(limit) && limit >= 1;
  const cap = bounded ? Math.floor(limit) : 0;
  const queue: Array<() => void> = [];
  let active = 0;
  let peakActive = 0;

  function take(): () => void {
    active += 1;
    peakActive = Math.max(peakActive, active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      // Hand the slot straight to the oldest waiter, so a new arrival can
      // never overtake the queue.
      queue.shift()?.();
    };
  }

  async function acquire(): Promise<() => void> {
    if (!bounded || active < cap) return take();
    return new Promise<() => void>((resolve) => {
      queue.push(() => resolve(take()));
    });
  }

  async function run<T>(task: () => Promise<T>): Promise<T> {
    const release = await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  return { acquire, run, limit: cap, stats: () => ({ active, waiting: queue.length, peakActive }) };
}

/**
 * Read a gate limit from an environment value. Unset or blank gives the
 * default; a non-negative integer is taken as written (0 disables the gate);
 * anything else gives the default rather than silently ungating.
 */
export function gateLimitFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
