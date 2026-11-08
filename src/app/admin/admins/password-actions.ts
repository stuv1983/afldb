'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { issueTemporaryPasswordInTransaction } from '@/db/queries/admin-credentials';
import { generateTemporaryPassword, hashPassword } from '@/lib/auth/crypto';
import {
  ROLE_RANK,
  type AdminUser,
  audit,
  currentAdminSessionTokenHash,
  requireCapability,
} from '@/lib/auth/session';

/**
 * Issue a temporary password for somebody else's account.
 *
 * Exists so that "I forgot my password" no longer costs the authenticator too:
 * the previous repair was re-issuing an invite, which re-enrols BOTH factors
 * (invite-actions.ts, migration 040).
 *
 * Its power is bounded on purpose. It is generated here rather than chosen by
 * the issuing admin, shown once and stored only as an scrypt hash, and carries
 * `must_change_password`, so it grants exactly one ability: replacing itself.
 * It leaves the TOTP secret alone — an admin who could both reset a password
 * and disarm 2FA would be the weakest door in the building.
 *
 * Who may issue one follows the `createInvite` rules exactly, since both hand
 * somebody a way into an account: a super admin may reset anyone, a delegated
 * `can_manage_admins` holder may reset a contributor and no one better.
 */

export type PasswordResetState = {
  error?: string;
  message?: string;
  /** Shown exactly once; only its hash is stored. */
  temporaryPassword?: string;
  /** Which row the result belongs to, so one banner does not appear on all of them. */
  email?: string;
};

export async function issueTemporaryPassword(
  _previous: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const admin = await requireCapability('people.admins.manage');

  const userId = Number(formData.get('userId'));
  if (!Number.isInteger(userId)) return { error: 'Bad user id.' };

  const [target] = await authSql<{
    id: number; email: string; role: AdminUser['role'];
  }[]>`
    SELECT id, email, role FROM auth_users WHERE id = ${userId}
  `;
  if (!target) return { error: 'No such account.' };

  // Resetting your own password through this button would sign you out of
  // the session you are holding and leave you typing a generated string you
  // did not need — /admin/password changes it in place instead.
  if (target.id === admin.id) {
    return {
      error: 'This is your own account. Use “Change password” to set a new one directly.',
      email: target.email,
    };
  }

  // A delegated manager may not reach a peer or better. Rank is compared
  // rather than the role named, so a promotion since the page was rendered
  // cannot be raced past this check.
  if (admin.role !== 'super_admin' && ROLE_RANK[target.role] >= ROLE_RANK.admin) {
    await audit('admin.password_reset_refused',
      { targetUserId: target.id, targetEmail: target.email, targetRole: target.role },
      { userId: admin.id, label: admin.email });
    return {
      error: 'That account is an administrator. Only a super admin can reset its password.',
      email: target.email,
    };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const actorSessionTokenHash = await currentAdminSessionTokenHash();
  if (actorSessionTokenHash === null) redirect('/admin/login');

  // Whatever the account was signed in as is no longer what it is: the
  // password changes and every session is revoked together. This also
  // covers the case the reset exists for -- an account somebody else has
  // got into -- where leaving the intruder's session alive would make the
  // reset pointless.
  //
  // AFLDB-ISSUE-340: both rows are locked (stable id order) and the actor's
  // authority and the target's rank re-checked under the lock, so a
  // demotion, a promotion or a rotation of the actor's own credentials that
  // committed after the checks above cannot be raced past them. The new
  // hash also invalidates any in-flight login or own-password change that
  // verified the replaced one (admin-credentials.ts).
  const outcome = await authSql.begin((tx) => issueTemporaryPasswordInTransaction(tx, {
    actorId: admin.id,
    actorSessionTokenHash,
    targetId: target.id,
    newPasswordHash: passwordHash,
  }));
  if (!outcome.ok) {
    await audit('admin.password_reset_refused',
      { targetUserId: target.id, targetEmail: outcome.targetEmail ?? target.email,
        targetRole: outcome.targetRole, reason: outcome.reason },
      { userId: admin.id, label: admin.email });
    return {
      error: outcome.reason === 'outranked'
        ? 'That account is an administrator. Only a super admin can reset its password.'
        : 'Your session or that account changed while this was being saved. Reload and try again.',
      email: target.email,
    };
  }

  await audit('admin.password_reset',
    { targetUserId: target.id, targetEmail: target.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/admins');

  return {
    email: target.email,
    temporaryPassword,
    message: `Temporary password for ${target.email}. Give it to them yourself — it is `
      + 'shown once and is not stored. They will be asked to choose a new one the first '
      + 'time they sign in, and their authenticator is unchanged.',
  };
}
