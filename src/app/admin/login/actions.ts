'use server';

import { redirect } from 'next/navigation';

import { authSql } from '@/db/authClient';
import { issueLoginSessionInTransaction } from '@/db/queries/admin-credentials';
import { verifyPassword, verifyTotpStep } from '@/lib/auth/crypto';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { audit, prepareAdminSession, requestIp, setAdminSessionCookie } from '@/lib/auth/session';

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

  // AFLDB-ISSUE-186 Phase A: 'contributor' deliberately excluded, matching
  // getAdminUser() in session.ts. An existing contributor row (valid
  // password + TOTP, disabled_at still NULL) can no longer establish a
  // session here at all -- interactive sign-in is closed at this query,
  // not merely at a later role check, so the account never even reaches
  // the session insert (issueLoginSessionInTransaction re-checks it too).
  const [user] = await authSql<{
    id: number; email: string; passwordHash: string | null; totpSecret: string | null;
  }[]>`
    SELECT id, email, password_hash AS "passwordHash", totp_secret AS "totpSecret"
      FROM auth_users
     WHERE email = ${email} AND role IN ('admin', 'super_admin')
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
  //
  // AFLDB-ISSUE-340: the claim and the session INSERT happen under the
  // account's row lock, and only if the stored hash and TOTP secret are
  // still the ones verified above. A password change, reset or re-enrolment
  // that committed after that verification has rotated the hash and revoked
  // every session; this request then mints nothing. The cookie is set only
  // after the transaction commits.
  const pending = await prepareAdminSession();
  const outcome = await authSql.begin((tx) => issueLoginSessionInTransaction(tx, {
    userId: user.id,
    verifiedPasswordHash: user.passwordHash!,
    verifiedTotpSecret: user.totpSecret!,
    totpStep,
    session: pending.row,
  }));
  if (!outcome.ok) {
    await audit(
      outcome.reason === 'totp_replay' ? 'admin.login_totp_replay' : 'admin.login_credentials_changed',
      { email },
      { label: email },
    );
    return { error: FAILURE };
  }

  await audit('admin.login', null, { userId: user.id, label: user.email });
  await setAdminSessionCookie(user.id, pending.token);
  redirect('/admin');
}
