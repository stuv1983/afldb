'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { audit, requireAdmin } from '@/lib/auth/session';

export type AdminSessionState = {
  error?: string;
  message?: string;
};

export async function revokeSession(
  _previous: AdminSessionState,
  formData: FormData,
): Promise<AdminSessionState> {
  const admin = await requireAdmin();
  const sessionId = Number(formData.get('sessionId'));
  if (!Number.isInteger(sessionId)) return { error: 'Bad session id.' };

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
