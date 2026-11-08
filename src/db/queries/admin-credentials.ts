import 'server-only';

import type postgres from 'postgres';

import { hasCapability } from '@/lib/auth/capabilities';
import { ROLE_RANK, type AdminUser } from '@/lib/auth/session';

/**
 * AFLDB-ISSUE-340: the one per-user credential/session decision.
 *
 * Every credential writer (login's TOTP claim and session insert, the own
 * password change, the manager-issued temporary password, and invite
 * redemption in admin-invites.ts) takes the `auth_users` row lock FOR UPDATE
 * before it reads what it is about to act on, and only then writes. The
 * three bodies here additionally compare the credential snapshot the caller
 * VERIFIED outside the lock (the stored password hash and, for login, the
 * TOTP secret) with the row as it stands under the lock. hashPassword()
 * salts every hash afresh (src/lib/auth/crypto.ts), so any committed rotation
 * -- even to the same password -- changes the stored hash, and the stored
 * hash is therefore a sufficient credential generation without a schema
 * change. A request that verified a credential which has since been
 * replaced refuses here, writing nothing.
 *
 * Ordering under READ COMMITTED: a body that waits on the row lock re-reads
 * the committed row once granted, and every later statement in it takes a
 * fresh snapshot, so a session row another body inserted and committed
 * before the lock was granted is visible to (and revoked by) the rotation's
 * UPDATE. A session inserted inside a body is covered by the same lock, so a
 * rotation cannot slip between "verified" and "session exists".
 *
 * Hashing (scrypt) stays OUTSIDE these bodies: the caller hashes first, the
 * body only compares and writes, so the lock is never held across scrypt.
 * The signed cookie is set by the caller only after its transaction
 * commits. Nothing here retries: a refusal is final for that request and
 * the user signs in (or tries the change) again.
 */

/** Test-only seam, as InviteRedemptionTestHooks: hold the lock open while another connection acts. */
export type CredentialTestHooks = {
  afterLock?: () => Promise<void>;
};

/** A new session row: the caller generates the token and keeps it for the cookie. */
export type NewSessionRow = {
  tokenHash: string;
  ttlSeconds: number;
  ip: string | null;
  userAgent: string | null;
};

type LockedCredentialRow = {
  id: number;
  email: string;
  role: AdminUser['role'];
  canManageAdmins: boolean;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  passwordHash: string | null;
  totpSecret: string | null;
};

/** The roles that may hold an interactive session (getAdminUser, adminLogin; AFLDB-ISSUE-186). */
function maySignIn(row: LockedCredentialRow): boolean {
  return row.disabledAt === null && (row.role === 'admin' || row.role === 'super_admin');
}

async function lockUsers(
  tx: postgres.TransactionSql,
  ids: number[],
): Promise<LockedCredentialRow[]> {
  // Stable id order, matching admin-invites.ts and admin-users.ts, so two
  // bodies locking the same pair cannot deadlock.
  return tx<LockedCredentialRow[]>`
    SELECT id, email, role, can_manage_admins AS "canManageAdmins",
           must_change_password AS "mustChangePassword",
           disabled_at AS "disabledAt",
           password_hash AS "passwordHash", totp_secret AS "totpSecret"
      FROM auth_users
     WHERE id = ANY(${ids}::int[])
     ORDER BY id
       FOR UPDATE
  `;
}

