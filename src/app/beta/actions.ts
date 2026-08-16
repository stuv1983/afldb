'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { generateToken, sha256Hex } from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, grantBetaAccess, requestIp } from '@/lib/auth/session';

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

export type JoinRequestState = {
  error?: string;
  requested?: boolean;
};

const GENERIC_FAILURE =
  'That code or email was not accepted. Check it and try again, or contact the person who invited you.';

// A visitor who fails repeatedly is guessing. Small in-memory limiters, per
// worker: crude, but the right shape for a beta of dozens of people. Keyed on
// the caller's IP, never on the code or email they supply — keying on content
// let an attacker rotate it to dodge the limit, and because every real code
// starts "afldb-" it also collapsed all genuine redemptions into one bucket a
// few bad guesses could exhaust for everyone.
const REDEEM_LIMIT = new RateLimiter(10, 15 * 60 * 1000);
const MAGIC_LINK_LIMIT = new RateLimiter(5, 15 * 60 * 1000);
const JOIN_REQUEST_LIMIT = new RateLimiter(5, 15 * 60 * 1000);

/** Where to send an admitted visitor: only ever an internal path. */
function safeDestination(from: FormDataEntryValue | null): string {
  if (typeof from !== 'string') return '/';
  // Must be an absolute same-origin path: a leading '/' whose next character
  // is neither '/' nor '\'. Browsers fold '/\' (and '\/') into '//', so the
  // old '//' check alone let `/\evil.com` through as a protocol-relative,
  // off-origin redirect. Also reject control characters (header/redirect
  // splitting).
  if (!/^\/[^/\\]/.test(from)) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(from)) return '/';
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
  if (REDEEM_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  // Atomic redeem: the use is counted in the same statement that checks
  // the limits, so a code cannot be double-spent by two racing requests.
  //
  // A NULL max_uses means unlimited (migration 036), matching the NULL
  // expires_at convention on the line above. Without the explicit IS NULL
  // test this comparison would be NULL rather than true, and an unlimited
  // code would be refused every time — the failure mode is silent, because
  // "not accepted" is the same message a wrong code gets.
  const [row] = await authSql<{ id: number; label: string }[]>`
    UPDATE beta_access_codes
       SET use_count = use_count + 1
     WHERE code_hash = ${sha256Hex(code)}
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR use_count < max_uses)
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
  if (MAGIC_LINK_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
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

    // The link carries a live 30-minute credential, so it must never reach a
    // production log. In development there is no SMTP and the operator reads
    // the link from the log to pass it on; in production the token stays out
    // of the journal and the SMTP hook (still one function) must deliver it.
    if (process.env.AFLDB_ENV === 'production') {
      // TODO: deliver `link` by email. Deliberately NOT logged.
      console.info(`[beta] magic link issued for ${email}`);
    } else {
      console.info(`[beta] magic link for ${email}: ${link}`);
    }
    await audit('beta.magic_link_issued', { email }, { label: email });
  } else {
    await audit('beta.magic_link_refused', { email }, { label: email });
  }

  return { sent: true };
}

/**
 * A visitor with neither a code nor an allowlisted email can ask instead.
 * This never admits anyone by itself — it only queues a row for a human at
 * /admin/access to approve or deny, at which point approval allowlists the
 * email through the normal path.
 */
export async function requestJoin(
  _previous: JoinRequestState,
  formData: FormData,
): Promise<JoinRequestState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim().slice(0, 200) || null;
  const message = String(formData.get('message') ?? '').trim().slice(0, 1000) || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    return { error: 'That is not an email address.' };
  }
  if (JOIN_REQUEST_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const ip = await requestIp();
  await authSql`
    INSERT INTO beta_join_requests (email, name, message, ip)
    VALUES (${email}, ${name}, ${message}, ${ip})
    ON CONFLICT (email) WHERE status = 'pending' DO NOTHING
  `;
  await audit('beta.join_requested', { email }, { label: email });

  return { requested: true };
}
