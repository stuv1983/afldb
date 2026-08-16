'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { generateTemporaryPassword, hashPassword } from '@/lib/auth/crypto';
import { ROLE_RANK, type AdminUser, audit, requireAdminManager } from '@/lib/auth/session';

/**
 * Issue a temporary password for somebody else's account.
 *
 * This is the answer to "I have forgotten my password", which until now cost
 * the authenticator as well: the only mechanism was to re-issue an invite,
 * and accepting one re-enrols BOTH factors (see invite-actions.ts and
 * migration 040). Losing a password is not evidence that the second factor is
 * compromised, and making the two share one repair meant every forgotten
 * password also became a QR code to scan.
 *
 * What the temporary password can do is bounded on purpose:
 *
 *   - it is generated here, never typed by the admin issuing it;
 *   - it is shown once and stored only as an scrypt hash, so it cannot be
 *     read back off this screen tomorrow — a lost one is re-issued;
 *   - it carries `must_change_password`, which every admin route honours, so
 *     it grants exactly one ability: replacing itself;
 *   - it does not touch the TOTP secret, so signing in with it still needs
 *     the account's authenticator. An admin who could reset a password AND
 *     disarm 2FA would be the weakest door in the building.
 *
 * Who may issue one follows the invite rules exactly, because the powers are
 * comparable: both hand somebody a way into an account. A super admin may
 * reset anyone; a delegated `can_manage_admins` holder may reset a
 * contributor and no one better, which is the same line createInvite draws
 * and for the same reason.
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
  const admin = await requireAdminManager();

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

  await authSql.begin(async (tx) => {
    await tx`
      UPDATE auth_users
         SET password_hash        = ${passwordHash},
             must_change_password = true,
             password_changed_at  = now()
       WHERE id = ${target.id}
    `;
    // Whatever the account was signed in as is no longer what it is. This
    // also covers the case the reset exists for -- an account somebody else
    // has got into -- where leaving the intruder's session alive would make
    // the reset pointless.
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
       WHERE user_id = ${target.id} AND revoked_at IS NULL
    `;
  });

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
