'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import type { LifecycleRole } from '@/lib/auth/admin-lifecycle';
import { audit, hasAdminManagementAccess, requireAdmin } from '@/lib/auth/session';

export type AdminSessionState = {
  error?: string;
  message?: string;
};

/**
 * End one live session.
 *
 * Until AFLDB-ISSUE-155 Phase B this was guarded by `requireAdmin` alone,
 * which meant any admin could sign any other account out — a super admin
 * included, mid-edit, with no delegation involved and nothing but the page
 * not offering the button standing in the way. §26.3 sets the rule the
 * server now applies: your own session always; anyone else's only as a
 * super admin, or as a delegated `can_manage_admins` holder against a
 * contributor, which is exactly the reach `issueTemporaryPassword` already
 * gives them (a temporary password ends the target's sessions anyway, so
 * refusing this would only be theatre).
 *
 * The target's role is read from the database rather than taken from the
 * form, so a promotion since the page rendered cannot be raced past it.
 */
export async function revokeSession(
  _previous: AdminSessionState,
  formData: FormData,
): Promise<AdminSessionState> {
  const admin = await requireAdmin();
  const sessionId = Number(formData.get('sessionId'));
  if (!Number.isInteger(sessionId)) return { error: 'Bad session id.' };

  const [target] = await authSql<{
    userId: number; email: string; role: LifecycleRole;
  }[]>`
    SELECT s.user_id AS "userId", u.email, u.role
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
     WHERE s.id = ${sessionId}
  `;
  if (!target) return { error: 'Already revoked or not found.' };

  const isSelf = target.userId === admin.id;
  const mayRevoke = isSelf
    || admin.role === 'super_admin'
    || (hasAdminManagementAccess(admin) && target.role === 'contributor');

  if (!mayRevoke) {
    await audit('session.revoke_refused',
      { sessionId, targetUserId: target.userId, targetEmail: target.email,
        targetRole: target.role },
      { userId: admin.id, label: admin.email });
    return { error: 'Only a super admin can sign another account out.' };
  }

  const [row] = await authSql<{ userId: number; email: string }[]>`
    UPDATE auth_sessions s SET revoked_at = now()
      FROM auth_users u
     WHERE s.id = ${sessionId} AND s.revoked_at IS NULL AND u.id = s.user_id
    RETURNING s.user_id AS "userId", u.email
  `;
  if (!row) return { error: 'Already revoked or not found.' };

  await audit('session.revoked', { sessionId, targetUserId: row.userId, targetEmail: row.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/admins');
  return { message: `Session for ${row.email} signed out.` };
}
