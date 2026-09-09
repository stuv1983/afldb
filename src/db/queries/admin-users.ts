import 'server-only';

import type postgres from 'postgres';

import {
  LIFECYCLE_AUDIT_ACTION,
  isActive,
  lifecycleEligibility,
  lifecycleMessage,
  lifecycleSuccessMessage,
  lifecycleTransition,
  type LifecycleAccountState,
  type LifecycleAction,
  type LifecycleFailureCode,
  type LifecycleRole,
} from '@/lib/auth/admin-lifecycle';
import { auditInTransaction } from '@/lib/auth/session';

/**
 * The administrators read model and the account lifecycle transaction
 * (AFLDB-ISSUE-155 Phase B, §26.7 and §26.10).
 *
 * There is no delete. §26.4 enumerates every foreign key that points at
 * `auth_users` -- `data_edits.admin_user_id`, `player_link_resolutions`,
 * `data_overrides` and the staging observation spine are NOT NULL, and all
 * of them are NO ACTION -- so a delete would either be refused by
 * PostgreSQL or, if it were made to succeed, would erase the attribution
 * those tables exist to keep. `afldb_auth` holds no DELETE on the table
 * either. Deactivation is the lifecycle primitive, and `disabled_at` was
 * already honoured by `getAdminUser` and `adminLogin` before this phase.
 *
 * `applyLifecycleMutation` takes its `sql` handle as an argument rather
 * than binding the module-level auth pool. The Server Actions hand it
 * `authSql`; the integration suite hands it its own connection, so the
 * transactional logic under test is the one that ships rather than a
 * mocked paraphrase of it.
 */

// The AFLDB advisory-lock namespace (0xAF1DB), matching
// HONOUR_TEAM_LOCK_NAMESPACE in src/db/queries/awards-admin.ts and
// tools/migration/import_awards.py. Key 1 is honour_team_members identity;
// key 2 is this one. Frozen literals, never derived by hashing a string:
// two implementations must contend on identical numbers.
const LIFECYCLE_LOCK_NAMESPACE = 717275; // 0xAF1DB
const LIFECYCLE_LOCK_KEY = 2; // auth_users role/status lifecycle writers

/** Raised when the compare-and-set UPDATE matches no row; see runLifecycleSteps. */
const CONFLICT_MARKER = 'AFLDB_LIFECYCLE_CONFLICT';

/**
 * One account as the page reads it. `disabledAt` is narrowed to the
 * driver's `Date`, so the page can serialise it; the wider
 * `LifecycleAccountState` this still satisfies also admits the ISO string
 * the Client Component receives.
 */
export type AdminAccountRow = Omit<LifecycleAccountState, 'disabledAt'> & {
  disabledAt: Date | null;
  email: string;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  createdAt: Date;
  /** The newest session ever created for the account; null if it never signed in. */
  lastSignInAt: Date | null;
};

export type AdminSessionRow = {
  sessionId: number;
  userId: number;
  createdAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
};

/**
 * Every account, plus the live sessions the viewer is allowed to see.
 *
 * Session rows carry an IP and a device string, which is personal data
 * about a colleague's whereabouts rather than administrative state, so a
 * plain admin gets their own and no one else's (§26.3). A super admin gets
 * all of them, because signing a compromised session out is their job.
 *
 * `password_hash` and `totp_secret` are read only as `IS NOT NULL`. The
 * values never leave the database on this path.
 */
export async function listAdminAccounts(
  sql: postgres.Sql,
  viewer: { id: number; role: LifecycleRole },
): Promise<{ accounts: AdminAccountRow[]; sessions: AdminSessionRow[] }> {
  const seesEverySession = viewer.role === 'super_admin';

  const [accounts, sessions] = await Promise.all([
    sql<AdminAccountRow[]>`
      SELECT u.id, u.email, u.role,
             u.can_manage_admins      AS "canManageAdmins",
             u.disabled_at            AS "disabledAt",
             u.must_change_password   AS "mustChangePassword",
             u.password_changed_at    AS "passwordChangedAt",
             u.created_at             AS "createdAt",
             u.password_hash IS NOT NULL AS "hasPassword",
             u.totp_secret   IS NOT NULL AS "hasTotp",
             (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id = u.id)
                                      AS "lastSignInAt"
        FROM auth_users u
       ORDER BY (u.disabled_at IS NOT NULL), u.email
    `,
    sql<AdminSessionRow[]>`
      SELECT s.id AS "sessionId", s.user_id AS "userId", s.created_at AS "createdAt",
             s.expires_at AS "expiresAt", s.ip::text AS ip, s.user_agent AS "userAgent"
        FROM auth_sessions s
       WHERE s.revoked_at IS NULL
         AND s.expires_at > now()
         AND (${seesEverySession} OR s.user_id = ${viewer.id})
       ORDER BY s.created_at DESC
    `,
  ]);

  return { accounts, sessions };
}

