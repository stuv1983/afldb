'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import { audit, grantBetaAccess } from '@/lib/auth/session';

/**
 * The two ways into the beta: an access code, or a magic link to an
 * allowlisted email.
 *
 * Both paths deliberately return the same message on failure. "That code
 * is revoked", "that email is not on the list" and "that code never
 * existed" are three different facts internally and one sentence
 * externally, because the difference is only useful to someone probing.
 */

export type BetaFormState = {
  error?: string;
  sent?: boolean;
};

const GENERIC_FAILURE =
  'That code or email was not accepted. Check it and try again, or contact the person who invited you.';

// A visitor who fails repeatedly is guessing. Small in-memory limiter,
// per worker: crude, but the right shape for a beta of dozens of people.
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

/** Where to send an admitted visitor: only ever an internal path. */
function safeDestination(from: FormDataEntryValue | null): string {
  if (typeof from !== 'string') return '/';
  if (!from.startsWith('/') || from.startsWith('//')) return '/';
  return from;
}

export async function redeemAccessCode(
  _previous: BetaFormState,
  formData: FormData,
): Promise<BetaFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const destination = safeDestination(formData.get('from'));

  if (code.length < 8 || code.length > 100) {
    return { error: GENERIC_FAILURE };
  }
  if (rateLimited(`code:${code.slice(0, 4)}`)) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  // Atomic redeem: the use is counted in the same statement that checks
  // the limits, so a code cannot be double-spent by two racing requests.
  const [row] = await authSql<{ id: number; label: string }[]>`
    UPDATE beta_access_codes
       SET use_count = use_count + 1
     WHERE code_hash = ${sha256Hex(code)}
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND use_count < max_uses
    RETURNING id, label
  `;

  if (!row) {
    await audit('beta.code_rejected', null, { label: 'anonymous' });
    return { error: GENERIC_FAILURE };
  }

  await audit('beta.code_redeemed', { codeId: row.id, label: row.label }, { label: row.label });
  await grantBetaAccess(`code:${row.id}`);
  redirect(destination);
}

export async function requestMagicLink(
  _previous: BetaFormState,
  formData: FormData,
): Promise<BetaFormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    return { error: GENERIC_FAILURE };
  }
  if (rateLimited(`email:${email}`, 5)) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const [allowed] = await authSql<{ id: number }[]>`
    SELECT id FROM beta_allowed_emails
     WHERE email = ${email} AND revoked_at IS NULL
  `;

  // The response is the same either way; only an allowlisted email gets
  // a token. An attacker cannot enumerate the list from this form.
  if (allowed) {
    const token = generateToken();
    await authSql`
      INSERT INTO beta_login_tokens (email, token_hash, expires_at)
      VALUES (${email}, ${sha256Hex(token)}, now() + interval '30 minutes')
    `;

    const base = process.env.AFLDB_BASE_URL ?? 'http://localhost:3100';
    const link = `${base}/beta/verify?token=${token}`;

    // No SMTP is configured in development, and wiring one into a beta
    // of this size is premature. The link goes to the server log, where
    // the operator can pass it on; the SMTP hook is one function.
    console.info(`[beta] magic link for ${email}: ${link}`);
    await audit('beta.magic_link_issued', { email }, { label: email });
  } else {
    await audit('beta.magic_link_refused', { email }, { label: email });
  }

  return { sent: true };
}
