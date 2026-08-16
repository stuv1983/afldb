import { NextResponse } from 'next/server';

/**
 * Redirect to an internal path, using the site's own public origin.
 *
 * The three obvious sources are all unusable here:
 *   - `request.nextUrl`/`request.url` carry Next's bind address, so behind the
 *     proxy they redirect visitors to `http://localhost:3100/...`;
 *   - `X-Forwarded-Host` is client-supplied, so trusting it makes every gate
 *     redirect an open redirect;
 *   - a relative Location is legal HTTP but Next throws ERR_INVALID_URL on one
 *     from middleware.
 *
 * That leaves the operator-set `AFLDB_BASE_URL`, which is never derived from
 * the request and so cannot be spoofed; the request origin is the fallback.
 *
 * `pathname` must be an internal absolute path, never a caller-supplied URL.
 */
function publicOrigin(requestUrl: string): string {
  const configured = process.env.AFLDB_BASE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured base URL: fall back rather than break the redirect.
    }
  }
  return new URL(requestUrl).origin;
}

export function redirectTo(
  request: { url: string },
  pathname: string,
  search = '',
): NextResponse {
  const target = new URL(`${pathname}${search}`, publicOrigin(request.url));
  return NextResponse.redirect(target, 307);
}
