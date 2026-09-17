/**
 * The Super Admin account lifecycle policy (AFLDB-ISSUE-155 Phase B, §26).
 *
 * Pure on purpose, and deliberately free of `server-only`: the three places
 * that must agree about whether a control is offered, whether a mutation is
 * allowed and what the refusal says are a Client Component
 * (`LifecycleControls.tsx`), a transaction (`src/db/queries/admin-users.ts`)
 * and the unit tests. A rule written twice is a rule that will disagree with
 * itself, so it is written here once and imported by all three.
 *
 * Nothing here is a security boundary. The server re-reads actor and target
 * under a lock and asks these same functions again (§26.7); the client's
 * answer only decides whether a button renders enabled and what the
 * explanation beside it says.
 *
 * Deactivation, never deletion: there is no `delete` action in the union
 * below, and §26.4 records why (every attribution FK to `auth_users` is
 * NO ACTION, several of them NOT NULL, and `afldb_auth` holds no DELETE).
 */

export type LifecycleRole = 'contributor' | 'admin' | 'super_admin';

export type LifecycleAction = 'promote' | 'demote' | 'deactivate' | 'reactivate';

export const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  'promote', 'demote', 'deactivate', 'reactivate',
];

/** Why a lifecycle action is unavailable for an actor/target pair. */
export type LifecycleRefusal = 'self' | 'forbidden' | 'invalid_state' | 'last_super_admin';

/**
 * Every way a lifecycle request can fail, refusals included. `invalid`,
 * `not_found` and `stale` are decided against the submitted form and the
 * row read under the lock, so they are not part of `LifecycleRefusal`,
 * which is what the *eligibility* helper below can answer on its own.
 */
export type LifecycleFailureCode =
  | LifecycleRefusal
  | 'invalid'
  | 'not_found'
  | 'stale'
  | 'conflict'
  | 'failed';

/**
 * The lifecycle-relevant state of one account.
 *
 * `hasPassword`/`hasTotp` are the PRESENCE of the two credentials, never
 * the credentials themselves: no page, action or audit row in this phase
 * carries `password_hash` or `totp_secret`.
 */
export type LifecycleAccountState = {
  id: number;
  role: LifecycleRole;
  /** NULL means active; the timestamp is when the account was deactivated. */
  disabledAt: Date | string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  canManageAdmins: boolean;
};

export type LifecycleDecision =
  | { allowed: true }
  | { allowed: false; reason: LifecycleRefusal };

const ALLOWED: LifecycleDecision = { allowed: true };
const refuse = (reason: LifecycleRefusal): LifecycleDecision => ({ allowed: false, reason });

export function isActive(account: Pick<LifecycleAccountState, 'disabledAt'>): boolean {
  return account.disabledAt === null || account.disabledAt === undefined;
}

/**
 * A viable super admin is exactly the set of rows that can pass
 * `adminLogin` as a super admin (§26.5): enabled, `super_admin`, and
 * enrolled in BOTH factors, because the login form requires both.
 *
 * An outstanding temporary password still counts: `must_change_password`
 * lets the holder sign in and replace it, so the account can still recover
 * the site. A disabled or half-enrolled row never counts, however the
 * administrators page happens to label it.
 */
export function isViableSuperAdmin(account: LifecycleAccountState): boolean {
  return account.role === 'super_admin'
    && isActive(account)
    && account.hasPassword
    && account.hasTotp;
}

/**
 * Whether this actor may perform lifecycle mutations at all.
 *
 * ENABLED super admin, not *viable* super admin. The distinction matters
 * only off the web path: a live session already proves both credentials
 * exist, so for a real request the two readings coincide. Reading it as
 * "enabled" is what makes the last-Super-Admin invariant reachable at all
 * (§26.5 vs §26.13): an enabled but un-enrolled super admin can ask for a
 * demotion and be told `last_super_admin`, where a viability test would
 * have answered `forbidden` and never counted anything.
 */
export function canActOnLifecycle(actor: LifecycleAccountState): boolean {
  return actor.role === 'super_admin' && isActive(actor);
}

/**
 * Which of the four actions this actor may perform on this target, given
 * how many OTHER viable super admins exist (`id <> target.id`).
 *
 * The count is the caller's job because only the caller knows its scope:
 * the page counts the rows it loaded, the transaction counts the table
 * under the lifecycle lock. Only the second one is authoritative.
 *
 * Check order is the one §26.10 fixes for the server: self, then actor,
 * then state, then the invariant — so a super admin trying to demote
 * themselves is told it is their own account rather than being told the
 * site would be left without an administrator.
 */
