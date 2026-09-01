import 'server-only';

import { RateLimiter } from '@/lib/auth/rate-limit';
import { requestIp } from '@/lib/auth/session';

const NL_SEARCH_LIMIT = new RateLimiter(30, 60_000);

export type NlSearchRateLimitResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'rate_limited' };

export async function runNlSearchWithRateLimit<T>(
  search: () => Promise<T>,
): Promise<NlSearchRateLimitResult<T>> {
  try {
    const ip = (await requestIp()) ?? 'unknown';
    if (NL_SEARCH_LIMIT.check(`ip:${ip}`)) {
      return { status: 'rate_limited' };
    }
  } catch (error) {
    // ISSUE-120 safety contract: limiter/IP failures must fail open so
    // availability is preserved rather than turning a valid search into 500.
    console.error('[search] rate limiter unavailable; failing open', error);
  }

  return {
    status: 'ok',
    value: await search(),
  };
}