export type LifecycleMutationInput = {
  action: LifecycleAction;
  actorId: number;
  /** The email the audit row labels the actor with; the row's own email is the fallback. */
  actorLabel?: string;
  targetId: number;
  /** The role the page rendered, for the compare-and-set (§26.10). */
  expectedRole: LifecycleRole;
  /** Whether the page rendered the account as active. */
  expectedActive: boolean;
  /** Required for `deactivate`; already trimmed and length-checked by the action. */
  reason?: string | null;
  /** Required for `deactivate`: must equal the target's email, compared under the lock. */
  confirmEmail?: string | null;
};

export type LifecycleMutationResult =
  | { ok: true; action: LifecycleAction; email: string; message: string; revokedSessions: number }
  | { ok: false; code: LifecycleFailureCode; error: string; email?: string };

/**
 * Test-only seams. The production entry point below passes none of them,
 * so nothing here can widen what a request may do.
 *
 * `afterLock` lets the concurrency suite hold the advisory lock open at
 * the exact point a second transaction must be proven blocked.
 * `auditDetail` lets the atomicity case make the required audit INSERT
 * fail (a non-object detail violates `auth_audit_log_detail_is_object_ck`)
 * and assert the mutation rolled back with it. `countScope` narrows the
 * invariant count to the suite's own fixture ids where counting a shared
 * `_test` database whole would be non-deterministic.
 */
export type LifecycleTestHooks = {
  afterLock?: () => Promise<void>;
  auditDetail?: unknown;
  countScope?: number[];
};

type LockedRow = {
  id: number;
  email: string;
  role: LifecycleRole;
  canManageAdmins: boolean;
  disabledAt: Date | null;
  hasPassword: boolean;
  hasTotp: boolean;
};

/**
 * The lifecycle transaction body, exported for the concurrency and
 * atomicity suites, which need to drive it on their own connections and
 * pause it mid-flight. Call `applyLifecycleMutation` from application
 * code: it is the one that owns the transaction and maps a thrown error
 * to a result.
 */
