import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { cache } from 'react';

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
import { secureCookies } from '@/lib/cookie-security';

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

/**
 * The client's IP, for the audit trail and for keying the rate limiters.
 *
 * Assumes exactly one trusted proxy hop (deploy/Caddyfile). The trustworthy
 * value is therefore the LAST X-Forwarded-For entry, the address Caddy itself
 * observed; earlier entries are whatever the client sent. X-Real-IP is
 * deliberately not consulted as a fallback, since it could only fire for a
 * request that bypassed the proxy — precisely when it is forgeable.
 *
 * Returning null is the safe direction: callers key on 'unknown' and share one
 * rate-limit bucket rather than minting a fresh one per forged header. That
 * also covers `headers()` throwing outside a request scope, which audit() hits
 * on write paths where a missing log column must not fail the action.
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

// --- Beta epoch and gate ---
//
// Both read the environment through the edge-safe helpers in tokens.ts so the
// mint side here and the check side in middleware share one definition.
// betaEpoch is re-exported at the top of this module; a non-numeric
// AFLDB_BETA_EPOCH makes it throw, which fails admission closed.

export function betaGateEnabled(): boolean {
  return betaGateOn();
}

// --- Beta admission ---

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

// --- Admin sessions ---

export type AdminUser = {
  id: number;
  email: string;
  role: 'admin' | 'super_admin' | 'contributor';
  canManageAdmins: boolean;
  /** An admin-issued temporary password is outstanding; see migration 040. */
  mustChangePassword: boolean;
};

/** The one page an account carrying a temporary password may reach. */
export const CHANGE_PASSWORD_PATH = '/admin/password';

/**
 * The roles in privilege order, for the one comparison the invite flow
 * needs: accepting an invite upserts on email, so it can overwrite an
 * account that already exists at that address. Both ends of that flow ask
 * whether the account being written outranks what is being granted.
 */
export const ROLE_RANK: Record<AdminUser['role'], number> = {
  contributor: 0,
  admin: 1,
  super_admin: 2,
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
 *
 * Wrapped in React.cache so the several guards a single admin request runs
 * -- the layout's display-only read plus the page's own requireAdmin/
 * requireUploader -- share one lookup instead of repeating the identical
 * auth_sessions JOIN. The cache is per request, so nothing is held across
 * requests and a revoked session is still noticed on the next one.
 */
export const getAdminUser = cache(async function getAdminUser(): Promise<AdminUser | null> {
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
    canManageAdmins: boolean; mustChangePassword: boolean;
  }[]>`
    SELECT u.id, u.email, u.role, u.can_manage_admins AS "canManageAdmins",
           u.must_change_password AS "mustChangePassword"
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
     WHERE s.token_hash = ${sha256Hex(token)}
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.disabled_at IS NULL
       AND u.role IN ('admin', 'super_admin', 'contributor')
  `;
  return row ?? null;
});

/**
 * Require a signed-in staff session and nothing more -- no role check, and
 * no check on an outstanding temporary password.
 *
 * There is exactly one legitimate caller: the change-password page itself,
 * which an account holding a temporary password must be able to reach. Every
 * other route wants `requireUploader` or one of the guards above it, all of
 * which funnel through this one and then add the checks it omits.
 */
export async function requireSignedIn(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) redirect('/admin/login');
  return admin;
}

/**
 * Require a signed-in staff session of any role, or redirect to the login
 * form -- no role check beyond that. This is deliberately narrower than
 * requireAdmin(): it exists only for the handful of routes a contributor
 * is meant to reach (the upload form and the status page of a submission
 * they made). Reach for requireAdmin() unless you specifically mean to
 * admit a contributor too.
 *
 * An outstanding temporary password is enforced HERE rather than on the
 * login form, and the difference is the whole point of the flag. A prompt
 * after signing in is skipped by typing another URL; a redirect from the
 * guard that every admin route already calls is not. So a temporary
 * password buys exactly one ability -- replacing itself -- and the account
 * is otherwise as good as locked until it does. See migration 040.
 */
export async function requireUploader(): Promise<AdminUser> {
  const admin = await requireSignedIn();
  if (admin.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
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

// --- Audit ---

/**
 * Who an audit row names: the signed-in admin's id where there is one,
 * and the email label. Both are optional because the trail also records
 * events that happen before or instead of a session — a failed login, an
 * invite accepted by an email that has no user row yet.
 */
export type AuditActor = { userId?: number; label?: string };

/**
 * The one auth_audit_log INSERT.
 *
 * Both exported forms below funnel through here, so the row shape, the
 * actor columns and the request IP cannot drift apart between the pooled
 * path and the transactional one — an audit trail whose two writers
 * disagree is worse than one writer.
 *
 * `postgres.ISql` is the interface that both `Sql` (the authSql pool) and
 * `TransactionSql` (an authSql.begin() handle) extend. It carries the
 * tagged-template call and the query helpers and nothing else, so this
 * function cannot open a transaction, take a savepoint or end the pool
 * with whichever handle it is handed; it can only write the row.
 */
async function insertAuditRow(
  sql: postgres.ISql,
  action: string,
  detail: Record<string, unknown> | null,
  actor: AuditActor,
): Promise<void> {
  const ip = await requestIp();
  await sql`
    INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail, ip)
    VALUES (${actor.userId ?? null}, ${actor.label ?? null}, ${action},
            ${detail ? JSON.stringify(detail) : null}, ${ip})
  `;
}

/**
 * The administrative activity trail, written on the auth pool.
 *
 * This is the form nearly every admin action wants: the audit row is a
 * record of something that has already happened and stands on its own.
 */
export async function audit(
  action: string,
  detail: Record<string, unknown> | null,
  actor: AuditActor,
): Promise<void> {
  await insertAuditRow(authSql, action, detail, actor);
}

/**
 * The same audit row, written on a caller's transaction
 * (AFLDB-ISSUE-119 §8/§9; the same requirement AFLDB-ISSUE-027 met for
 * statistical mutations in src/db/queries/audit-log.ts).
 *
 * CONTRACT: pass a handle from authSql.begin(), never the pool. This
 * form exists for a mutation whose audit row must not be able to exist
 * without it, or the mutation without the audit row: the INSERT commits
 * with the mutation or rolls back with it. audit() above cannot do that
 * job, because it binds the module-level pool and so commits on its own
 * connection whatever the caller's transaction goes on to do.
 *
 * Deliberately no try/catch, matching src/db/queries/audit-log.ts: a
 * failed audit INSERT propagates, aborts the caller's transaction and
 * rolls the mutation back with it. That is the point. A best-effort
 * warning here would recreate exactly the gap this form removes.
 */
export async function auditInTransaction(
  tx: postgres.TransactionSql,
  action: string,
  detail: Record<string, unknown> | null,
  actor: AuditActor,
): Promise<void> {
  await insertAuditRow(tx, action, detail, actor);
}
