'use client';

import { useActionState } from 'react';

import { CollapsibleTable } from '@/components/CollapsibleTable';

import { createInvite, revokeInvite, type InviteState } from '@/app/admin/admins/invite-actions';

type InviteRow = {
  id: number;
  email: string;
  role: string;
  canManageAdmins: boolean;
  invitedByEmail: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

export function InviteManager({
  invites, canGrantSuperAdmin,
}: {
  invites: InviteRow[];
  /** Only an actual super admin may hand out super_admin or delegate can_manage_admins. */
  canGrantSuperAdmin: boolean;
}) {
  const [createState, createAction, creating] =
    useActionState<InviteState, FormData>(createInvite, {});
  const [revokeState, revokeAction] =
    useActionState<InviteState, FormData>(revokeInvite, {});

  return (
    <section className="section">
      <h2>Invite an admin</h2>
      <p className="section-note">
        Creates a one-time link good for 7 days. The invitee sets their own password and
        scans a QR code to enrol their own authenticator — nobody else ever sees their secret.
        There is no email sending yet, so copy the link and send it to them yourself.
      </p>

      <form action={createAction} style={{
        display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <label>
          Email
          <input name="email" type="email" required placeholder="them@example.com" />
        </label>
        {canGrantSuperAdmin && (
          <>
            <label>
              Role
              <select name="role" defaultValue="admin">
                <option value="admin">Admin</option>
                <option value="super_admin">Super admin</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input name="canManageAdmins" type="checkbox" />
              Can also invite/manage admins
            </label>
          </>
        )}
        <button className="btn" type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create invite'}
        </button>
      </form>

      {createState.inviteLink && (
        <p className="notice">
          {createState.message}
          <br />
          <code className="mono" style={{ fontSize: '0.85rem', userSelect: 'all', wordBreak: 'break-all' }}>
            {createState.inviteLink}
          </code>
        </p>
      )}
      {createState.error && <p className="notice" role="alert">{createState.error}</p>}
      {revokeState.message && <p className="notice">{revokeState.message}</p>}
      {revokeState.error && <p className="notice" role="alert">{revokeState.error}</p>}

      {invites.length === 0 ? (
        <p className="muted">No invites yet.</p>
      ) : (
        <CollapsibleTable title="Invites">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Invited by</th>
                <th scope="col">Expires</th>
                <th scope="col">State</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const expired = !invite.usedAt && !invite.revokedAt
                  && invite.expiresAt < new Date().toISOString();
                const state = invite.usedAt ? 'accepted'
                  : invite.revokedAt ? 'revoked'
                  : expired ? 'expired' : 'pending';
                return (
                  <tr key={invite.id}>
                    <td className="wide">{invite.email}</td>
                    <td>
                      {invite.role === 'super_admin' ? 'Super admin' : 'Admin'}
                      {invite.canManageAdmins && invite.role !== 'super_admin' ? ' (+ manage admins)' : ''}
                    </td>
                    <td className="muted">{invite.invitedByEmail}</td>
                    <td className="nowrap muted">{invite.expiresAt.slice(0, 10)}</td>
                    <td>
                      <span className={state === 'pending' ? 'badge' : 'badge badge-warn'}>
                        {state}
                      </span>
                    </td>
                    <td>
                      {state === 'pending' && (
                        <form action={revokeAction}>
                          <input type="hidden" name="id" value={invite.id} />
                          <button className="btn btn-secondary" type="submit">Revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      )}
    </section>
  );
}
