import type { Metadata } from 'next';

import { AccessManager } from '@/app/admin/access/AccessManager';
import { authSql } from '@/db/authClient';
import { betaGateEnabled, requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Beta access',
  robots: { index: false, follow: false },
};

export default async function AccessPage() {
  await requireAdmin();

  const [codes, emails] = await Promise.all([
    authSql<{
      id: number; label: string; maxUses: number; useCount: number;
      createdAt: Date; expiresAt: Date | null; revokedAt: Date | null;
    }[]>`
      SELECT id, label, max_uses AS "maxUses", use_count AS "useCount",
             created_at AS "createdAt", expires_at AS "expiresAt",
             revoked_at AS "revokedAt"
        FROM beta_access_codes
       ORDER BY created_at DESC
       LIMIT 100
    `,
    authSql<{
      id: number; email: string; note: string | null;
      addedAt: Date; revokedAt: Date | null;
    }[]>`
      SELECT id, email, note, added_at AS "addedAt", revoked_at AS "revokedAt"
        FROM beta_allowed_emails
       ORDER BY added_at DESC
       LIMIT 200
    `,
  ]);

  return (
    <>
      <div className="page-header">
        <h1>Beta access</h1>
        <p className="subtitle">
          The gate is currently <strong>{betaGateEnabled() ? 'ON' : 'OFF'}</strong>
          {' '}(set AFLDB_BETA_GATE=on in .env and restart to change).
        </p>
      </div>

      {!betaGateEnabled() && (
        <p className="notice">
          The site is open to anyone who can reach it. Codes and the allowlist only
          matter once the gate is on.
        </p>
      )}

      <AccessManager
        codes={codes.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
          expiresAt: c.expiresAt?.toISOString() ?? null,
          revokedAt: c.revokedAt?.toISOString() ?? null,
        }))}
        emails={emails.map((e) => ({
          ...e,
          addedAt: e.addedAt.toISOString(),
          revokedAt: e.revokedAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
