'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { verifyPassword, verifyTotpStep } from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, createAdminSession, requestIp } from '@/lib/auth/session';

export type LoginState = { error?: string };

const FAILURE = 'Sign-in failed. Check the email, password and authenticator code.';

// Per-worker limiter, keyed on the caller's IP and checked BEFORE the scrypt
// verification below. That ordering is the point: verifyPassword runs a full
// scrypt (N=2^15) on every attempt — including a dummy hash for unknown users
// — so without an up-front per-caller cap an unauthenticated client could
// send a burst of logins and pin every worker's CPU (public pages included).
// Keying on the attacker-chosen email, as this used to, neither bounded that
// work (a fresh email is a fresh bucket) nor was safe (a known admin address
// could be locked out on demand).
const LOGIN_LIMIT = new RateLimiter(8, 15 * 60 * 1000);

export async function adminLogin(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const code = String(formData.get('totp') ?? '').trim();

  if (!email || !password || !code) return { error: FAILURE };
  if (LOGIN_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { error: 'Too many attempts. Wait fifteen minutes.' };
  }

  const [user] = await authSql<{
    id: number; email: string; passwordHash: string | null; totpSecret: string | null;
  }[]>`
    SELECT id, email, password_hash AS "passwordHash", totp_secret AS "totpSecret"
      FROM auth_users
     WHERE email = ${email} AND role IN ('admin', 'super_admin', 'contributor')
       AND disabled_at IS NULL
  `;

  // Password AND TOTP are both always evaluated on the failure path too,
  // so a response time cannot say which one was wrong.
  const passwordOk = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, 'scrypt$32768$8$1$AAAA$AAAA').then(() => false);
  const totpStep = user?.totpSecret ? verifyTotpStep(user.totpSecret, code) : null;

  if (!user || !passwordOk || totpStep === null) {
    await audit('admin.login_failed', { email }, { label: email });
    return { error: FAILURE };
  }

  // A one-time password must be usable exactly once (RFC 6238 §5.2). The
  // step is claimed in the same statement that tests it, so two requests
  // racing with the same code cannot both succeed, and a code observed
  // over a shoulder or in transit is dead the moment the owner uses it.
  // Claimed only after the password has already passed, so knowing a code
  // alone cannot burn a step the legitimate owner is about to need.
  const [claimed] = await authSql<{ id: number }[]>`
    UPDATE auth_users
       SET totp_last_step = ${totpStep}
     WHERE id = ${user.id}
       AND (totp_last_step IS NULL OR totp_last_step < ${totpStep})
    RETURNING id
  `;
  if (!claimed) {
    await audit('admin.login_totp_replay', { email }, { label: email });
    return { error: FAILURE };
  }

  await audit('admin.login', null, { userId: user.id, label: user.email });
  await createAdminSession(user.id, user.email);
  redirect('/admin');
}
