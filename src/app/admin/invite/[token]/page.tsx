import type { Metadata } from 'next';

import { AcceptInviteForm } from '@/app/admin/invite/[token]/AcceptInviteForm';
import { authSql } from '@/db/authClient';
import { sha256Hex } from '@/lib/auth/crypto';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Accept admin invite',
  robots: { index: false, follow: false },
};

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [invite] = await authSql<{ email: string; role: string }[]>`
    SELECT email, role FROM admin_invites
     WHERE token_hash = ${sha256Hex(token)}
       AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `;

  if (!invite) {
    return (
      <div style={{ maxWidth: '28rem', margin: '4rem auto' }}>
        <div className="page-header">
          <h1>Invite not available</h1>
          <p className="subtitle">
            This link is invalid, has already been used, or has expired. Ask whoever invited
            you for a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '28rem', margin: '4rem auto' }}>
      <div className="page-header">
        <h1>Set up your admin account</h1>
        <p className="subtitle">
          {invite.email} · {
            invite.role === 'super_admin' ? 'Super admin'
              : invite.role === 'contributor' ? 'Contributor'
              : 'Admin'
          }
        </p>
      </div>
      <AcceptInviteForm token={token} />
    </div>
  );
}
