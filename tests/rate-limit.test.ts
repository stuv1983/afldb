import { describe, expect, it } from 'vitest';

import { RateLimiter } from '@/lib/auth/rate-limit';

describe('RateLimiter.check', () => {
  it('allows up to the limit and refuses past it', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('a')).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check('a');
    limiter.check('a');
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(false);
  });

  it('stays bounded under a flood of distinct keys', () => {
    const limiter = new RateLimiter(5, 60_000, 10);
    for (let i = 0; i < 100; i++) limiter.check(`key-${i}`);
    // The oldest key is evicted rather than the map growing without
    // limit; the most recent one is still being counted.
    expect(limiter.peek('key-0')).toBe(false);
    for (let i = 0; i < 6; i++) limiter.check('key-99');
    expect(limiter.peek('key-99')).toBe(true);
  });
});

describe('RateLimiter.peek', () => {
  it('reports the state without recording a hit', () => {
    const limiter = new RateLimiter(2, 60_000);
    // The whole point: a caller that peeks as its gate must not spend
    // the budget it is checking. Peeking a hundred times leaves the key
    // exactly where check() left it.
    for (let i = 0; i < 100; i++) expect(limiter.peek('a')).toBe(false);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.peek('a')).toBe(false);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.peek('a')).toBe(true);
  });

  it('is false for a key that has never been seen', () => {
    expect(new RateLimiter(1, 60_000).peek('never')).toBe(false);
  });

  it('is false again once the window has passed', () => {
    const limiter = new RateLimiter(1, 1);
    limiter.check('a');
    limiter.check('a');
    expect(limiter.peek('a')).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.peek('a')).toBe(false);
        resolve();
      }, 10);
    });
  });
});
