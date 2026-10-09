import 'server-only';

import type postgres from 'postgres';

import { hasCapability } from '@/lib/auth/capabilities';
import { ROLE_RANK, type AdminUser } from '@/lib/auth/session';

/**
 * The account write behind accepting an admin invite (AFLDB-ISSUE-270).
 *
 * Accepting an invite upserts on email, so it is also a credential RESET of
 * any account already at that address: password hash, TOTP secret, role and
 * delegation are all replaced and every session is revoked. Who may do that
 * is decided HERE, at the write, not only when the invite was issued. Two
 * separate rules apply, in this order:
 *
 *   1. ISSUER AUTHORITY (operator decision D-270-2), for every redemption,
 *      including a free address and an existing contributor. The invite is
 *      redeemable only while its issuer (`admin_invites.invited_by`) could
 *      issue it NOW, read from the issuer's locked row:
 *        - an enabled `super_admin` may grant `admin` or `super_admin`, with
 *          or without `can_manage_admins`;
 *        - an enabled `admin` holding `can_manage_admins` may grant an
 *          ordinary `admin` only, without the delegation;
 *        - a missing or deactivated issuer, a contributor, or an admin
 *          without the delegation authorises nothing.
 *      "May manage admins" is the capability policy's own answer
 *      (`hasCapability(..., 'people.admins.manage')`); the super_admin-only
 *      grants are the line createInvite draws (invite-actions.ts).
 *   2. TARGET PROTECTION, when an account already holds the address:
 *        - an account that outranks the invite is never overwritten (an
 *          invite is never the way someone is demoted);
 *        - an existing `admin` or `super_admin` is overwritten only when the
 *          issuer is, now, an enabled `super_admin`. A delegated manager
 *          never reaches a peer;
 *        - an existing contributor may be enrolled by any authorised issuer.
 *
 * The issuer is the invite row's own `invited_by`, never anything the
 * redeeming browser submitted.
 *
 * CONCURRENCY. Inside one READ COMMITTED transaction:
 *
 *   (a) One statement locks every row visible to it -- the issuer and any
 *       existing target -- `FOR UPDATE`, `ORDER BY id` (the row locks are
 *       taken in the sorted order), the order runLifecycleSteps
 *       (src/db/queries/admin-users.ts) uses for the rows it locks. Holding
 *       the issuer row to commit is what keeps its authority stable: a
 *       demotion, deactivation or delegation change of the issuer, by any
 *       writer, waits for this transaction. Both rules are decided here, and
 *       a refusal returns before anything is written.
 *   (b) A row (a) could not see -- committed after its snapshot, or still
 *       uncommitted -- may already hold the address by the time of the
 *       write: `SELECT ... FOR UPDATE` locks nothing at an absent address.
 *       The upsert's `DO UPDATE ... WHERE auth_users.role = ANY(<overwritable
 *       roles>)` re-applies rule 2 to it. PostgreSQL waits for an uncommitted
 *       inserter to finish, takes the conflicting row's lock and evaluates the
 *       WHERE against its latest committed version, so the check and the write
 *       are one atomic step and need no advisory lock other writers would
 *       have to honour. A row the predicate rejects is left untouched (but
 *       stays locked by this transaction to its end) and RETURNING yields
 *       nothing, which is the refusal. Rule 1 needs no second check: the
 *       issuer row is already held from (a).
 *
 * Lock order and its limits. (a)'s locks follow id order among the rows
 * visible to it. (b)'s conflict lock is taken afterwards, on a row whose id
 * bears no guaranteed relation to the issuer's (identity values are handed
 * out when an insert runs, not when it becomes visible), so it can fall
 * outside that order. If another transaction holds that row and then waits
 * for a row this one holds -- for example its creator, still open, then
 * locking the issuer -- the two wait on each other and PostgreSQL's deadlock
 * detector aborts one of them (SQLSTATE 40P01). Either transaction aborts
 * as a whole and writes nothing; if it is this one, the redemption fails
 * and the invite stays unused. A lock wait that is not a deadlock -- another
 * transaction simply holding the issuer or target row -- is bounded by the
 * connection's statement_timeout (INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS,
 * below) and ends the same way. Nothing here prevents deadlocks in general;
 * what is guaranteed is that no outcome overwrites an account the rules
 * refuse. Session and invite rows are written only after every auth_users
 * lock is held, as the lifecycle and password-reset writers also do. A
 * self-targeted invite (issuer and target are one row) is one row locked
 * once.
 */

