'use server';

import { redirect } from 'next/navigation';

import postgres from 'postgres';
import QRCode from 'qrcode';

import { authSql } from '@/db/authClient';
import {
  INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS,
  type InviteRedemptionRefusal,
  type InviteRedemptionResult,
  redeemInviteInTransaction,
} from '@/db/queries/admin-invites';
import {
  MIN_PASSWORD_LENGTH,
  generateTotpSecret, hashPassword, sha256Hex, totpUri, verifyTotpStep,
} from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, requestIp } from '@/lib/auth/session';

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
  /** The issuer, from the stored row; confirmEnrolment judges an overwrite by it (ISSUE-270). */
  invitedBy: number;
};

/** What the invitee is told when redemption refuses (AFLDB-ISSUE-270); the audit row carries the exact reason. */
function refusalMessage(reason: InviteRedemptionRefusal): string {
  switch (reason) {
    case 'outranked':
      return 'This invite cannot be used: the account for this address already holds a higher role. '
        + 'Ask a super admin to sort it out.';
    case 'target_requires_super_admin':
      return 'This invite cannot be used: the address already belongs to an administrator, and only '
        + 'an invite from a current super admin can reset it. Ask a super admin to sort it out.';
    default:
      // issuer_missing, issuer_deactivated, issuer_not_admin_manager,
      // grant_exceeds_issuer: the same whether or not the address has an account.
      return 'This invite cannot be used: the administrator who issued it no longer has the authority '
        + 'to grant this access. Ask a current admin manager or super admin for a new invite.';
  }
}

async function loadLiveInvite(token: string): Promise<InviteRow | null> {
  const [row] = await authSql<InviteRow[]>`
    SELECT id, email, role, can_manage_admins AS "canManageAdmins",
           pending_totp_secret AS "pendingTotpSecret", invited_by AS "invitedBy"
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
  // AFLDB-ISSUE-186 Phase A: createInvite() no longer issues a role =
  // 'contributor' invite (see its own comment), but this closes the
  // window for any invite row created before that change shipped --
  // token_hash rows already in admin_invites are untouched data, not
  // something this issue drops or rewrites, so the guard belongs at
  // redemption time, not as a migration against admin_invites itself.
  if (invite.role === 'contributor') {
    return {
      step: 'password',
      error: 'This invite is for the retired Contributor role and can no longer be used. '
        + 'Ask a super admin for a new invite.',
    };
  }

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
  // Mirrors beginEnrolment's guard above -- checked again here, before the
  // transaction that actually creates/overwrites the auth_users row, in
  // case this step is ever reached without the first (a direct POST, a
  // resumed multi-tab flow against a link issued before this change).
  if (invite.role === 'contributor') {
    return {
      step: 'password',
      error: 'This invite is for the retired Contributor role and can no longer be used. '
        + 'Ask a super admin for a new invite.',
    };
  }

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
  // Every statement is bounded as the pooled auth connections are
  // (src/db/authClient.ts): a redemption stuck behind another transaction's
  // lock on the issuer or target row is cancelled, rolls back and lands in
  // the generic failure below, rather than holding this request open.
  const tx = postgres(dsn, {
    max: 1,
    onnotice: () => {},
    connection: { statement_timeout: INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS },
  });
  // The upsert overwrites any account already at this email -- role,
  // password and TOTP secret -- so who may do that is decided inside the
  // transaction, at the write, against the account and the issuer as they
  // stand now (AFLDB-ISSUE-270; src/db/queries/admin-invites.ts). The issuer
  // must still hold the authority to grant what the invite grants (D-270-2),
  // an invite is never the way someone is demoted, and only a current super
  // admin's invite resets an existing administrator.
  const passwordHash = pending.pendingPasswordHash;
  const totpSecret = pending.pendingTotpSecret;
  let result: InviteRedemptionResult | null = null;
  let failureCode: string | null = null;
  try {
    result = await tx.begin((t) => redeemInviteInTransaction(t, {
      invite, passwordHash, totpSecret, totpStep,
    }));
  } catch (error) {
    // A database failure (a deadlock victim, a statement timeout, a lost
    // connection, a unique violation, the vanished-target guard) rolls the
    // transaction back and is never a success: no redirect
    // and no invite_accepted below. Only the SQLSTATE (or the error's name)
    // is kept: postgres.js errors carry the statement's bound parameters,
    // which here include the pending password hash and TOTP secret.
    const code = (error as { code?: unknown } | null)?.code;
    failureCode = typeof code === 'string' ? code : (error instanceof Error ? error.name : 'unknown');
  } finally {
    // Closing the connection cannot change the outcome of a transaction that
    // has already committed or rolled back, so its own failure is ignored.
    await tx.end({ timeout: 5 }).catch(() => undefined);
  }

  if (!result) {
    console.error(`[admin.invite] redemption of invite ${invite.id} failed (${failureCode}); not enrolled`);
    return {
      step: 'confirm',
      // If the failure struck while the commit itself was in flight the
      // outcome is unknown to this process, so nothing here claims that
      // nothing changed: a retry against a committed redemption simply
      // finds the invite used.
      error: 'The invite could not be completed because of a server error. Try again in a moment; '
        + 'if it keeps failing, ask a super admin.',
    };
  }

  if (!result.ok) {
    // Nothing was written: the account (or the free address), its sessions
    // and the invite (still unused, its pending credentials untouched) are as
    // they were. The audit names who issued the invite and what they now
    // hold, never a credential or the token.
    await audit('admin.invite_rejected', {
      email: invite.email,
      role: invite.role,
      canManageAdmins: invite.canManageAdmins,
      existingRole: result.existingRole,
      reason: result.reason,
      inviteId: invite.id,
      invitedBy: invite.invitedBy,
      issuerRole: result.issuer?.role ?? null,
      issuerActive: result.issuer?.active ?? null,
      issuerCanManageAdmins: result.issuer?.canManageAdmins ?? null,
    }, { label: invite.email });
    return { step: 'confirm', error: refusalMessage(result.reason) };
  }

  await audit('admin.invite_accepted', { email: invite.email, role: invite.role }, { label: invite.email });
  redirect('/admin/login');
}