async function sessionIsLive(
  tx: postgres.TransactionSql,
  userId: number,
  tokenHash: string,
): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM auth_sessions
     WHERE token_hash = ${tokenHash} AND user_id = ${userId}
       AND revoked_at IS NULL AND expires_at > now()
  `;
  return rows.length > 0;
}

async function insertSession(
  tx: postgres.TransactionSql,
  userId: number,
  session: NewSessionRow,
): Promise<void> {
  await tx`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES (${session.tokenHash}, ${userId},
            now() + ${session.ttlSeconds} * interval '1 second',
            ${session.ip}, ${session.userAgent})
  `;
}

async function revokeAllSessions(tx: postgres.TransactionSql, userId: number): Promise<void> {
  await tx`
    UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = ${userId} AND revoked_at IS NULL
  `;
}

// --- Login ----------------------------------------------------------------

export type LoginSessionInput = {
  userId: number;
  /** The stored hash the password was verified against, outside the lock. */
  verifiedPasswordHash: string;
  /** The stored secret the TOTP code was verified against, outside the lock. */
  verifiedTotpSecret: string;
  totpStep: number;
  session: NewSessionRow;
};

export type LoginSessionResult =
  | { ok: true }
  | { ok: false; reason: 'credentials_changed' | 'totp_replay' };

/**
 * Claim the TOTP step and insert the session, but only if the account still
 * holds exactly the credentials the caller verified and may still sign in.
 */
export async function issueLoginSessionInTransaction(
  tx: postgres.TransactionSql,
  input: LoginSessionInput,
  hooks: CredentialTestHooks = {},
): Promise<LoginSessionResult> {
  const [row] = await lockUsers(tx, [input.userId]);
  if (hooks.afterLock) await hooks.afterLock();

  if (!row || !maySignIn(row)
      || row.passwordHash !== input.verifiedPasswordHash
      || row.totpSecret !== input.verifiedTotpSecret) {
    return { ok: false, reason: 'credentials_changed' };
  }

  // A one-time password must be usable exactly once (RFC 6238 §5.2); the
  // step is claimed in the statement that tests it, now under the row lock.
  const [claimed] = await tx<{ id: number }[]>`
    UPDATE auth_users
       SET totp_last_step = ${input.totpStep}
     WHERE id = ${input.userId}
       AND (totp_last_step IS NULL OR totp_last_step < ${input.totpStep})
    RETURNING id
  `;
  if (!claimed) return { ok: false, reason: 'totp_replay' };

  await insertSession(tx, input.userId, input.session);
  return { ok: true };
}

// --- Own password change --------------------------------------------------

export type OwnPasswordChangeInput = {
  userId: number;
  /** sha256 of the token in the session the request arrived on. */
  sessionTokenHash: string;
  /** The stored hash the current password was verified against, outside the lock. */
  verifiedPasswordHash: string;
  newPasswordHash: string;
  /** The replacement session, inserted after every existing one is revoked. */
  session: NewSessionRow;
};

export type OwnPasswordChangeResult = { ok: true } | { ok: false; reason: 'stale' };

/**
 * Replace the caller's own password, revoke every session and insert the
 * replacement -- only if the request's session is still live, the account
 * may still sign in, and the stored hash is still the one the current
 * password was verified against. A reset (or another change) committed in
 * the meantime therefore cannot be overwritten, and its must_change_password
 * cannot be cleared, by a request that verified the replaced password.
 */
export async function changeOwnPasswordInTransaction(
  tx: postgres.TransactionSql,
  input: OwnPasswordChangeInput,
  hooks: CredentialTestHooks = {},
): Promise<OwnPasswordChangeResult> {
  const [row] = await lockUsers(tx, [input.userId]);
  if (hooks.afterLock) await hooks.afterLock();

  if (!row || !maySignIn(row) || row.passwordHash !== input.verifiedPasswordHash
      || !(await sessionIsLive(tx, input.userId, input.sessionTokenHash))) {
    return { ok: false, reason: 'stale' };
  }

  await tx`
    UPDATE auth_users
       SET password_hash        = ${input.newPasswordHash},
           must_change_password = false,
           password_changed_at  = now()
     WHERE id = ${input.userId}
  `;
  // Every session, this one included; the caller gets the fresh one below.
  await revokeAllSessions(tx, input.userId);
  await insertSession(tx, input.userId, input.session);
  return { ok: true };
}

// --- Manager-issued temporary password ------------------------------------

export type TemporaryPasswordInput = {
  actorId: number;
  /** sha256 of the token in the session the actor's request arrived on. */
  actorSessionTokenHash: string;
  targetId: number;
  newPasswordHash: string;
};

export type TemporaryPasswordRefusal = 'actor_stale' | 'no_target' | 'self' | 'outranked';

export type TemporaryPasswordResult =
  | { ok: true; targetEmail: string }
  | { ok: false; reason: TemporaryPasswordRefusal; targetEmail: string | null; targetRole: AdminUser['role'] | null };

/**
 * Issue a temporary password, with the actor's authority and the target's
 * rank re-checked under both row locks (stable id order), then revoke the
 * target's sessions. The pre-transaction checks in password-actions.ts give
 * the ordinary refusal messages; these are the ones that decide.
 */
export async function issueTemporaryPasswordInTransaction(
  tx: postgres.TransactionSql,
  input: TemporaryPasswordInput,
  hooks: CredentialTestHooks = {},
): Promise<TemporaryPasswordResult> {
  const locked = await lockUsers(tx, [input.actorId, input.targetId]);
  if (hooks.afterLock) await hooks.afterLock();

  const actor = locked.find((row) => row.id === input.actorId) ?? null;
  const target = locked.find((row) => row.id === input.targetId) ?? null;
  const refused = (reason: TemporaryPasswordRefusal): TemporaryPasswordResult => ({
    ok: false, reason, targetEmail: target?.email ?? null, targetRole: target?.role ?? null,
  });

  // The actor must still be what requireCapability('people.admins.manage')
  // admitted: a live session, an enabled admin role, no outstanding
  // temporary password of its own, and the capability.
  if (!actor || !maySignIn(actor) || actor.mustChangePassword
      || !hasCapability(actor, 'people.admins.manage')
      || !(await sessionIsLive(tx, actor.id, input.actorSessionTokenHash))) {
    return refused('actor_stale');
  }
  if (!target) return refused('no_target');
  if (target.id === actor.id) return refused('self');
  if (actor.role !== 'super_admin' && ROLE_RANK[target.role] >= ROLE_RANK.admin) {
    return refused('outranked');
  }

  await tx`
    UPDATE auth_users
       SET password_hash        = ${input.newPasswordHash},
           must_change_password = true,
           password_changed_at  = now()
     WHERE id = ${target.id}
  `;
  await revokeAllSessions(tx, target.id);
  return { ok: true, targetEmail: target.email };
}