/**
 * The `statement_timeout` (ms) of the dedicated connection the redemption
 * transaction runs on: the bound src/db/authClient.ts sets for the pooled
 * auth connections. A statement still waiting at the bound -- for example on
 * an issuer or target row lock another transaction holds -- is cancelled by
 * the server (SQLSTATE 57014), the transaction rolls back as a whole, and the
 * caller reports a generic failure: never an enrolment, never a redirect.
 * Exported (from here, not from the 'use server' action module) so the
 * PostgreSQL suite runs the redemption under the same bound.
 */
export const INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS = 5000;

/** The admin_invites fields the redemption needs, as loadLiveInvite read them. */
export type RedeemableInvite = {
  id: number;
  email: string;
  role: AdminUser['role'];
  canManageAdmins: boolean;
  /** admin_invites.invited_by: the issuer, from the stored row. */
  invitedBy: number;
};

/** The issuer's account as it stands at redemption, or null if no row exists. */
export type InviteIssuerState = {
  role: AdminUser['role'];
  canManageAdmins: boolean;
  disabledAt: Date | string | null;
} | null;

/** Rule 1: the issuer cannot authorise this invite as it stands now. */
export type IssuerAuthorityRefusal =
  | 'issuer_missing'
  | 'issuer_deactivated'
  | 'issuer_not_admin_manager'
  | 'grant_exceeds_issuer';

/** Rule 2: the existing account at the address may not be overwritten by this invite. */
export type InviteOverwriteRefusal = 'outranked' | 'target_requires_super_admin';

export type InviteRedemptionRefusal = IssuerAuthorityRefusal | InviteOverwriteRefusal;

const ROLES: readonly AdminUser['role'][] = ['contributor', 'admin', 'super_admin'];

function isEnabled(issuer: NonNullable<InviteIssuerState>): boolean {
  return issuer.disabledAt === null || issuer.disabledAt === undefined;
}

/**
 * Rule 1: why the issuer, as it stands now, cannot authorise an invite
 * granting `grant`, or null when it can. Asked of every redemption, whatever
 * is (or is not) at the address.
 */
export function issuerAuthorityRefusal(
  issuer: InviteIssuerState,
  grant: { role: AdminUser['role']; canManageAdmins: boolean },
): IssuerAuthorityRefusal | null {
  if (issuer === null) return 'issuer_missing';
  if (!isEnabled(issuer)) return 'issuer_deactivated';
  if (!hasCapability(issuer, 'people.admins.manage')) return 'issuer_not_admin_manager';
  // createInvite's own line: only a super admin hands out super_admin or the
  // delegation; a delegated manager grants an ordinary admin and nothing more.
  if ((grant.role === 'super_admin' || grant.canManageAdmins) && issuer.role !== 'super_admin') {
    return 'grant_exceeds_issuer';
  }
  return null;
}

/**
 * Whether the issuer holds super-admin reset authority NOW: an enabled
 * super admin, the same reading as canActOnLifecycle. A missing row holds
 * nothing.
 */
export function issuerMayResetAdministrators(issuer: InviteIssuerState): boolean {
  return issuer !== null && issuer.role === 'super_admin' && isEnabled(issuer);
}

/**
 * Rule 2: why an existing account holding `existingRole` may not be
 * overwritten by an invite granting `inviteRole`, or null when it may.
 * Outranking is asked first so the established refusal keeps its wording.
 */
export function overwriteRefusal(
  existingRole: AdminUser['role'],
  inviteRole: AdminUser['role'],
  issuerMayReset: boolean,
): InviteOverwriteRefusal | null {
  if (ROLE_RANK[existingRole] > ROLE_RANK[inviteRole]) return 'outranked';
  if (existingRole !== 'contributor' && !issuerMayReset) return 'target_requires_super_admin';
  return null;
}

/**
 * The roles an existing account may hold for the upsert to overwrite it:
 * exactly those `overwriteRefusal` passes, so the pre-check and the
 * statement's WHERE cannot disagree. Never empty -- a contributor is always
 * overwritable -- so the bound array is never `'{}'`.
 */
export function overwritableRoles(
  inviteRole: AdminUser['role'],
  issuerMayReset: boolean,
): AdminUser['role'][] {
  return ROLES.filter((role) => overwriteRefusal(role, inviteRole, issuerMayReset) === null);
}

export type InviteRedemptionInput = {
  invite: RedeemableInvite;
  /** The invite's pending_password_hash and pending_totp_secret, already proven by a live code. */
  passwordHash: string;
  totpSecret: string;
  /** The TOTP step that code matched, recorded so it cannot be replayed. */
  totpStep: number;
};

export type InviteRedemptionResult =
  | { ok: true; userId: number }
  | {
    ok: false;
    reason: InviteRedemptionRefusal;
    /** The account at the address when refused; null when the address was free. */
    existingRole: AdminUser['role'] | null;
    /** The issuer as read under the lock; for the audit row, never for a decision elsewhere. */
    issuer: { role: AdminUser['role']; active: boolean; canManageAdmins: boolean } | null;
  };

