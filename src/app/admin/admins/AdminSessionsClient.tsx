'use client';

import { useActionState } from 'react';

import { revokeSession, type AdminSessionState } from '@/app/admin/admins/actions';
import { CollapsibleTable } from '@/components/CollapsibleTable';

type Session = {
  sessionId: number;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
};

type Admin = { email: string; role: string; canManageAdmins: boolean; sessions: Session[] };

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

export function AdminSessionsClient({ admins }: { admins: Admin[] }) {
  return (
    <>
      {admins.map((admin) => {
        const roleLabel = admin.role === 'super_admin' ? 'Super admin'
          : admin.canManageAdmins ? 'Admin · can manage admins' : 'Admin';
        return (
          <CollapsibleTable
            key={admin.email}
            title={`${admin.email} · ${roleLabel}`}
            note={`${admin.sessions.length} live session${admin.sessions.length === 1 ? '' : 's'}`}
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
          </CollapsibleTable>
        );
      })}
    </>
  );
}
