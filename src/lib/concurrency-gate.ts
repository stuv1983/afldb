/**
 * A first-in-first-out concurrency gate: at most `limit` holders run at once
 * and the rest wait their turn without holding anything (no database
 * connection). Pure and dependency-free.
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
 *
 * Review B-06 (remediation run 2): the queue itself was unbounded and a waiter
 * could wait forever, so a crawler walking the 153 club pairs held one open HTTP
 * request per waiter until the proxy gave up. `maxQueue` and `maxWaitMs` bound
 * both. A waiter beyond the queue bound, or still waiting after `maxWaitMs`,
 * is REFUSED (`acquire()` rejects with ConcurrencyGateBusyError): it never
 * takes a slot and never remains queued. Release semantics are unchanged.
 */
export type ConcurrencyGateOptions = {
  /**
   * Most waiters allowed at once while every slot is held. 0 means nobody may
   * wait (refuse as soon as the slots are full). Unset, negative or non-finite
   * means unbounded.
   */
  maxQueue?: number;
  /**
   * Longest a waiter may wait for a slot, in milliseconds. Unset, non-positive
   * or non-finite means no timeout.
   */
  maxWaitMs?: number;
};

export type ConcurrencyGateRefusal = 'queue_full' | 'timeout';

/** A waiter was refused: the queue was full or its wait ran out. It holds no slot. */
export class ConcurrencyGateBusyError extends Error {
  readonly reason: ConcurrencyGateRefusal;

  constructor(reason: ConcurrencyGateRefusal) {
    super(reason === 'queue_full' ? 'concurrency gate queue is full' : 'concurrency gate wait timed out');
    this.name = 'ConcurrencyGateBusyError';
    this.reason = reason;
  }
}

export type ConcurrencyGate = {
  /**
   * Wait for a slot and take it. The returned function gives the slot back and
   * is idempotent; the caller must call it (use try/finally). Rejects with
   * ConcurrencyGateBusyError when the queue bound or the wait bound is hit.
   */
  acquire(): Promise<() => void>;
  /** Run `task` while holding a slot; resolves or rejects with the task's outcome. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** The configured limit; 0 means ungated. */
  readonly limit: number;
  /** Holders now, waiters now, and the highest holder count seen. */
  stats(): { active: number; waiting: number; peakActive: number };
  /** How many waiters have been refused since the gate was created, by reason. */
  refusals(): { queueFull: number; timeout: number };
};

type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> | null };

export function createConcurrencyGate(limit: number, options: ConcurrencyGateOptions = {}): ConcurrencyGate {
  const bounded = Number.isFinite(limit) && limit >= 1;
  const cap = bounded ? Math.floor(limit) : 0;
  const maxQueue = typeof options.maxQueue === 'number' && Number.isFinite(options.maxQueue) && options.maxQueue >= 0
    ? Math.floor(options.maxQueue)
    : Infinity;
  const maxWaitMs = typeof options.maxWaitMs === 'number' && Number.isFinite(options.maxWaitMs) && options.maxWaitMs > 0
    ? options.maxWaitMs
    : 0;
  const queue: Waiter[] = [];
  let active = 0;
  let peakActive = 0;
  let refusedQueueFull = 0;
  let refusedTimeout = 0;

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
      const next = queue.shift();
      if (next) {
        if (next.timer !== null) clearTimeout(next.timer);
        next.grant();
      }
    };
  }

  async function acquire(): Promise<() => void> {
    if (!bounded || active < cap) return take();
    if (queue.length >= maxQueue) {
      refusedQueueFull += 1;
      throw new ConcurrencyGateBusyError('queue_full');
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { grant: () => resolve(take()), timer: null };
      if (maxWaitMs > 0) {
        waiter.timer = setTimeout(() => {
          // Still queued, so it holds no slot: just leave the line.
          const at = queue.indexOf(waiter);
          if (at === -1) return;
          queue.splice(at, 1);
          refusedTimeout += 1;
          reject(new ConcurrencyGateBusyError('timeout'));
        }, maxWaitMs);
      }
      queue.push(waiter);
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

  return {
    acquire,
    run,
    limit: cap,
    stats: () => ({ active, waiting: queue.length, peakActive }),
    refusals: () => ({ queueFull: refusedQueueFull, timeout: refusedTimeout }),
  };
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

/**
 * Read a wait bound in milliseconds from an environment value. Unset, blank,
 * zero, negative, fractional or junk gives the default: a bound that cannot be
 * parsed must never silently become "wait forever".
 */
export function gateWaitMsFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