/**
 * Test-only seam, as LifecycleTestHooks: `afterLock` lets the concurrency
 * suite hold step (a)'s locks open while another connection acts. The
 * production caller passes nothing.
 */
export type InviteRedemptionTestHooks = {
  afterLock?: () => Promise<void>;
};

type LockedRow = {
  id: number;
  email: string;
  role: AdminUser['role'];
  canManageAdmins: boolean;
  disabledAt: Date | null;
};

/** Raised when the guarded upsert refuses a row that cannot then be read back. */
const VANISHED_MARKER = 'AFLDB_INVITE_REDEMPTION_TARGET_VANISHED';

/**
 * The redemption transaction body. Call it inside a transaction the caller
 * owns; on a refusal it has written nothing, so committing or rolling back
 * that transaction is equivalent. A thrown error means the caller's
 * transaction must roll back; it is never a success.
 */
export async function redeemInviteInTransaction(
  tx: postgres.TransactionSql,
  input: InviteRedemptionInput,
  hooks: InviteRedemptionTestHooks = {},
): Promise<InviteRedemptionResult> {
  const { invite } = input;

  // (a) Issuer and any existing target, locked together in id order.
  const locked = await tx<LockedRow[]>`
    SELECT id, email, role, can_manage_admins AS "canManageAdmins",
           disabled_at AS "disabledAt"
      FROM auth_users
     WHERE id = ${invite.invitedBy} OR email = ${invite.email}
     ORDER BY id
       FOR UPDATE
  `;

  if (hooks.afterLock) await hooks.afterLock();

  const issuerRow = locked.find((row) => row.id === invite.invitedBy) ?? null;
  const existing = locked.find((row) => row.email === invite.email) ?? null;
  const refused = (
    reason: InviteRedemptionRefusal,
    existingRole: AdminUser['role'] | null,
  ): InviteRedemptionResult => ({
    ok: false,
    reason,
    existingRole,
    issuer: issuerRow
      ? { role: issuerRow.role, active: issuerRow.disabledAt === null, canManageAdmins: issuerRow.canManageAdmins }
      : null,
  });

  // Rule 1, every redemption: no current authority, no write of any kind.
  const authority = issuerAuthorityRefusal(issuerRow, invite);
  if (authority) return refused(authority, existing?.role ?? null);

  // Rule 2, an account the lock read could see.
  const issuerMayReset = issuerMayResetAdministrators(issuerRow);
  if (existing) {
    const reason = overwriteRefusal(existing.role, invite.role, issuerMayReset);
    if (reason) return refused(reason, existing.role);
  }

  // (b) The write, guarded by rule 2 for a row (a) could not see.
  const [user] = await tx<{ id: number }[]>`
    INSERT INTO auth_users (email, role, password_hash, totp_secret, can_manage_admins)
    VALUES (${invite.email}, ${invite.role}, ${input.passwordHash},
            ${input.totpSecret}, ${invite.canManageAdmins})
    ON CONFLICT (email) DO UPDATE
      SET role              = EXCLUDED.role,
          password_hash     = EXCLUDED.password_hash,
          totp_secret       = EXCLUDED.totp_secret,
          can_manage_admins = EXCLUDED.can_manage_admins,
          -- A new secret starts a new counter; see create-admin.ts for why.
          totp_last_step    = ${input.totpStep},
          -- The invitee chose this password themselves, so any temporary
          -- one issued in the meantime is discharged rather than carried
          -- over into an account whose password is already theirs.
          must_change_password = false,
          password_changed_at  = now(),
          disabled_at       = NULL
    WHERE auth_users.role = ANY(${overwritableRoles(invite.role, issuerMayReset)}::text[])
    RETURNING id
  `;

  if (!user) {
    // The conflicting row was invisible to (a). ON CONFLICT has locked it,
    // so this fresh read (a new snapshot under READ COMMITTED) is the
    // version the WHERE rejected.
    const [current] = await tx<{ role: AdminUser['role'] }[]>`
      SELECT role FROM auth_users WHERE email = ${invite.email}
    `;
    const reason = current ? overwriteRefusal(current.role, invite.role, issuerMayReset) : null;
    if (!current || !reason) throw new Error(VANISHED_MARKER);
    return refused(reason, current.role);
  }

  // Re-enrolling an existing email invalidates whatever sessions it had.
  await tx`
    UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = ${user.id} AND revoked_at IS NULL
  `;
  await tx`
    UPDATE admin_invites
       SET used_at = now(), pending_password_hash = NULL, pending_totp_secret = NULL
     WHERE id = ${invite.id}
  `;
  return { ok: true, userId: user.id };
}
