'use server';

import { redirect } from 'next/navigation';

import postgres from 'postgres';
import QRCode from 'qrcode';

import { authSql } from '@/db/authClient';
import {
  MIN_PASSWORD_LENGTH,
  generateTotpSecret, hashPassword, sha256Hex, totpUri, verifyTotpStep,
} from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { ROLE_RANK, type AdminUser, audit, requestIp } from '@/lib/auth/session';

export type InviteAcceptState = {
  error?: string;
  step: 'password' | 'confirm';
  qrDataUrl?: string;
  secret?: string;
  email?: string;
};

// Confirming a code is a guess against a 6-digit space; bound attempts per
// invite the same way login bounds attempts per IP (see admin/login/actions.ts).
const CONFIRM_LIMIT = new RateLimiter(10, 15 * 60 * 1000);

type InviteRow = {
  id: number;
  email: string;
  role: 'admin' | 'super_admin' | 'contributor';
  canManageAdmins: boolean;
  pendingTotpSecret: string | null;
};

async function loadLiveInvite(token: string): Promise<InviteRow | null> {
  const [row] = await authSql<InviteRow[]>`
    SELECT id, email, role, can_manage_admins AS "canManageAdmins",
           pending_totp_secret AS "pendingTotpSecret"
      FROM admin_invites
     WHERE token_hash = ${sha256Hex(token)}
       AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `;
  return row ?? null;
}

/** Step 1: the invitee chooses a password; a TOTP secret is minted and shown as a QR code. */
export async function beginEnrolment(
  _previous: InviteAcceptState,
  formData: FormData,
): Promise<InviteAcceptState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  const invite = await loadLiveInvite(token);
  if (!invite) return { step: 'password', error: 'This invite link is invalid, used or expired.' };

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { step: 'password', error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirm) return { step: 'password', error: 'Passwords did not match.' };

  const passwordHash = await hashPassword(password);
  const secret = generateTotpSecret();

  // Nothing sensitive round-trips through the browser between steps: the
  // hash and secret live only in this row until a live code proves the
  // invitee actually captured the QR code (see confirmEnrolment).
  await authSql`
    UPDATE admin_invites
       SET pending_password_hash = ${passwordHash}, pending_totp_secret = ${secret}
     WHERE id = ${invite.id}
  `;

  const qrDataUrl = await QRCode.toDataURL(totpUri(secret, invite.email));
  return { step: 'confirm', qrDataUrl, secret, email: invite.email };
}

/** Step 2: a live code from the newly scanned QR proves enrolment before the account is created. */
export async function confirmEnrolment(
  _previous: InviteAcceptState,
  formData: FormData,
): Promise<InviteAcceptState> {
  const token = String(formData.get('token') ?? '');
  const code = String(formData.get('totp') ?? '').trim();

  if (CONFIRM_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { step: 'confirm', error: 'Too many attempts. Wait fifteen minutes and request a new invite.' };
  }

  const invite = await loadLiveInvite(token);
  if (!invite) return { step: 'password', error: 'This invite link is invalid, used or expired.' };

  const [pending] = await authSql<{ pendingPasswordHash: string | null; pendingTotpSecret: string | null }[]>`
    SELECT pending_password_hash AS "pendingPasswordHash", pending_totp_secret AS "pendingTotpSecret"
      FROM admin_invites WHERE id = ${invite.id}
  `;
  if (!pending?.pendingPasswordHash || !pending.pendingTotpSecret) {
    return { step: 'password', error: 'Set a password first.' };
  }

  const totpStep = verifyTotpStep(pending.pendingTotpSecret, code);
  if (totpStep === null) {
    // Re-render the QR step rather than bouncing back to "set a password": the
    // secret is unchanged, the invitee just needs their app's next code.
    const qrDataUrl = await QRCode.toDataURL(totpUri(pending.pendingTotpSecret, invite.email));
    return {
      step: 'confirm', qrDataUrl, secret: pending.pendingTotpSecret, email: invite.email,
      error: 'Incorrect or expired code. Enter the current code from your authenticator app.',
    };
  }

  // A dedicated short-lived connection for the transaction, exactly as
  // promoteSubmission does in src/lib/ingest/pipeline.ts: the pooled
  // `authSql` proxy exists for one-shot queries, not for `.begin()`.
  const dsn = process.env.AFLDB_AUTH_DATABASE_URL;
  if (!dsn) return { step: 'confirm', error: 'Server is not configured (AFLDB_AUTH_DATABASE_URL).' };
  const tx = postgres(dsn, { max: 1, onnotice: () => {} });
  // Set inside the transaction; read after it. A plain `let` would be
  // narrowed to null by the compiler, which cannot see the closure write.
  const outranked: { role: AdminUser['role'] | null } = { role: null };
  try {
    await tx.begin(async (t) => {
      // The upsert below overwrites any account that already holds this
      // email -- role, password and TOTP secret. Refuse when that account
      // outranks what the invite grants, so an invite can never be the way
      // someone is demoted: not when it was aimed at them deliberately, and
      // not when they were promoted in the days since it was issued.
      // createInvite blocks the first case at source; this is the check that
      // holds regardless of who issued the invite or when.
      const [existing] = await t<{ role: AdminUser['role'] }[]>`
        SELECT role FROM auth_users WHERE email = ${invite.email} FOR UPDATE
      `;
      if (existing && ROLE_RANK[existing.role] > ROLE_RANK[invite.role]) {
        outranked.role = existing.role;
        return;
      }

      const [user] = await t<{ id: number }[]>`
        INSERT INTO auth_users (email, role, password_hash, totp_secret, can_manage_admins)
        VALUES (${invite.email}, ${invite.role}, ${pending.pendingPasswordHash},
                ${pending.pendingTotpSecret}, ${invite.canManageAdmins})
        ON CONFLICT (email) DO UPDATE
          SET role              = EXCLUDED.role,
              password_hash     = EXCLUDED.password_hash,
              totp_secret       = EXCLUDED.totp_secret,
              can_manage_admins = EXCLUDED.can_manage_admins,
              -- A new secret starts a new counter; see create-admin.ts for why.
              totp_last_step    = ${totpStep},
              disabled_at       = NULL
        RETURNING id
      `;
      // Re-enrolling an existing email invalidates whatever sessions it had.
      await t`
        UPDATE auth_sessions SET revoked_at = now()
         WHERE user_id = ${user.id} AND revoked_at IS NULL
      `;
      await t`
        UPDATE admin_invites
           SET used_at = now(), pending_password_hash = NULL, pending_totp_secret = NULL
         WHERE id = ${invite.id}
      `;
    });
  } finally {
    await tx.end({ timeout: 5 });
  }

  if (outranked.role) {
    await audit('admin.invite_rejected',
      { email: invite.email, role: invite.role, existingRole: outranked.role },
      { label: invite.email });
    return {
      step: 'confirm',
      error: 'This invite cannot be used: the account for this address already holds a higher role. '
        + 'Ask a super admin to sort it out.',
    };
  }

  await audit('admin.invite_accepted', { email: invite.email, role: invite.role }, { label: invite.email });
  redirect('/admin/login');
}
