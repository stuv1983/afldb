'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { sha256Hex } from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, grantBetaAccess, requestIp } from '@/lib/auth/session';

export type VerifyState = {
  error?: string;
};

// Unauthenticated, and it runs a DB UPDATE on every hit, so cap it per caller
// to keep a flood off the small auth pool. Guessing the token is already
// infeasible (128-bit); this is purely load protection.
const VERIFY_LIMIT = new RateLimiter(20, 15 * 60 * 1000);

/**
 * Magic-link redemption (AFLDB-ISSUE-280). Single use: the token is burned in
 * the same statement that accepts it, so a forwarded or replayed link admits
 * nobody.
 *
 * This runs only from the confirmation form's POST. The emailed link itself is
 * a GET that renders that form and touches nothing: a mail provider that
 * pre-fetches links for safety scanning (Outlook SafeLinks, corporate URL
 * rewriters) used to spend the token before the reader clicked, and the
 * reader was then bounced to /beta with no explanation.
 */
export async function confirmMagicLink(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const token = String(formData.get('token') ?? '');

  if (token.length < 20 || token.length > 100) {
    redirect('/beta');
  }

  if (VERIFY_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { error: 'Too many requests. Wait a few minutes and try again.' };
  }

  const [row] = await authSql<{ email: string }[]>`
    UPDATE beta_login_tokens
       SET used_at = now()
     WHERE token_hash = ${sha256Hex(token)}
       AND used_at IS NULL
       AND expires_at > now()
    RETURNING email
  `;

  if (!row) {
    // Expired, used or never issued: back to the gate, which explains
    // nothing — the distinction is only useful to someone probing.
    redirect('/beta');
  }

  // The email must STILL be allowlisted: revocation between the link
  // being issued and clicked must win.
  const [allowed] = await authSql<{ id: number }[]>`
    SELECT id FROM beta_allowed_emails
     WHERE email = ${row.email} AND revoked_at IS NULL
  `;
  if (!allowed) {
    await audit('beta.magic_link_revoked_email', { email: row.email }, { label: row.email });
    redirect('/beta');
  }

  await audit('beta.magic_link_verified', { email: row.email }, { label: row.email });
  await grantBetaAccess(`email:${row.email}`);
  redirect('/');
}
