import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logAppHealthEvent: vi.fn(),
  isAppHealthEventType: vi.fn((value: unknown) => value === 'client_error'),
  requestIp: vi.fn(),
  check: vi.fn(),
  cookieGet: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/db/queries/app-health', () => ({
  isAppHealthEventType: mocks.isAppHealthEventType,
  logAppHealthEvent: mocks.logAppHealthEvent,
}));

vi.mock('@/lib/auth/session', () => ({
  requestIp: mocks.requestIp,
}));

vi.mock('@/lib/auth/rate-limit', () => ({
  RateLimiter: class {
    check(key: string) {
      return mocks.check(key);
    }
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
  })),
}));

import { POST } from '@/app/api/health-event/route';

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/health-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('POST /api/health-event body bound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIp.mockResolvedValue('203.0.113.20');
    mocks.check.mockReturnValue(false);
    mocks.cookieGet.mockReturnValue(undefined);
  });

  it('rejects a body larger than 32 KiB before parsing or writing', async () => {
    const oversized = JSON.stringify({
      eventType: 'client_error',
      detail: 'x'.repeat(32 * 1024),
    });

    const res = await POST(request(oversized));

    expect(res.status).toBe(413);
    expect(mocks.logAppHealthEvent).not.toHaveBeenCalled();
  });

  it('rejects an oversized streamed body even without Content-Length', async () => {
    const encoder = new TextEncoder();
    const prefix = encoder.encode('{"eventType":"client_error","detail":"');
    const payload = encoder.encode('x'.repeat(32 * 1024));
    const suffix = encoder.encode('"}');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        controller.enqueue(payload);
        controller.enqueue(suffix);
        controller.close();
      },
    });

    const res = await POST(new Request('http://localhost/api/health-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));

    expect(res.status).toBe(413);
    expect(mocks.logAppHealthEvent).not.toHaveBeenCalled();
  });

  it('preserves the normal valid health-event path', async () => {
    const res = await POST(request(JSON.stringify({
      eventType: 'client_error',
      route: '/search',
      detail: 'render failed',
      recovered: false,
    })));

    expect(res.status).toBe(204);
    expect(mocks.logAppHealthEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logAppHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'client_error',
        route: '/search',
        detail: 'render failed',
        recovered: false,
      }),
    );
  });
});
