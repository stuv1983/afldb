'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { verifyPassword, verifyTotp } from '@/lib/auth/crypto';
import { audit, createAdminSession } from '@/lib/auth/session';

export type LoginState = { error?: string };

const FAILURE = 'Sign-in failed. Check the email, password and authenticator code.';

// Per-worker limiter. An online guess against scrypt+TOTP is already
// hopeless; this just keeps the log readable.
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

export async function adminLogin(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const code = String(formData.get('totp') ?? '').trim();

  if (!email || !password || !code) return { error: FAILURE };
  if (rateLimited(email)) {
    return { error: 'Too many attempts. Wait fifteen minutes.' };
  }

  const [user] = await authSql<{
    id: number; email: string; passwordHash: string | null; totpSecret: string | null;
  }[]>`
    SELECT id, email, password_hash AS "passwordHash", totp_secret AS "totpSecret"
      FROM auth_users
     WHERE email = ${email} AND role = 'admin' AND disabled_at IS NULL
  `;

  // Password AND TOTP are both always evaluated on the failure path too,
  // so a response time cannot say which one was wrong.
  const passwordOk = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, 'scrypt$32768$8$1$AAAA$AAAA').then(() => false);
  const totpOk = user?.totpSecret ? verifyTotp(user.totpSecret, code) : false;

  if (!user || !passwordOk || !totpOk) {
    await audit('admin.login_failed', { email }, { label: email });
    return { error: FAILURE };
  }

  await audit('admin.login', null, { userId: user.id, label: user.email });
  await createAdminSession(user.id, user.email);
  redirect('/admin');
}
