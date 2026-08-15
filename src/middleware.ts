import { NextResponse, type NextRequest } from 'next/server';

import { ADMIN_COOKIE, BETA_COOKIE, betaEpoch, betaGateOn, verifyClaim } from '@/lib/auth/tokens';
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
      return redirectTo(request, '/admin/login');
    }
    return NextResponse.next();
  }

  // Beta gate, when enabled.
  if (betaGateOn() && !isPublicPath(pathname)) {
    if (!secret) {
      // Misconfiguration must fail closed, but explicably.
      return new NextResponse('Beta gate is on but AFLDB_SESSION_SECRET is not set.', {
        status: 503,
      });
    }
    // A present-but-invalid epoch throws rather than silently disabling the
    // kill switch (see betaEpoch). Fail closed and explicably, as above.
    let minEpoch: number;
    try {
      minEpoch = betaEpoch();
    } catch {
      return new NextResponse(
        'Beta gate is on but AFLDB_BETA_EPOCH is not a valid integer.',
        { status: 503 },
      );
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
      return redirectTo(request, '/beta', search);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets entirely; everything else passes through.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
