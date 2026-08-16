'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import {
  audit,
  createAdminSession,
  requireSignedIn,
} from '@/lib/auth/session';

/**
 * Change your own password.
 *
 * Two callers, one form: an ordinary admin who wants a new password, and an
 * account that has been given a temporary one and cannot reach anything else
 * until it does this (migration 040, and `requireUploader` in session.ts).
 *
 * The current password is required even though the caller is already signed
 * in. A live session is proof that somebody signed in as this account, not
 * that they are its holder -- an unlocked laptop is the ordinary case -- and
 * a change-password form that needs no password is a way to steal an account
 * outright rather than merely borrow it. It is also the check that stops a
 * temporary password being replaced by whoever intercepted it in transit
 * without the legitimate holder ever noticing.
 */

export type ChangePasswordState = { error?: string };

// Guessing the current password from an authenticated session is a narrower
// attack than login, but it is the same attack, so it gets the same treatment:
// a cap checked BEFORE the scrypt below, so a burst cannot pin a worker.
// Keyed on the user rather than the IP -- the caller is known here, and their
// own session is the only thing that reaches this action.
const CHANGE_LIMIT = new RateLimiter(8, 15 * 60 * 1000);

export async function changeOwnPassword(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  // requireSignedIn, not requireUploader: this is the one page an account
  // holding a temporary password is allowed to reach, and requireUploader
  // would redirect it straight back here.
  const admin = await requireSignedIn();

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (CHANGE_LIMIT.check(`user:${admin.id}`)) {
    return { error: 'Too many attempts. Wait fifteen minutes.' };
  }

  if (next.length < MIN_PASSWORD_LENGTH) {
    return { error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (next !== confirm) return { error: 'The new passwords did not match.' };
  if (next === current) return { error: 'That is the password you are already using.' };

  const [row] = await authSql<{ passwordHash: string | null }[]>`
    SELECT password_hash AS "passwordHash" FROM auth_users WHERE id = ${admin.id}
  `;
  if (!row?.passwordHash || !(await verifyPassword(current, row.passwordHash))) {
    await audit('admin.password_change_failed', null, { userId: admin.id, label: admin.email });
    return { error: 'That is not your current password.' };
  }

  const passwordHash = await hashPassword(next);

  await authSql.begin(async (tx) => {
    await tx`
      UPDATE auth_users
         SET password_hash        = ${passwordHash},
             must_change_password = false,
             password_changed_at  = now()
       WHERE id = ${admin.id}
    `;
    // Every session, this one included. A credential change is the moment to
    // rotate: any session opened with the OLD password -- on a shared
    // machine, or by whoever the reset was issued because of -- dies here,
    // and the caller gets a fresh one below rather than carrying on with the
    // identifier that was live while the old password was.
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
       WHERE user_id = ${admin.id} AND revoked_at IS NULL
    `;
  });

  await createAdminSession(admin.id, admin.email);
  await audit('admin.password_changed', null, { userId: admin.id, label: admin.email });

  // Contributors have nowhere else to be; everyone else lands on the
  // dashboard, which is what they were trying to reach if they got here by
  // the temporary-password redirect.
  redirect(admin.role === 'contributor' ? '/admin/upload' : '/admin');
}