export async function runLifecycleSteps(
  tx: postgres.TransactionSql,
  input: LifecycleMutationInput,
  hooks: LifecycleTestHooks = {},
): Promise<LifecycleMutationResult> {
  const { action, actorId, targetId } = input;
  const fail = (code: LifecycleFailureCode, email?: string): LifecycleMutationResult => ({
    ok: false, code, error: lifecycleMessage(code, { email, action }), email,
  });

  // 1. One constant transaction-scoped advisory lock serialises EVERY
  //    lifecycle mutation, across the pool and across workers. Row locks
  //    alone would also serialise the two rows involved, but the invariant
  //    is a count over a predicate, not a row, and this makes that
  //    serialisation explicit rather than resting on EvalPlanQual
  //    behaviour (§26.7). Transaction scope releases it on commit and on
  //    rollback alike; a wait longer than the auth pool's 5 s
  //    statement_timeout surfaces as `conflict`, having written nothing.
  await tx`SELECT pg_advisory_xact_lock(${LIFECYCLE_LOCK_NAMESPACE}, ${LIFECYCLE_LOCK_KEY})`;

  // 2. Actor and target, locked and re-read. Nothing below this line
  //    trusts a submitted role, status or email.
  const locked = await tx<LockedRow[]>`
    SELECT id, email, role,
           can_manage_admins AS "canManageAdmins",
           disabled_at       AS "disabledAt",
           password_hash IS NOT NULL AS "hasPassword",
           totp_secret   IS NOT NULL AS "hasTotp"
      FROM auth_users
     WHERE id = ANY(${[actorId, targetId]})
     ORDER BY id
       FOR UPDATE
  `;

  if (hooks.afterLock) await hooks.afterLock();

  const target = locked.find((row) => row.id === targetId);
  // No audit row: there is nothing to attribute it to, and recording the
  // id would confirm which ids exist to somebody probing for them.
  if (!target) return fail('not_found');

  const actor = locked.find((row) => row.id === actorId);
  const actorState: LifecycleAccountState = actor ?? {
    // A missing actor row cannot act; give the eligibility helper a state
    // it will refuse rather than a special case.
    id: actorId, role: 'contributor', disabledAt: new Date(),
    hasPassword: false, hasTotp: false, canManageAdmins: false,
  };

  // 3. Order fixed by §26.10: self before actor, so a super admin
  //    demoting themselves is told whose account it is.
  if (targetId === actorId && (action === 'demote' || action === 'deactivate')) {
    return fail('self', target.email);
  }
  if (!actor || actor.role !== 'super_admin' || !isActive(actor)) {
    return fail('forbidden', target.email);
  }

  // 4. Compare-and-set against what the page rendered. A duplicate
  //    promotion from a stale tab lands here and is answered `stale`, not
  //    a silent success (§26.13): a super admin must never be told "done"
  //    for something another super admin did.
  if (target.role !== input.expectedRole || isActive(target) !== input.expectedActive) {
    return fail('stale', target.email);
  }

  // 5. The typed confirmation, compared to the row read under the lock
  //    rather than to anything the form carried.
  if (action === 'deactivate') {
    const confirmEmail = (input.confirmEmail ?? '').trim().toLowerCase();
    if (!confirmEmail || confirmEmail !== target.email.toLowerCase()) {
      return {
        ok: false,
        code: 'invalid',
        error: "Type the account's email exactly to confirm.",
        email: target.email,
      };
    }
    if (!input.reason) {
      return {
        ok: false,
        code: 'invalid',
        error: 'Give a short reason for deactivating this account.',
        email: target.email,
      };
    }
  }

  // 6. The invariant, counted inside this transaction and under this
  //    lock. Only asked where it can bite: removing a super admin.
  const needsInvariant = (action === 'demote' || action === 'deactivate')
    && target.role === 'super_admin';
  const viableOtherSuperAdmins = needsInvariant
    ? await countViableSuperAdminsExcept(tx, targetId, hooks.countScope)
    : 0;

  const decision = lifecycleEligibility(actorState, target, viableOtherSuperAdmins)[action];
  if (!decision.allowed) return fail(decision.reason, target.email);

  // 7. Mutate, with the observed state repeated in the WHERE clause. Under
  //    the advisory lock and the row lock this cannot miss; asserting it
  //    anyway is what turns a silent no-op into a rollback.
  //
  //    One statement per transition rather than one statement with the
  //    status interpolated into it. Both halves that carry status -- the
  //    `disabled_at` written and the compare-and-set guard for the status
  //    the page rendered -- are literal SQL the planner parses as a
  //    predicate, never a value bound into the statement, so a wrong guard
  //    is a syntax the database checks rather than a boolean it trusts.
  //    `now()` is the transaction's own clock, the one the audit row
  //    written beside it is stamped with.
  const next = lifecycleTransition(action, target);
  const updated = await (!isActive(target)
    // reactivate: the only action that reaches here with a disabled target.
    ? tx<{ id: number }[]>`
        UPDATE auth_users
           SET role              = ${next.role},
               can_manage_admins = ${next.canManageAdmins},
               disabled_at       = NULL
         WHERE id = ${targetId}
           AND role = ${target.role}
           AND disabled_at IS NOT NULL
        RETURNING id
      `
    : next.active
      // promote / demote: a role change, leaving an active account active.
      ? tx<{ id: number }[]>`
          UPDATE auth_users
             SET role              = ${next.role},
                 can_manage_admins = ${next.canManageAdmins}
           WHERE id = ${targetId}
             AND role = ${target.role}
             AND disabled_at IS NULL
          RETURNING id
        `
      // deactivate.
      : tx<{ id: number }[]>`
          UPDATE auth_users
             SET role              = ${next.role},
                 can_manage_admins = ${next.canManageAdmins},
                 disabled_at       = now()
           WHERE id = ${targetId}
             AND role = ${target.role}
             AND disabled_at IS NULL
          RETURNING id
        `);
  if (updated.length !== 1) throw new Error(CONFLICT_MARKER);

  // 8. Every role or status change ends the target's sessions, promotion
  //    included (§26.8). getAdminUser re-reads role and disabled_at per
  //    request, so this is not what makes the change take effect -- it is
  //    what makes the account re-authenticate under its new state, and
  //    what stops reactivation from reviving a session that predates the
  //    deactivation.
  const revoked = await tx<{ id: number }[]>`
    UPDATE auth_sessions
       SET revoked_at = now()
     WHERE user_id = ${targetId} AND revoked_at IS NULL
    RETURNING id
  `;

  // 9. Required audit, on this transaction. auditInTransaction propagates
  //    a failed INSERT by design, so the UPDATE above rolls back with it:
  //    there is no path where the mutation commits and the audit does not.
  const detail: Record<string, unknown> = {
    targetUserId: target.id,
    targetEmail: target.email,
    before: {
      role: target.role,
      active: isActive(target),
      canManageAdmins: target.canManageAdmins,
    },
    after: { role: next.role, active: next.active, canManageAdmins: next.canManageAdmins },
    expected: { role: input.expectedRole, active: input.expectedActive },
    revokedSessions: revoked.length,
    ...(action === 'deactivate' && input.reason ? { reason: input.reason } : {}),
  };
  await auditInTransaction(
    tx,
    LIFECYCLE_AUDIT_ACTION[action],
    (hooks.auditDetail === undefined ? detail : hooks.auditDetail) as Record<string, unknown>,
    { userId: actor.id, label: input.actorLabel ?? actor.email },
  );

  return {
    ok: true,
    action,
    email: target.email,
    message: lifecycleSuccessMessage(action, target.email),
    revokedSessions: revoked.length,
  };
}