export function lifecycleEligibility(
  actor: LifecycleAccountState,
  target: LifecycleAccountState,
  viableOtherSuperAdmins: number,
): Record<LifecycleAction, LifecycleDecision> {
  const self = actor.id === target.id;
  const actorMayAct = canActOnLifecycle(actor);
  const targetActive = isActive(target);
  // Applies to any super admin target, viable or not: the question the
  // invariant asks is what is LEFT afterwards, not what is being removed.
  const wouldStrandSite = target.role === 'super_admin' && viableOtherSuperAdmins < 1;

  const decide = (action: LifecycleAction): LifecycleDecision => {
    // Self-promotion and self-reactivation are impossible by state (the
    // actor is an enabled super admin), so only the two §26.6 refusals
    // need naming here.
    if (self && (action === 'demote' || action === 'deactivate')) return refuse('self');
    if (!actorMayAct) return refuse('forbidden');

    switch (action) {
      case 'promote':
        return targetActive && target.role === 'admin' ? ALLOWED : refuse('invalid_state');
      case 'demote':
        if (!targetActive || target.role !== 'super_admin') return refuse('invalid_state');
        return wouldStrandSite ? refuse('last_super_admin') : ALLOWED;
      case 'deactivate':
        if (!targetActive) return refuse('invalid_state');
        return wouldStrandSite ? refuse('last_super_admin') : ALLOWED;
      case 'reactivate':
        return targetActive ? refuse('invalid_state') : ALLOWED;
    }
  };

  return {
    promote: decide('promote'),
    demote: decide('demote'),
    deactivate: decide('deactivate'),
    reactivate: decide('reactivate'),
  };
}

/** The account state an action leaves behind. `active` maps to `disabled_at`. */
export type LifecycleTransition = {
  role: LifecycleRole;
  active: boolean;
  canManageAdmins: boolean;
};

/**
 * What the row becomes. `active` rather than a timestamp because this
 * module is pure: the transaction writes `now()`, which is the database's
 * clock and the only one the audit row should agree with.
 *
 * Demotion clears `can_manage_admins` (§26.2.7): the flag delegates invite
 * and password-reset power to a PLAIN admin, and a demotion that left it
 * set would quietly hand the demoted account most of what it just lost.
 * Promotion leaves it alone — a super admin holds that power by role, and
 * the stored value is what they would fall back to if demoted later.
 */
export function lifecycleTransition(
  action: LifecycleAction,
  target: LifecycleAccountState,
): LifecycleTransition {
  switch (action) {
    case 'promote':
      return { role: 'super_admin', active: true, canManageAdmins: target.canManageAdmins };
    case 'demote':
      return { role: 'admin', active: true, canManageAdmins: false };
    case 'deactivate':
      return { role: target.role, active: false, canManageAdmins: target.canManageAdmins };
    case 'reactivate':
      return { role: target.role, active: true, canManageAdmins: target.canManageAdmins };
  }
}

/** The audit action name each mutation records (§26.12). */
export const LIFECYCLE_AUDIT_ACTION: Record<LifecycleAction, string> = {
  promote: 'admin.promoted',
  demote: 'admin.demoted',
  deactivate: 'admin.deactivated',
  reactivate: 'admin.reactivated',
};

/** The one place a refusal is worded, so the button and the server agree (§26.13). */
export function lifecycleMessage(
  code: LifecycleFailureCode,
  context: { email?: string | null; action?: LifecycleAction } = {},
): string {
  const who = context.email ?? 'this account';
  switch (code) {
    case 'invalid':
      return 'Bad request.';
    case 'not_found':
      return 'No such account.';
    case 'self':
      return 'This is your own account. Another super admin must change it.';
    case 'forbidden':
      return 'Your access changed. Sign in again.';
    case 'stale':
      return 'This account changed since the page loaded. Reload and try again.';
    case 'invalid_state':
      return 'That action is not available for this account.';
    case 'last_super_admin':
      return `Refused: ${who} is the only active super admin with working credentials.`;
    case 'conflict':
      return 'Another administrator change is in progress. Try again.';
    case 'failed':
      return 'The change was not saved.';
  }
}

/** The reason shown beside a control the page has already worked out is unavailable. */
export function lifecycleUnavailableReason(
  action: LifecycleAction,
  reason: LifecycleRefusal,
  context: { email?: string | null } = {},
): string {
  if (reason === 'last_super_admin') {
    return action === 'demote'
      ? 'Cannot demote: this is the only active super admin with working credentials.'
      : 'Cannot deactivate: this is the only active super admin with working credentials.';
  }
  return lifecycleMessage(reason, context);
}

export function lifecycleSuccessMessage(action: LifecycleAction, email: string): string {
  switch (action) {
    case 'promote':
      return `${email} is now a super admin. Their sessions were signed out.`;
    case 'demote':
      return `${email} is now an admin, and can no longer manage admins. `
        + 'Their sessions were signed out.';
    case 'deactivate':
      return `${email} is deactivated and signed out. The account and everything it `
        + 'has ever done are kept.';
    case 'reactivate':
      return `${email} can sign in again with their existing credentials. `
        + 'No previous session was restored.';
  }
}

/** Deactivation asks for a reason; it is stored in the audit detail (§26.2.8). */
export const LIFECYCLE_REASON_MIN = 3;
export const LIFECYCLE_REASON_MAX = 200;

export function normaliseLifecycleReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const reason = raw.trim();
  if (reason.length < LIFECYCLE_REASON_MIN || reason.length > LIFECYCLE_REASON_MAX) return null;
  return reason;
}

export function isLifecycleRole(value: unknown): value is LifecycleRole {
  return value === 'contributor' || value === 'admin' || value === 'super_admin';
}
