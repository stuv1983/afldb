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
 * The client's IP, for the audit trail.
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
 */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',');
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  return h.get('x-real-ip');
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

  const [row] = await authSql<AdminUser[]>`
    SELECT u.id, u.email
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
     WHERE s.token_hash = ${sha256Hex(token)}
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.disabled_at IS NULL
       AND u.role = 'admin'
  `;
  return row ?? null;
}

/**
 * Require an admin session, or redirect to the login form.
 *
 * This is the ONE guard every admin page and server action must call. The
 * middleware cookie check is not enough: it verifies only the signed cookie,
 * whereas this re-checks the database row, which is the only layer that
 * honours revocation and disablement. It was hand-copied into seven files;
 * centralising it means a new admin route cannot quietly ship with a weaker
 * (or missing) check.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) redirect('/admin/login');
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
