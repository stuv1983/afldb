'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import { audit, getAdminUser } from '@/lib/auth/session';

export type AccessState = {
  error?: string;
  message?: string;
  /** Shown exactly once; only the hash is stored. */
  newCode?: string;
};

async function requireAdmin() {
  const admin = await getAdminUser();
  if (!admin) redirect('/admin/login');
  return admin;
}

export async function createAccessCode(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const label = String(formData.get('label') ?? '').trim();
  const maxUses = Math.min(Math.max(Number(formData.get('maxUses') ?? 1), 1), 500);
  const days = Math.min(Math.max(Number(formData.get('days') ?? 90), 1), 365);

  if (label.length < 2 || label.length > 100) {
    return { error: 'Give the code a label: whose is it?' };
  }

  // Human-shareable but unguessable: 20 base64url characters ≈ 119 bits.
  const code = `afldb-${generateToken().slice(0, 20)}`;

  await authSql`
    INSERT INTO beta_access_codes (code_hash, label, max_uses, created_by, expires_at)
    VALUES (${sha256Hex(code)}, ${label}, ${maxUses}, ${admin.id},
            now() + ${days} * interval '1 day')
  `;
  await audit('access.code_created', { label, maxUses, days },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');

  return {
    newCode: code,
    message: `Code for “${label}” created. Copy it now — it is not stored and cannot be shown again.`,
  };
}

export async function revokeAccessCode(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad code id.' };

  const [row] = await authSql<{ label: string }[]>`
    UPDATE beta_access_codes SET revoked_at = now()
     WHERE id = ${id} AND revoked_at IS NULL
    RETURNING label
  `;
  if (!row) return { error: 'Already revoked or not found.' };

  await audit('access.code_revoked', { codeId: id, label: row.label },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');
  return { message: `Code “${row.label}” revoked. Existing sessions expire with the epoch or TTL.` };
}

export async function addAllowedEmail(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That is not an email address.' };

  await authSql`
    INSERT INTO beta_allowed_emails (email, note, added_by)
    VALUES (${email}, ${note}, ${admin.id})
    ON CONFLICT (email) DO UPDATE SET revoked_at = NULL, note = EXCLUDED.note
  `;
  await audit('access.email_allowed', { email }, { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');
  return { message: `${email} can now request a sign-in link on the beta page.` };
}

export async function revokeAllowedEmail(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad id.' };

  const [row] = await authSql<{ email: string }[]>`
    UPDATE beta_allowed_emails SET revoked_at = now()
     WHERE id = ${id} AND revoked_at IS NULL
    RETURNING email
  `;
  if (!row) return { error: 'Already revoked or not found.' };

  await audit('access.email_revoked', { email: row.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');
  return { message: `${row.email} removed from the allowlist.` };
}
