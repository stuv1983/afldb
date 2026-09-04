import { NextResponse, type NextRequest } from 'next/server';

import { ADMIN_COOKIE, BETA_COOKIE, betaEpoch, betaGateOn, verifyClaim } from '@/lib/auth/tokens';
import { analyticsAllowed, CONSENT_COOKIE } from '@/lib/consent';
import { secureCookies } from '@/lib/cookie-security';
import { NL_SESSION_COOKIE, NL_SESSION_MAX_AGE_SECONDS } from '@/lib/nl-session';
import { redirectTo } from '@/lib/redirect';

/**
 * Access control at the door.
 *
 * Two independent gates:
 *
 *   Beta   When AFLDB_BETA_GATE=on, the whole site requires a beta
 *          cookie. Unauthenticated visitors land on /beta, which is the
 *          only public page.
 *   Admin  /admin/* always requires an admin cookie, gate or no gate.
 *          The cookie only gets the request through the door — every
 *          admin page re-checks its session against the database, where
 *          it can be individually revoked.
 *
 * Middleware runs on the edge runtime: no database here, by design.
 * Everything it needs is inside the HMAC-signed cookie.
 */

// Paths that must work for a visitor who has not been admitted yet.
const PUBLIC_PREFIXES = [
  '/beta',           // the gate itself, and its magic-link verifier
  '/admin/login',    // admins must be able to reach the login form
  '/admin/invite',   // invite acceptance: gated by the unguessable token in the path, not a session
  '/api/health',     // uptime checks predate any visitor
  '/api/health-event', // client-side failure reports; a broken page must still be able to report itself
  '/api/admin/email-intake', // machine-to-machine, gated by its own shared secret, not a session
  '/api/internal/revalidate-season', // the settle publishing its own season; loopback + shared secret (AFLDB-ISSUE-134)
  '/api/early-access', // the apex coming-soon page's form; queues a request, admits nobody
  '/robots.txt',     // crawlers must read the disallow, not a redirect
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  // Next's own assets are fingerprinted and carry no data; blocking them
  // would only break the /beta page's own styling.
  if (pathname.startsWith('/_next/')) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Ensures every response carries the anonymous NL-search correlation
 * cookie, minting one on a visitor's first request. Applied uniformly to
 * every branch below (redirects included) rather than only to
 * NextResponse.next(), since the search box is reachable from any page,
 * not only /search itself -- the cookie has to exist before a reader's
 * first search, not after.
 *
 * GATED ON CONSENT, and gated HERE rather than in a client script,
 * because this is the only place the cookie is ever created -- a banner
 * that merely hides itself while middleware keeps minting would be
 * decoration, not consent. nl_sid is analytics: the site works exactly
 * the same without it and only the telemetry is poorer, which is what
 * makes it the kind of storage that has to be asked for.
 *
 * analyticsAllowed fails closed, so a visitor who has not answered yet
 * gets no cookie -- and a reader who later declines stops getting one,
 * since this runs on every request rather than once.
 *
 * Not minting is only half of it: an nl_sid that is ALREADY there without
 * consent is deleted here. Two ways that happens, and both are real --
 * every visitor holding an nl_sid from before consent existed has no
 * answer recorded, and a cookie set by a response already in flight when
 * the reader pressed Decline survives the one-shot delete in setConsent.
 * Left alone, both keep being sent and keep being written into
 * nl_search_log for up to 30 minutes, which is storage retained without
 * consent -- the exact thing the banner claims to gate. Doing it on every
 * request instead makes the guarantee self-healing rather than a promise
 * about the moment a button was pressed.
 */
function withNlSession(request: NextRequest, response: NextResponse): NextResponse {
  const existing = request.cookies.get(NL_SESSION_COOKIE);

  if (!analyticsAllowed(request.cookies.get(CONSENT_COOKIE)?.value)) {
    // Path-qualified: it was set with path '/', and a delete whose path
    // does not match removes nothing.
    if (existing) response.cookies.delete({ name: NL_SESSION_COOKIE, path: '/' });
    return response;
  }

  if (!existing) {
    response.cookies.set(NL_SESSION_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      maxAge: NL_SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const secret = process.env.AFLDB_SESSION_SECRET ?? '';

  // Admin area: always gated. Without a plausible cookie there is no
  // reason to render anything, including 404s that would map the area.
  if (pathname.startsWith('/admin') && !isPublicPath(pathname)) {
    const claim = secret
      ? await verifyClaim(request.cookies.get(ADMIN_COOKIE)?.value, secret, { kind: 'admin' })
      : null;
    if (!claim) {
      return withNlSession(request, redirectTo(request, '/admin/login'));
    }
    return withNlSession(request, NextResponse.next());
  }

  // Beta gate, when enabled.
  if (betaGateOn() && !isPublicPath(pathname)) {
    if (!secret) {
      // Misconfiguration must fail closed, but explicably.
      return withNlSession(request, new NextResponse('Beta gate is on but AFLDB_SESSION_SECRET is not set.', {
        status: 503,
      }));
    }
    // A present-but-invalid epoch throws rather than silently disabling the
    // kill switch (see betaEpoch). Fail closed and explicably, as above.
    let minEpoch: number;
    try {
      minEpoch = betaEpoch();
    } catch {
      return withNlSession(request, new NextResponse(
        'Beta gate is on but AFLDB_BETA_EPOCH is not a valid integer.',
        { status: 503 },
      ));
    }
    const beta = await verifyClaim(
      request.cookies.get(BETA_COOKIE)?.value, secret, { kind: 'beta', minEpoch },
    );
    // An admin session passes the beta gate: the people running the beta
    // should not need to admit themselves to it.
    const admin = beta ? null : await verifyClaim(
      request.cookies.get(ADMIN_COOKIE)?.value, secret, { kind: 'admin' },
    );
    if (!beta && !admin) {
      // Return the visitor to what they asked for once admitted.
      const search = pathname === '/' ? '' : `?from=${encodeURIComponent(pathname)}`;
      return withNlSession(request, redirectTo(request, '/beta', search));
    }
  }

  return withNlSession(request, NextResponse.next());
}

export const config = {
  // Skip static assets entirely; everything else passes through.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
