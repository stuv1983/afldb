import type { Metadata } from 'next';

import { ChangePasswordForm } from '@/app/admin/password/ChangePasswordForm';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/crypto';
import { requireSignedIn } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Change password',
  robots: { index: false, follow: false },
};

/**
 * The one admin page an account carrying a temporary password can reach.
 *
 * `requireSignedIn` rather than `requireUploader`: the latter redirects an
 * account with `must_change_password` to this very page, so using it here
 * would be a loop. Every other admin route wants `requireUploader` or
 * stronger — see the note on both in src/lib/auth/session.ts.
 */
export default async function ChangePasswordPage() {
  const admin = await requireSignedIn();

  return (
    <>
      <div className="page-header">
        <h1>Change password</h1>
        <p className="subtitle">{admin.email}</p>
      </div>

      {admin.mustChangePassword && (
        <p className="notice" role="alert">
          <strong>Your password was reset by an administrator.</strong> The password you
          signed in with is temporary and the rest of the admin area is closed until you
          replace it. Your authenticator app is unchanged — you will keep using the same
          codes.
        </p>
      )}

      <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />

      <p className="muted" style={{ fontSize: '0.8125rem', marginTop: '1.25rem', maxWidth: '34rem' }}>
        Changing your password signs out every device, including this one, and signs this
        browser straight back in. If you have lost your authenticator app rather than your
        password, this is the wrong page: ask a super admin for a fresh invite link, which
        re-enrols both.
      </p>
    </>
  );
}
