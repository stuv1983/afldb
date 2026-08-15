'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import { type AdminUser, audit, requireAdminManager } from '@/lib/auth/session';

export type InviteState = {
  error?: string;
  message?: string;
  /** Shown exactly once; the token itself is never stored. */
  inviteLink?: string;
};

/** How long an unused invite link stays valid. */
const INVITE_TTL_DAYS = 7;

export async function createInvite(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const admin = await requireAdminManager();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That is not an email address.' };

  const requestedRole = String(formData.get('role') ?? 'admin');
  const requestedManage = formData.get('canManageAdmins') === 'on';

  // Only an actual super admin may hand out super_admin or the delegated
  // manage-admins power — a plain admin holding can_manage_admins may
  // invite an ordinary admin or a contributor, never a peer or better.
  // Silently downgrading rather than erroring keeps a delegated manager's
  // form usable without ever needing to explain a permission they don't
  // have.
  const role = admin.role === 'super_admin' && requestedRole === 'super_admin'
    ? 'super_admin'
    : requestedRole === 'contributor' ? 'contributor' : 'admin';
  const canManageAdmins = admin.role === 'super_admin' && role !== 'contributor' && requestedManage;

  // Accepting an invite is also a credential RESET: confirmEnrolment upserts
  // on email, overwriting whatever account already holds that address --
  // role, password hash and TOTP secret alike. So an invite aimed at an
  // existing address is a way to take that account over, and the delegated
  // manage-admins power must not reach a peer or better any more than it
  // reaches the super_admin role above. Only a delegated manager is
  // constrained here; a super admin already outranks everyone.
  if (admin.role !== 'super_admin') {
    const [existing] = await authSql<{ role: AdminUser['role'] }[]>`
      SELECT role FROM auth_users WHERE email = ${email}
    `;
    if (existing && existing.role !== 'contributor') {
      await audit('admin.invite_refused',
        { email, role, existingRole: existing.role },
        { userId: admin.id, label: admin.email });
      return {
        error: 'That address already belongs to an administrator. '
          + 'Only a super admin can re-issue an invite for it.',
      };
    }
  }

  const token = generateToken();
  await authSql`
    INSERT INTO admin_invites (email, role, can_manage_admins, token_hash, invited_by, expires_at)
    VALUES (${email}, ${role}, ${canManageAdmins}, ${sha256Hex(token)}, ${admin.id},
            now() + ${INVITE_TTL_DAYS} * interval '1 day')
  `;

  await audit('admin.invited', { email, role, canManageAdmins },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/admins');

  const base = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';
  return {
    inviteLink: `${base}/admin/invite/${token}`,
    message: `Invite for ${email} created. Copy this link and send it to them yourself — `
      + `it is shown once and is not stored.`,
  };
}

export async function revokeInvite(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const admin = await requireAdminManager();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad invite id.' };

  const [row] = await authSql<{ email: string }[]>`
    UPDATE admin_invites SET revoked_at = now()
     WHERE id = ${id} AND used_at IS NULL AND revoked_at IS NULL
    RETURNING email
  `;
  if (!row) return { error: 'Already used, already revoked, or not found.' };

  await audit('admin.invite_revoked', { inviteId: id, email: row.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/admins');
  return { message: `Invite for ${row.email} revoked.` };
}
