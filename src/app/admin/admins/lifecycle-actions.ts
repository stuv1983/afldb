'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { applyLifecycleMutation } from '@/db/queries/admin-users';
import {
  isLifecycleRole,
  lifecycleMessage,
  normaliseLifecycleReason,
  type LifecycleAction,
  type LifecycleFailureCode,
} from '@/lib/auth/admin-lifecycle';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

/**
 * The four account lifecycle Server Actions (AFLDB-ISSUE-155 Phase B).
 *
 * Thin on purpose: guard, parse, hand the whole decision to the one
 * transaction in src/db/queries/admin-users.ts, audit a refusal, revalidate.
 * Every rule that matters is re-derived in there from rows read under a
 * lock, so nothing this file parses out of the form can widen what happens
 * -- the hidden `expectedRole`/`expectedActive` fields are a staleness
 * check, not an instruction.
 *
 * `requireSuperAdmin()` is the boundary. The capability table names
 * `people.admins.lifecycle` for the same rule and the sidebar reads it, but
 * a capability table is a description of guards, not a substitute for one:
 * a delegated `can_manage_admins` admin redirects here exactly as a plain
 * admin does, and a contributor never gets past requireAdmin().
 */

export type LifecycleState = {
  error?: string;
  message?: string;
  code?: LifecycleFailureCode;
  /** Which account the result belongs to, so one banner does not appear on all of them. */
  email?: string;
};

/** Refusals worth a trail. `not_found`/`invalid` say nothing about a real account. */
const AUDITED_REFUSALS: ReadonlySet<LifecycleFailureCode> = new Set([
  'self', 'forbidden', 'stale', 'invalid_state', 'last_super_admin',
]);

async function runLifecycleAction(
  action: LifecycleAction,
  formData: FormData,
): Promise<LifecycleState> {
  const admin = await requireSuperAdmin();

  const targetId = Number(formData.get('userId'));
  const expectedRole = formData.get('expectedRole');
  const expectedActiveRaw = formData.get('expectedActive');
  if (
    !Number.isInteger(targetId)
    || !isLifecycleRole(expectedRole)
    || (expectedActiveRaw !== '1' && expectedActiveRaw !== '0')
  ) {
    return { error: lifecycleMessage('invalid'), code: 'invalid' };
  }

  // Deactivation is the one destructive-feeling action, so it is the one
  // that asks for the account's email to be typed and for a reason. Both
  // are checked again inside the transaction, the email against the row
  // read under the lock rather than against anything submitted with it.
  let reason: string | null = null;
  if (action === 'deactivate') {
    reason = normaliseLifecycleReason(formData.get('reason'));
    if (!reason) {
      return {
        error: 'Give a short reason for deactivating this account (3–200 characters).',
        code: 'invalid',
      };
    }
  }

  const result = await applyLifecycleMutation(authSql, {
    action,
    actorId: admin.id,
    actorLabel: admin.email,
    targetId,
    expectedRole,
    expectedActive: expectedActiveRaw === '1',
    reason,
    confirmEmail: action === 'deactivate' ? String(formData.get('confirmEmail') ?? '') : null,
  });

  if (!result.ok) {
    if (AUDITED_REFUSALS.has(result.code)) {
      await audit(
        'admin.lifecycle_refused',
        {
          action,
          targetUserId: targetId,
          targetEmail: result.email ?? null,
          code: result.code,
        },
        { userId: admin.id, label: admin.email },
      );
    }
    return { error: result.error, code: result.code, email: result.email };
  }

  revalidatePath('/admin/admins');
  return { message: result.message, email: result.email };
}

export async function promoteAdmin(
  _previous: LifecycleState,
  formData: FormData,
): Promise<LifecycleState> {
  return runLifecycleAction('promote', formData);
}

export async function demoteSuperAdmin(
  _previous: LifecycleState,
  formData: FormData,
): Promise<LifecycleState> {
  return runLifecycleAction('demote', formData);
}

export async function deactivateAccount(
  _previous: LifecycleState,
  formData: FormData,
): Promise<LifecycleState> {
  return runLifecycleAction('deactivate', formData);
}

export async function reactivateAccount(
  _previous: LifecycleState,
  formData: FormData,
): Promise<LifecycleState> {
  return runLifecycleAction('reactivate', formData);
}
