'use client';

import { useActionState } from 'react';

import { revokeSession, type AdminSessionState } from '@/app/admin/admins/actions';
import {
  issueTemporaryPassword,
  type PasswordResetState,
} from '@/app/admin/admins/password-actions';
import { CollapsibleTable } from '@/components/CollapsibleTable';

type Session = {
  sessionId: number;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
};

type Admin = {
  userId: number;
  email: string;
  role: string;
  canManageAdmins: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  sessions: Session[];
};

function SessionRow({ session }: { session: Session }) {
  const [state, action, pending] = useActionState<AdminSessionState, FormData>(revokeSession, {});

  return (
    <tr>
      <td className="nowrap muted">{session.createdAt.slice(0, 16).replace('T', ' ')}</td>
      <td className="nowrap muted">{session.expiresAt.slice(0, 16).replace('T', ' ')}</td>
      <td className="muted">{session.ip ?? '—'}</td>
      <td className="wide muted" style={{ fontSize: '0.75rem' }}>{session.userAgent ?? '—'}</td>
      <td>
        <form action={action}>
          <input type="hidden" name="sessionId" value={session.sessionId} />
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? 'Signing out…' : 'Sign out'}
          </button>
        </form>
        {state.error && <p className="notice" role="alert" style={{ marginTop: '0.3rem' }}>{state.error}</p>}
        {state.message && <p className="notice" style={{ marginTop: '0.3rem' }}>{state.message}</p>}
      </td>
    </tr>
  );
}

/**
 * The reset control, and the one place the generated password is ever shown.
 *
 * Its own component with its own action state, so the result belongs to the
 * account it was issued for rather than to a banner at the top of a page
 * listing eight of them. The password is not stored, so this is the only
 * chance to copy it — which is why it is rendered large, in the monospace
 * face, and says so.
 */
function PasswordReset({ admin, isSelf }: { admin: Admin; isSelf: boolean }) {
  const [state, action, pending] = useActionState<PasswordResetState, FormData>(
    issueTemporaryPassword, {},
  );

  if (isSelf) {
    return (
      <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.5rem 0 0' }}>
        This is your own account. <a href="/admin/password">Change your password →</a>
      </p>
    );
  }

  return (
    <div style={{ marginTop: '0.6rem' }}>
      <form action={action}>
        <input type="hidden" name="userId" value={admin.userId} />
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? 'Resetting…' : 'Reset password'}
        </button>
      </form>

      {state.error && (
        <p className="notice" role="alert" style={{ marginTop: '0.5rem' }}>{state.error}</p>
      )}

      {state.temporaryPassword && (
        <div className="notice" style={{ marginTop: '0.5rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>{state.message}</p>
          <p
            className="mono"
            style={{ margin: 0, fontSize: '1.125rem', color: 'var(--text)', userSelect: 'all' }}
          >
            {state.temporaryPassword}
          </p>
        </div>
      )}
    </div>
  );
}

export function AdminSessionsClient({
  admins,
  canManage,
  viewerId,
}: {
  admins: Admin[];
  /** Whether the viewer may reset other people's passwords. */
  canManage: boolean;
  viewerId: number;
}) {
  return (
    <>
      {admins.map((admin) => {
        const roleLabel = admin.role === 'super_admin' ? 'Super admin'
          : admin.role === 'contributor' ? 'Contributor'
          : admin.canManageAdmins ? 'Admin · can manage admins' : 'Admin';
        return (
          <CollapsibleTable
            key={admin.email}
            title={`${admin.email} · ${roleLabel}`}
            note={[
              `${admin.sessions.length} live session${admin.sessions.length === 1 ? '' : 's'}`,
              admin.mustChangePassword ? 'temporary password outstanding' : '',
            ].filter(Boolean).join(' · ')}
          >
            {admin.sessions.length === 0 ? (
              <p className="muted">No live sessions.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Signed in</th>
                      <th scope="col">Expires</th>
                      <th scope="col">IP</th>
                      <th scope="col">Device</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {admin.sessions.map((s) => <SessionRow key={s.sessionId} session={s} />)}
                  </tbody>
                </table>
              </div>
            )}

            <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.75rem' }}>
              Password last changed{' '}
              {admin.passwordChangedAt
                ? admin.passwordChangedAt.slice(0, 16).replace('T', ' ')
                : 'before this was recorded'}
              {admin.mustChangePassword
                && ' — a temporary password has been issued and not yet replaced.'}
            </p>

            {canManage && <PasswordReset admin={admin} isSelf={admin.userId === viewerId} />}
          </CollapsibleTable>
        );
      })}
    </>
  );
}
