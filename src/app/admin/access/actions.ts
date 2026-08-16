'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import { audit, requireAdmin } from '@/lib/auth/session';
import { parseIntInRange } from '@/lib/params';

export type AccessState = {
  error?: string;
  message?: string;
  /** Shown exactly once; only the hash is stored. */
  newCode?: string;
};

export async function createAccessCode(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const label = String(formData.get('label') ?? '').trim();
  // parseIntInRange rejects non-integers up front; the old hand-rolled
  // Math.min(Math.max(Number(...))) let a non-numeric field become NaN and
  // flow straight into the INSERT's integer column (a 500), and passed
  // fractional values through.
  //
  // Unlimited is NULL (migration 036), and must be asked for explicitly: a
  // blank or unparseable field still falls back to a single use, so the
  // uncapped case can never be reached by fumbling the form.
  const unlimited = formData.get('unlimited') === 'on';
  const maxUses = unlimited
    ? null
    : parseIntInRange(String(formData.get('maxUses') ?? ''), 1, 500) ?? 1;
  const days = parseIntInRange(String(formData.get('days') ?? ''), 1, 365) ?? 90;

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
  await audit('access.code_created', { label, maxUses, days, unlimited: maxUses === null },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');

  return {
    newCode: code,
    message: maxUses === null
      ? `Unlimited code for “${label}” created, valid ${days} days. Copy it now — it is `
        + 'not stored and cannot be shown again. Revoke it to stop it.'
      : `Code for “${label}” created. Copy it now — it is not stored and cannot be shown again.`,
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

export async function approveJoinRequest(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad request id.' };

  const [row] = await authSql<{ email: string }[]>`
    UPDATE beta_join_requests SET status = 'approved', reviewed_by = ${admin.id}, reviewed_at = now()
     WHERE id = ${id} AND status = 'pending'
    RETURNING email
  `;
  if (!row) return { error: 'Already reviewed or not found.' };

  await authSql`
    INSERT INTO beta_allowed_emails (email, note, added_by)
    VALUES (${row.email}, 'via join request', ${admin.id})
    ON CONFLICT (email) DO UPDATE SET revoked_at = NULL, note = EXCLUDED.note
  `;
  await audit('access.join_approved', { requestId: id, email: row.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');
  return { message: `${row.email} approved and allowlisted.` };
}

export async function denyJoinRequest(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const admin = await requireAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad request id.' };

  const [row] = await authSql<{ email: string }[]>`
    UPDATE beta_join_requests SET status = 'denied', reviewed_by = ${admin.id}, reviewed_at = now()
     WHERE id = ${id} AND status = 'pending'
    RETURNING email
  `;
  if (!row) return { error: 'Already reviewed or not found.' };

  await audit('access.join_denied', { requestId: id, email: row.email },
    { userId: admin.id, label: admin.email });
  revalidatePath('/admin/access');
  return { message: `${row.email} denied.` };
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
