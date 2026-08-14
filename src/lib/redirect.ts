import { NextResponse } from 'next/server';

/**
 * Redirect to an internal path, using the site's own public origin.
 *
 * Getting the origin right here is fiddly, and two obvious approaches are
 * both wrong:
 *
 *   request.nextUrl / request.url   Next builds these from its own bind
 *                                   address, not the address the visitor
 *                                   used, so behind the reverse proxy they
 *                                   emit `http://localhost:3100/...` and send
 *                                   the visitor to an origin they cannot
 *                                   reach.
 *   X-Forwarded-Host                Client-supplied and therefore
 *                                   attacker-controlled: building Location
 *                                   from it turns every gate redirect into an
 *                                   open redirect (`X-Forwarded-Host:
 *                                   evil.com`). Never trust it for this.
 *
 * A relative Location would sidestep both and is legal HTTP (RFC 7231), but
 * Next parses the Location header of a middleware response as an absolute URL
 * and throws ERR_INVALID_URL on a relative one, so it is not an option here.
 *
 * That leaves AFLDB_BASE_URL: the canonical public base URL, set by the
 * operator and never derived from the request, so it cannot be spoofed. The
 * request's own origin is the fallback when it is unset or unparseable, which
 * preserves the previous behaviour rather than failing the redirect outright.
 *
 * `pathname` must be an internal absolute path (a leading '/'), never a
 * caller-supplied URL.
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
