import type { Metadata } from 'next';

import { AdminSessionsClient } from '@/app/admin/admins/AdminSessionsClient';
import { authSql } from '@/db/authClient';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administrators',
  robots: { index: false, follow: false },
};

type SessionRow = {
  userId: number;
  email: string;
  sessionId: number | null;
  createdAt: Date | null;
  expiresAt: Date | null;
  ip: string | null;
  userAgent: string | null;
};

export default async function AdminsPage() {
  await requireAdmin();

  const rows = await authSql<SessionRow[]>`
    SELECT u.id AS "userId", u.email,
           s.id AS "sessionId", s.created_at AS "createdAt", s.expires_at AS "expiresAt",
           s.ip::text AS ip, s.user_agent AS "userAgent"
      FROM auth_users u
      LEFT JOIN auth_sessions s
        ON s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
     ORDER BY u.email, s.created_at DESC
  `;

  const admins = new Map<string, SessionRow[]>();
  for (const row of rows) {
    if (!admins.has(row.email)) admins.set(row.email, []);
    admins.get(row.email)!.push(row);
  }

  return (
    <>
      <div className="page-header">
        <h1>Administrators</h1>
        <p className="subtitle">
          Accounts are created and disabled from the server shell only. This page can
          sign a live session out.
        </p>
      </div>

      <AdminSessionsClient
        admins={[...admins.entries()].map(([email, sessions]) => ({
          email,
          sessions: sessions
            .filter((s) => s.sessionId !== null)
            .map((s) => ({
              sessionId: s.sessionId!,
              createdAt: s.createdAt!.toISOString(),
              expiresAt: s.expiresAt!.toISOString(),
              ip: s.ip,
              userAgent: s.userAgent,
            })),
        }))}
      />
    </>
  );
}