async function countViableSuperAdminsExcept(
  tx: postgres.TransactionSql,
  targetId: number,
  scope?: number[],
): Promise<number> {
  const scopeFilter = scope ? tx`AND id = ANY(${scope})` : tx``;
  const [row] = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count
      FROM auth_users
     WHERE role = 'super_admin'
       AND disabled_at IS NULL
       AND password_hash IS NOT NULL
       AND totp_secret IS NOT NULL
       AND id <> ${targetId}
       ${scopeFilter}
  `;
  return row?.count ?? 0;
}

/**
 * One lifecycle mutation: the §26.7 sequence in one transaction, never
 * throwing for a refusal.
 *
 * A refusal is a result, because a refusal is an ordinary outcome the page
 * must be able to word. A thrown error is not: it means the transaction
 * rolled back with nothing written, and the caller is told `conflict`
 * (lock wait or statement timeout, so retrying is sensible) or `failed`.
 * Success is reported only for a committed transaction.
 */
export async function applyLifecycleMutation(
  sql: postgres.Sql,
  input: LifecycleMutationInput,
): Promise<LifecycleMutationResult> {
  try {
    return await sql.begin((tx) => runLifecycleSteps(tx, input));
  } catch (error) {
    const code = classifyLifecycleFailure(error);
    // The message is deliberately not the driver's: it can carry a
    // statement and its parameters.
    console.error(
      `[admin-lifecycle] ${input.action} on user ${input.targetId} failed (${code})`,
      error instanceof Error ? error.message : 'unknown error',
    );
    return { ok: false, code, error: lifecycleMessage(code, { action: input.action }) };
  }
}

function classifyLifecycleFailure(error: unknown): 'conflict' | 'failed' {
  if (error instanceof Error && error.message === CONFLICT_MARKER) return 'conflict';
  const pgCode = (error as { code?: unknown } | null)?.code;
  // 57014 query_canceled: the 5 s statement_timeout fired, which on this
  // path means the wait for the advisory lock. 55P03 lock_not_available
  // and 40001/40P01 are the other "try again" families.
  if (pgCode === '57014' || pgCode === '55P03' || pgCode === '40001' || pgCode === '40P01') {
    return 'conflict';
  }
  return 'failed';
}
