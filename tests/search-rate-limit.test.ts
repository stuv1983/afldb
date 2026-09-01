import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  requestIp: vi.fn(),
  constructorArgs: [] as Array<[number, number, number | undefined]>,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/rate-limit', () => ({
  RateLimiter: class {
    constructor(max: number, windowMs: number, maxKeys?: number) {
      mocks.constructorArgs.push([max, windowMs, maxKeys]);
    }

    check(key: string) {
      return mocks.check(key);
    }
  },
}));

vi.mock('@/lib/auth/session', () => ({
  requestIp: mocks.requestIp,
}));

import { runNlSearchWithRateLimit } from '@/app/search/rate-limit';

describe('runNlSearchWithRateLimit', () => {
  beforeEach(() => {
    mocks.check.mockReset();
    mocks.requestIp.mockReset();
    mocks.constructorArgs.length = 0;

    mocks.requestIp.mockResolvedValue('203.0.113.25');
    mocks.check.mockReturnValue(false);
  });

  it('allows a request under the limit and executes the search once', async () => {
    const search = vi.fn().mockResolvedValue({ answer: 'ok' });

    const result = await runNlSearchWithRateLimit(search);

    expect(mocks.requestIp).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenCalledWith('ip:203.0.113.25');
    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'ok',
      value: { answer: 'ok' },
    });
  });

  it('denies an over-limit request before any search work runs', async () => {
    mocks.check.mockReturnValue(true);
    const search = vi.fn().mockResolvedValue({ answer: 'must not run' });

    const result = await runNlSearchWithRateLimit(search);

    expect(mocks.check).toHaveBeenCalledWith('ip:203.0.113.25');
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'rate_limited' });
  });

  it('uses one shared unknown-IP bucket when no client IP is available', async () => {
    mocks.requestIp.mockResolvedValue(null);
    const search = vi.fn().mockResolvedValue('ok');

    const result = await runNlSearchWithRateLimit(search);

    expect(mocks.check).toHaveBeenCalledWith('ip:unknown');
    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'ok', value: 'ok' });
  });

  it('fails open if IP resolution or the limiter throws', async () => {
    mocks.requestIp.mockRejectedValue(new Error('headers unavailable'));
    const search = vi.fn().mockResolvedValue('still available');

    const result = await runNlSearchWithRateLimit(search);

    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'ok',
      value: 'still available',
    });
  });

  it('fails open if the limiter check itself throws', async () => {
    mocks.check.mockImplementation(() => {
      throw new Error('limiter unavailable');
    });
    const search = vi.fn().mockResolvedValue('still available');

    const result = await runNlSearchWithRateLimit(search);

    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'ok',
      value: 'still available',
    });
  });
});

describe('NL search limiter configuration', () => {
  it('uses the ISSUE-120 30-per-minute budget', async () => {
    vi.resetModules();

    await import('@/app/search/rate-limit');

    expect(mocks.constructorArgs).toContainEqual([30, 60_000, undefined]);
  });
});
