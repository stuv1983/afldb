'use client';

import { useActionState } from 'react';

import {
  addAllowedEmail,
  createAccessCode,
  revokeAccessCode,
  revokeAllowedEmail,
  type AccessState,
} from '@/app/admin/access/actions';

type CodeRow = {
  id: number; label: string; maxUses: number; useCount: number;
  createdAt: string; expiresAt: string | null; revokedAt: string | null;
};
type EmailRow = {
  id: number; email: string; note: string | null;
  addedAt: string; revokedAt: string | null;
};

export function AccessManager({ codes, emails }: { codes: CodeRow[]; emails: EmailRow[] }) {
  const [createState, createAction, creating] =
    useActionState<AccessState, FormData>(createAccessCode, {});
  const [revokeCodeState, revokeCodeAction] =
    useActionState<AccessState, FormData>(revokeAccessCode, {});
  const [addEmailState, addEmailAction, addingEmail] =
    useActionState<AccessState, FormData>(addAllowedEmail, {});
  const [revokeEmailState, revokeEmailAction] =
    useActionState<AccessState, FormData>(revokeAllowedEmail, {});

  return (
    <>
      <section className="section">
        <h2>Access codes</h2>
        <form action={createAction} style={{
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end',
        }}>
          <label>
            Label (who is this for?)
            <input name="label" required minLength={2} placeholder="e.g. Dave from the footy forum" />
          </label>
          <label>
            Uses
            <input name="maxUses" type="number" defaultValue={1} min={1} max={500}
              style={{ width: '5rem' }} />
          </label>
          <label>
            Valid (days)
            <input name="days" type="number" defaultValue={90} min={1} max={365}
              style={{ width: '5rem' }} />
          </label>
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create code'}
          </button>
        </form>

        {createState.newCode && (
          <p className="notice">
            {createState.message}
            <br />
            <code className="mono" style={{ fontSize: '1rem', userSelect: 'all' }}>
              {createState.newCode}
            </code>
          </p>
        )}
        {createState.error && <p className="notice" role="alert">{createState.error}</p>}
        {revokeCodeState.message && <p className="notice">{revokeCodeState.message}</p>}
        {revokeCodeState.error && <p className="notice" role="alert">{revokeCodeState.error}</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col" className="num">Used</th>
                <th scope="col">Expires</th>
                <th scope="col">State</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => {
                const spent = code.useCount >= code.maxUses;
                const expired = code.expiresAt !== null && code.expiresAt < new Date().toISOString();
                const state = code.revokedAt ? 'revoked' : spent ? 'spent' : expired ? 'expired' : 'live';
                return (
                  <tr key={code.id}>
                    <td className="wide">{code.label}</td>
                    <td className="num">{code.useCount}/{code.maxUses}</td>
                    <td className="nowrap muted">{code.expiresAt?.slice(0, 10) ?? 'never'}</td>
                    <td>
                      <span className={state === 'live' ? 'badge' : 'badge badge-warn'}>
                        {state}
                      </span>
                    </td>
                    <td>
                      {state === 'live' && (
                        <form action={revokeCodeAction}>
                          <input type="hidden" name="id" value={code.id} />
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
      </section>

      <section className="section">
        <h2>Allowlisted emails</h2>
        <p className="section-note">
          An allowlisted address can request a single-use sign-in link on the beta page.
          Until SMTP is configured the link appears in the service log
          (<code>journalctl -u afldb | grep magic</code>) for you to pass on.
        </p>
        <form action={addEmailAction} style={{
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end',
        }}>
          <label>
            Email
            <input name="email" type="email" required placeholder="them@example.com" />
          </label>
          <label>
            Note
            <input name="note" placeholder="optional" />
          </label>
          <button className="btn" type="submit" disabled={addingEmail}>
            {addingEmail ? 'Adding…' : 'Allow email'}
          </button>
        </form>

        {addEmailState.message && <p className="notice">{addEmailState.message}</p>}
        {addEmailState.error && <p className="notice" role="alert">{addEmailState.error}</p>}
        {revokeEmailState.message && <p className="notice">{revokeEmailState.message}</p>}
        {revokeEmailState.error && <p className="notice" role="alert">{revokeEmailState.error}</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Note</th>
                <th scope="col">State</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {emails.map((entry) => (
                <tr key={entry.id}>
                  <td className="wide">{entry.email}</td>
                  <td className="muted">{entry.note ?? ''}</td>
                  <td>
                    <span className={entry.revokedAt ? 'badge badge-warn' : 'badge'}>
                      {entry.revokedAt ? 'revoked' : 'allowed'}
                    </span>
                  </td>
                  <td>
                    {!entry.revokedAt && (
                      <form action={revokeEmailAction}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button className="btn btn-secondary" type="submit">Revoke</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
