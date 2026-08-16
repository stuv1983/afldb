import type { Metadata } from 'next';

import { AccessManager } from '@/app/admin/access/AccessManager';
import { authSql } from '@/db/authClient';
import { labelAnswers, parseAnswers } from '@/db/queries/early-access';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { betaGateEnabled, requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Beta access',
  robots: { index: false, follow: false },
};

export default async function AccessPage() {
  await requireAdmin();

  const [settings, [codes, emails, requests]] = await Promise.all([
    // Needed to label the stored answers with their questions' CURRENT
    // wording; see labelAnswers.
    getSiteSettingsForAdmin(),
    Promise.all([
      authSql<{
        id: number; label: string; maxUses: number | null; useCount: number;
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
      authSql<{
        id: number; email: string; name: string | null; message: string | null;
        answers: unknown; requestedAt: Date;
      }[]>`
        SELECT id, email, name, message, answers, requested_at AS "requestedAt"
          FROM beta_join_requests
         WHERE status = 'pending'
         ORDER BY requested_at
         LIMIT 100
      `,
    ]),
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
        requests={requests.map((r) => ({
          ...r,
          requestedAt: r.requestedAt.toISOString(),
          // Flattened to label/value pairs here rather than in the client
          // component, so the question list never has to cross the boundary.
          answers: labelAnswers(parseAnswers(r.answers), settings.earlyAccessQuestions),
        }))}
      />
    </>
  );
}
