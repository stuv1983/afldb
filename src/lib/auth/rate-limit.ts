import 'server-only';

/**
 * A small, bounded, per-worker rate limiter.
 *
 * Two properties the old inline Maps lacked:
 *
 *   Bounded   Expired entries are swept and the key count is capped, so a
 *             flood of distinct keys (unique emails, rotated code prefixes)
 *             cannot grow a worker's heap without limit.
 *   Shared    One implementation, so the login, beta-redeem, magic-link,
 *             verify and autocomplete paths cannot drift apart.
 *
 * It is best-effort throttling INSIDE one process, not a cluster-wide
 * guarantee: with AFLDB_WORKERS processes the effective cap is multiplied and
 * a restart resets it. It exists to blunt single-source bursts and keep the
 * audit log readable. That is why callers key it on the real client IP
 * (see requestIp): work that is genuinely expensive per request (scrypt) must
 * be bounded by the caller's identity BEFORE it runs, never by
 * attacker-chosen content such as an email or a code prefix. A shared store
 * (e.g. Redis) is the next step if the beta ever outgrows a few workers.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records a hit for `key`; returns true once it is over the limit. */
  check(key: string): boolean {
    const now = Date.now();
    this.sweep(now);

    const hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) {
        // Insertion-ordered Map: drop the oldest key so the map stays bounded
        // even under a flood of distinct keys.
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }

    hit.count += 1;
    return hit.count > this.max;
  }

  /**
   * Drop expired entries at most once per window, so sweeping is O(1)
   * amortised rather than O(n) on every request.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, hit] of this.hits) {
      if (hit.resetAt <= now) this.hits.delete(key);
    }
  }
}
