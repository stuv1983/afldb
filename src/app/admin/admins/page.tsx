import type { Metadata } from 'next';

import { AdminSessionsClient } from '@/app/admin/admins/AdminSessionsClient';
import { InviteManager } from '@/app/admin/admins/InviteManager';
import { authSql } from '@/db/authClient';
import { listAdminAccounts } from '@/db/queries/admin-users';
import { hasAdminManagementAccess, requireCapability } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administrators',
  robots: { index: false, follow: false },
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
  // Ordinary admins keep this page: they read the account list and manage
  // their OWN sessions. The lifecycle controls are rendered only for a
  // super admin, and the four Server Actions behind them call
  // requireSuperAdmin() for themselves (AFLDB-ISSUE-155 Phase B §26.9).
  // people.admins.read is Admin-and-up: the same door requireAdmin() kept
  // before AFLDB-ISSUE-158.
  const admin = await requireCapability('people.admins.read');
  const canManage = hasAdminManagementAccess(admin);

  const [{ accounts, sessions }, invites] = await Promise.all([
    listAdminAccounts(authSql, { id: admin.id, role: admin.role }),
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

  const sessionsByUser = new Map<number, typeof sessions>();
  for (const session of sessions) {
    if (!sessionsByUser.has(session.userId)) sessionsByUser.set(session.userId, []);
    sessionsByUser.get(session.userId)!.push(session);
  }

  return (
    <>
      <div className="page-header">
        <h1>Administrators</h1>
        <p className="subtitle">
          {admin.role === 'super_admin'
            ? 'Promote, demote, deactivate or reactivate an account, invite new admins, '
              + 'reset a forgotten password, or sign a live session out. Accounts are '
              + 'never deleted.'
            : canManage
              ? 'Invite new admins below, reset a forgotten password, or sign your own '
                + 'session out.'
              : 'This page lists the accounts and can sign your own session out. '
                + 'Ask a super admin for an invite link.'}
        </p>
      </div>

      <AdminSessionsClient
        canManage={canManage}
        viewer={{ id: admin.id, role: admin.role }}
        admins={accounts.map((account) => ({
          id: account.id,
          email: account.email,
          role: account.role,
          canManageAdmins: account.canManageAdmins,
          disabledAt: account.disabledAt?.toISOString() ?? null,
          hasPassword: account.hasPassword,
          hasTotp: account.hasTotp,
          mustChangePassword: account.mustChangePassword,
          passwordChangedAt: account.passwordChangedAt?.toISOString() ?? null,
          createdAt: account.createdAt.toISOString(),
          lastSignInAt: account.lastSignInAt?.toISOString() ?? null,
          sessions: (sessionsByUser.get(account.id) ?? []).map((s) => ({
            sessionId: s.sessionId,
            createdAt: s.createdAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
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
