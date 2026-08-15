import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import {
  ADMIN_COOKIE,
  ADMIN_TTL_SECONDS,
  BETA_COOKIE,
  BETA_TTL_SECONDS,
  betaEpoch,
  betaGateOn,
  signClaim,
  verifyClaim,
} from '@/lib/auth/tokens';

// Re-exported so server-side callers keep one import site for these; the
// definitions themselves live in the edge-safe tokens module so middleware
// and this module cannot disagree about the gate flag or the epoch default.
export { betaEpoch };

/**
 * Sessions, in two layers.
 *
 * The signed cookie gets a request past middleware; the database row is
 * what an ADMIN action actually trusts, because a row can be revoked
 * one session at a time. requireAdmin() checks both.
 */

export function sessionSecret(): string {
  const secret = process.env.AFLDB_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AFLDB_SESSION_SECRET is not set (or too short). '
      + 'Run tools/maintenance/02_add_auth_role.sh on the server.',
    );
  }
  return secret;
}

function secureCookies(): boolean {
  // Keyed on AFLDB_ENV, the single source of truth for production posture
  // (HSTS and indexing key off it too). The dev server serves plain HTTP on
  // the LAN, where a Secure cookie would silently fail to set; deriving this
  // from AFLDB_BASE_URL instead let a production deploy that set AFLDB_ENV but
  // fumbled AFLDB_BASE_URL ship non-Secure session cookies while looking fine.
  return process.env.AFLDB_ENV === 'production';
}

/**
 * The client's IP, for the audit trail and for keying the rate limiters.
 *
 * Behind our single reverse proxy (deploy/Caddyfile) the trustworthy value is
 * the LAST entry of X-Forwarded-For — the address Caddy itself observed —
 * because any earlier entries are whatever the client chose to send. Taking
 * the FIRST (leftmost) entry, as this used to, recorded a fully
 * attacker-controlled value: a request with `X-Forwarded-For: 8.8.8.8` poisoned
 * auth_sessions.ip and auth_audit_log.ip. Caddy is also configured to
 * overwrite the header, so in production only its own value is present; the
 * rightmost read is defence in depth for that. Assumes exactly one trusted
 * proxy hop.
 *
 * X-Real-IP is deliberately NOT consulted. The proxy sets X-Forwarded-For on
 * every request it passes, so the fallback could only ever fire for a request
 * that did not come through the proxy — exactly the case where the header is
 * client-supplied and forging it would let an attacker spread rate-limit
 * buckets and write a chosen address into the audit log. Caddy strips the
 * header inbound as well, so neither layer can be the one that fails.
 *
 * Returning null when there is no trustworthy value is the safe direction:
 * callers key their limiters on 'unknown', which shares one bucket rather
 * than minting a fresh one per forged header.
 *
 * next/headers()'s headers() throws outside a real Next.js request scope
 * (a bare script, a test invoking a Route Handler directly). audit() calls
 * this on every write path in the app purely to enrich a log column, so a
 * context it cannot read is exactly the "no trustworthy value" case above,
 * not a reason to fail whatever action was being audited — caught and
 * treated the same as an absent header.
 */
export async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    return lastForwardedIp(h.get('x-forwarded-for'));
  } catch {
    return null;
  }
}

/**
 * The same X-Forwarded-For logic as requestIp, exported separately for
 * Route Handlers, which uniquely receive the platform Request directly
 * and so can read its headers synchronously — unlike Server Components/
 * Actions, which have no Request object and must go through the async
 * next/headers() API (and, not incidentally, than which only works
 * inside a real Next.js request context: calling it from a hand-built
 * Request in a test throws "called outside a request scope").
 */
export function lastForwardedIp(forwardedFor: string | null): string | null {
  if (!forwardedFor) return null;
  const hops = forwardedFor.split(',');
  const last = hops[hops.length - 1]?.trim();
  return last || null;
}

// ---------------------------------------------------------------------------
// Beta epoch and gate
//
// Both read the environment through the edge-safe helpers in tokens.ts so the
// mint side here and the check side in middleware share one definition.
// betaEpoch is re-exported at the top of this module; a non-numeric
// AFLDB_BETA_EPOCH makes it throw, which fails admission closed.
// ---------------------------------------------------------------------------

export function betaGateEnabled(): boolean {
  return betaGateOn();
}

// ---------------------------------------------------------------------------
// Beta admission
// ---------------------------------------------------------------------------

export async function grantBetaAccess(subject: string): Promise<void> {
  const token = await signClaim({
    v: 1,
    kind: 'beta',
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + BETA_TTL_SECONDS,
    epoch: betaEpoch(),
  }, sessionSecret());

  const jar = await cookies();
  jar.set(BETA_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: BETA_TTL_SECONDS,
    path: '/',
  });
}

export async function hasBetaAccess(): Promise<boolean> {
  const jar = await cookies();
  const claim = await verifyClaim(
    jar.get(BETA_COOKIE)?.value,
    sessionSecret(),
    { kind: 'beta', minEpoch: betaEpoch() },
  );
  return claim !== null;
}

