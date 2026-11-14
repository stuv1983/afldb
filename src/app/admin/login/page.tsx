import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/admin/login/LoginForm';
import { adminClaimBelowBetaEpoch, getAdminUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administrator sign-in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  // A signed-in admin is normally sent straight to /admin. The exception (review B-05): after an
  // AFLDB_BETA_EPOCH bump their cookie is below the current epoch, so the public pages send them
  // to /beta while /admin still works. Bouncing them back here would leave sign-out then sign-in
  // as the only way to a current cookie, so the form is shown instead. Signing in is the same full
  // password + authenticator check as ever; nothing is re-issued from the old cookie.
  const admin = await getAdminUser();
  const reauthenticate = admin !== null && await adminClaimBelowBetaEpoch();
  if (admin && !reauthenticate) redirect('/admin');

  return (
    <div style={{ maxWidth: '24rem', margin: '4rem auto' }}>
      <div className="page-header">
        <h1>Administrator sign-in</h1>
        <p className="subtitle">Password and authenticator code required.</p>
      </div>
      {reauthenticate ? (
        <p role="status" data-testid="admin-reauth-notice">
          Your administrator session predates the current beta access setting, so the public
          pages are asking you to enter the beta. Sign in again to refresh it. You are still
          signed in to the <Link href="/admin">admin area</Link> until then.
        </p>
      ) : null}
      <LoginForm />
    </div>
  );
}
