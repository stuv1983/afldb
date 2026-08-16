import type { Metadata } from 'next';

import { AdminSessionsClient } from '@/app/admin/admins/AdminSessionsClient';
import { InviteManager } from '@/app/admin/admins/InviteManager';
import { authSql } from '@/db/authClient';
import { hasAdminManagementAccess, requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administrators',
  robots: { index: false, follow: false },
};

type SessionRow = {
  userId: number;
  email: string;
  role: string;
  canManageAdmins: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  sessionId: number | null;
  createdAt: Date | null;
  expiresAt: Date | null;
  ip: string | null;
  userAgent: string | null;
};

type InviteRow = {
  id: number;
  email: string;
  role: string;
  canManageAdmins: boolean;
  invitedByEmail: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export default async function AdminsPage() {
  const admin = await requireAdmin();
  const canManage = hasAdminManagementAccess(admin);

  const [rows, invites] = await Promise.all([
    authSql<SessionRow[]>`
      SELECT u.id AS "userId", u.email, u.role, u.can_manage_admins AS "canManageAdmins",
             u.must_change_password AS "mustChangePassword",
             u.password_changed_at  AS "passwordChangedAt",
             s.id AS "sessionId", s.created_at AS "createdAt", s.expires_at AS "expiresAt",
             s.ip::text AS ip, s.user_agent AS "userAgent"
        FROM auth_users u
        LEFT JOIN auth_sessions s
          ON s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
       ORDER BY u.email, s.created_at DESC
    `,
    canManage
      ? authSql<InviteRow[]>`
          SELECT i.id, i.email, i.role, i.can_manage_admins AS "canManageAdmins",
                 inv.email AS "invitedByEmail", i.created_at AS "createdAt",
                 i.expires_at AS "expiresAt", i.used_at AS "usedAt", i.revoked_at AS "revokedAt"
            FROM admin_invites i
            JOIN auth_users inv ON inv.id = i.invited_by
           ORDER BY i.created_at DESC
           LIMIT 100
        `
      : Promise.resolve([]),
  ]);

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
          {canManage
            ? 'Invite new admins below, reset a forgotten password, or sign a live '
              + 'session out.'
            : 'This page can sign a live session out. Ask a super admin for an invite link.'}
        </p>
      </div>

      <AdminSessionsClient
        canManage={canManage}
        viewerId={admin.id}
        admins={[...admins.entries()].map(([email, sessions]) => ({
          userId: sessions[0].userId,
          email,
          role: sessions[0].role,
          canManageAdmins: sessions[0].canManageAdmins,
          mustChangePassword: sessions[0].mustChangePassword,
          passwordChangedAt: sessions[0].passwordChangedAt?.toISOString() ?? null,
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

      {canManage && (
        <InviteManager
          canGrantSuperAdmin={admin.role === 'super_admin'}
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            canManageAdmins: i.canManageAdmins,
            invitedByEmail: i.invitedByEmail,
            createdAt: i.createdAt.toISOString(),
            expiresAt: i.expiresAt.toISOString(),
            usedAt: i.usedAt?.toISOString() ?? null,
            revokedAt: i.revokedAt?.toISOString() ?? null,
          }))}
        />
      )}
    </>
  );
}