// ---------------------------------------------------------------------------
// Admin sessions
// ---------------------------------------------------------------------------

export type AdminUser = {
  id: number;
  email: string;
  role: 'admin' | 'super_admin' | 'contributor';
  canManageAdmins: boolean;
};

/** Create a database session and set the admin cookie. */
export async function createAdminSession(userId: number, email: string): Promise<void> {
  const token = generateToken();
  const ip = await requestIp();
  const h = await headers();

  await authSql`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES (${sha256Hex(token)}, ${userId},
            now() + ${ADMIN_TTL_SECONDS} * interval '1 second',
            ${ip}, ${h.get('user-agent')?.slice(0, 300) ?? null})
  `;

  // The cookie carries the claim AND the opaque token: the claim is what
  // middleware can check without a database, the token is what the
  // database session check uses.
  const claim = await signClaim({
    v: 1,
    kind: 'admin',
    sub: `${userId}:${token}`,
    exp: Math.floor(Date.now() / 1000) + ADMIN_TTL_SECONDS,
    epoch: 1,
  }, sessionSecret());

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, claim, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: ADMIN_TTL_SECONDS,
    path: '/',
  });
}

/**
 * The signed cookie is necessary but not sufficient: the database row
 * must exist, be unexpired and be unrevoked. Returns null rather than
 * throwing so callers choose between redirect and 401.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  const jar = await cookies();
  const claim = await verifyClaim(
    jar.get(ADMIN_COOKIE)?.value,
    sessionSecret(),
    { kind: 'admin' },
  );
  if (!claim) return null;

  const colon = claim.sub.indexOf(':');
  if (colon <= 0) return null;
  const token = claim.sub.slice(colon + 1);

  const [row] = await authSql<{
    id: number; email: string; role: 'admin' | 'super_admin' | 'contributor';
    canManageAdmins: boolean;
  }[]>`
    SELECT u.id, u.email, u.role, u.can_manage_admins AS "canManageAdmins"
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
     WHERE s.token_hash = ${sha256Hex(token)}
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.disabled_at IS NULL
       AND u.role IN ('admin', 'super_admin', 'contributor')
  `;
  return row ?? null;
}

/**
 * Require a signed-in staff session of any role, or redirect to the login
 * form -- no role check beyond that. This is deliberately narrower than
 * requireAdmin(): it exists only for the handful of routes a contributor
 * is meant to reach (the upload form and the status page of a submission
 * they made). Reach for requireAdmin() unless you specifically mean to
 * admit a contributor too.
 */
export async function requireUploader(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) redirect('/admin/login');
  return admin;
}

/**
 * Require an admin (or super admin) session, or redirect.
 *
 * This is the ONE guard every admin page and server action must call. The
 * middleware cookie check is not enough: it verifies only the signed cookie,
 * whereas this re-checks the database row, which is the only layer that
 * honours revocation and disablement. It was hand-copied into seven files;
 * centralising it means a new admin route cannot quietly ship with a weaker
 * (or missing) check.
 *
 * A contributor session passes getAdminUser() (it needs to, for
 * requireUploader() above) but is bounced to /admin/upload here rather
 * than admitted: this is what keeps a contributor out of every other
 * admin route without a matching check having to be added to each one.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await requireUploader();
  if (admin.role === 'contributor') redirect('/admin/upload');
  return admin;
}

/**
 * Require a super admin session, or redirect.
 *
 * Used by routes that must stay out of reach of a plain admin regardless
 * of any delegated power: promoting/creating other admins at the role
 * level, and the hidden data-QA query builder. Delegated
 * `can_manage_admins` grants the *invite* power to a plain admin (see
 * `hasAdminManagementAccess`) but never this.
 */
export async function requireSuperAdmin(): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (admin.role !== 'super_admin') redirect('/admin');
  return admin;
}

/** Whether an admin may invite/manage other admins: super admins always can; a plain admin only when delegated. */
export function hasAdminManagementAccess(admin: AdminUser): boolean {
  return admin.role === 'super_admin' || admin.canManageAdmins;
}

/** Require either a super admin or a delegated admin manager, or redirect. */
export async function requireAdminManager(): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (!hasAdminManagementAccess(admin)) redirect('/admin');
  return admin;
}

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  const claim = await verifyClaim(
    jar.get(ADMIN_COOKIE)?.value,
    sessionSecret(),
    { kind: 'admin' },
  );
  if (claim) {
    const token = claim.sub.slice(claim.sub.indexOf(':') + 1);
    await authSql`
      UPDATE auth_sessions SET revoked_at = now()
       WHERE token_hash = ${sha256Hex(token)} AND revoked_at IS NULL
    `;
  }
  jar.delete(ADMIN_COOKIE);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function audit(
  action: string,
  detail: Record<string, unknown> | null,
  actor: { userId?: number; label?: string },
): Promise<void> {
  const ip = await requestIp();
  await authSql`
    INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail, ip)
    VALUES (${actor.userId ?? null}, ${actor.label ?? null}, ${action},
            ${detail ? JSON.stringify(detail) : null}, ${ip})
  `;
}
