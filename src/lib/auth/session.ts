import 'server-only';

import { cookies, headers } from 'next/headers';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import {
  ADMIN_COOKIE,
  ADMIN_TTL_SECONDS,
  BETA_COOKIE,
  BETA_TTL_SECONDS,
  signClaim,
  verifyClaim,
} from '@/lib/auth/tokens';

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
  // The dev server serves plain HTTP inside the LAN; Secure cookies
  // would silently fail there. Production always sets them.
  return (process.env.AFLDB_BASE_URL ?? '').startsWith('https://');
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return h.get('x-real-ip');
}

// ---------------------------------------------------------------------------
// Beta epoch
// ---------------------------------------------------------------------------

/**
 * Current beta revocation epoch.
 *
 * Bumping AFLDB_BETA_EPOCH invalidates every outstanding beta cookie at
 * once — the kill switch if a code leaks somewhere unpleasant. Individual
 * codes are revoked in the database and stop admitting anyone new; the
 * epoch is for revoking what has already been admitted.
 */
export function betaEpoch(): number {
  return Number(process.env.AFLDB_BETA_EPOCH ?? 1);
}

export function betaGateEnabled(): boolean {
  return process.env.AFLDB_BETA_GATE === 'on';
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
