import { NextResponse } from 'next/server';

/**
 * Redirect to an internal path WITHOUT naming an origin.
 *
 * `NextResponse.redirect()` needs an absolute URL, and the obvious sources for
 * one are all wrong here:
 *
 *   request.nextUrl / request.url   Next builds these from its own bind
 *                                   address, not the address the visitor
 *                                   used, so behind the reverse proxy they
 *                                   emit `http://localhost:3100/...` and leak
 *                                   the internal origin into Location. A
 *                                   visitor on the public address would be
 *                                   sent somewhere they cannot reach.
 *   X-Forwarded-Host                Client-supplied and therefore
 *                                   attacker-controlled: building Location
 *                                   from it turns every gate redirect into an
 *                                   open redirect (`X-Forwarded-Host:
 *                                   evil.com`). Never trust it for this.
 *
 * A relative Location sidesteps both. RFC 7231 allows a relative reference,
 * and the browser resolves it against the origin it actually requested — so
 * this is correct on localhost, on the LAN address, and on the production
 * domain with no configuration and nothing to spoof.
 *
 * `pathname` must be an internal absolute path (a leading '/'), never a
 * caller-supplied URL.
 */
export function redirectTo(pathname: string, search = ''): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${pathname}${search}` },
  });
}
