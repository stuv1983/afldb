'use client';

import { useActionState, useState } from 'react';

import { CollapsibleTable } from '@/components/CollapsibleTable';

import {
  addAllowedEmail,
  approveJoinRequest,
  createAccessCode,
  denyJoinRequest,
  revokeAccessCode,
  revokeAllowedEmail,
  type AccessState,
} from '@/app/admin/access/actions';

type CodeRow = {
  id: number; label: string;
  /** Null means unlimited (migration 036), as a null expiresAt means never. */
  maxUses: number | null;
  useCount: number;
  createdAt: string; expiresAt: string | null; revokedAt: string | null;
};
type EmailRow = {
  id: number; email: string; note: string | null;
  addedAt: string; revokedAt: string | null;
};
type JoinRequestRow = {
  id: number; email: string; name: string | null; message: string | null;
  requestedAt: string;
  /**
   * Answers to the configured early-access questions, already paired with
   * their current labels server-side. Empty for requests made through the
   * /beta gate form, which collects `message` instead.
   */
  answers: { label: string; value: string; orphaned: boolean }[];
};

export function AccessManager({
  codes, emails, requests,
}: {
  codes: CodeRow[]; emails: EmailRow[]; requests: JoinRequestRow[];
}) {
  const [createState, createAction, creating] =
    useActionState<AccessState, FormData>(createAccessCode, {});
  const [revokeCodeState, revokeCodeAction] =
    useActionState<AccessState, FormData>(revokeAccessCode, {});
  const [addEmailState, addEmailAction, addingEmail] =
    useActionState<AccessState, FormData>(addAllowedEmail, {});
  const [revokeEmailState, revokeEmailAction] =
    useActionState<AccessState, FormData>(revokeAllowedEmail, {});
  const [approveState, approveAction] =
    useActionState<AccessState, FormData>(approveJoinRequest, {});
  const [denyState, denyAction] =
    useActionState<AccessState, FormData>(denyJoinRequest, {});

  // Only so the Uses field can be greyed out while Unlimited is ticked. The
  // action reads the checkbox itself and ignores maxUses when it is set, so
  // this is presentation, not the decision.
  const [unlimited, setUnlimited] = useState(false);

  return (
    <>
      <section className="section">
        <p className="section-note">
          Visitors who asked for access — from the beta page, or from the early-access
          form on afldb.com — rather than using a code or an allowlisted email.
          Approving allowlists the email immediately. The questions that form asks are
          set in <a href="/admin/settings">Site settings</a>.
        </p>

        {approveState.message && <p className="notice">{approveState.message}</p>}
        {approveState.error && <p className="notice" role="alert">{approveState.error}</p>}
        {denyState.message && <p className="notice">{denyState.message}</p>}
        {denyState.error && <p className="notice" role="alert">{denyState.error}</p>}

        {requests.length === 0 ? (
          <p className="muted">No pending requests.</p>
        ) : (
          <CollapsibleTable title="Requests" note={`${requests.length} pending`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">What they said</th>
                  <th scope="col">Requested</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td className="wide">{request.email}</td>
                    <td className="muted">{request.name ?? ''}</td>
                    <td className="wide muted">
                      {/* A request carries either the old gate form's single
                          message or the configured questions' answers, never
                          both — but both are rendered so neither form's
                          history becomes unreadable. */}
                      {request.message && <p style={{ margin: 0 }}>{request.message}</p>}
                      {request.answers.map((answer) => (
                        <p key={answer.label} style={{ margin: '0 0 0.35rem' }}>
                          <span
                            style={{ display: 'block', fontSize: '0.72rem' }}
                            title={answer.orphaned
                              ? 'This question has since been removed; the id is shown instead of a label.'
                              : undefined}
                          >
                            {answer.label}{answer.orphaned ? ' (removed)' : ''}
                          </span>
                          {answer.value}
                        </p>
                      ))}
                      {!request.message && request.answers.length === 0 && '—'}
                    </td>
                    <td className="nowrap muted">{request.requestedAt.slice(0, 10)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <form action={approveAction}>
                          <input type="hidden" name="id" value={request.id} />
                          <button className="btn" type="submit">Approve</button>
                        </form>
                        <form action={denyAction}>
                          <input type="hidden" name="id" value={request.id} />
                          <button className="btn btn-secondary" type="submit">Deny</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        )}
      </section>

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
              disabled={unlimited} style={{ width: '5rem' }} />
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="unlimited"
              checked={unlimited}
              onChange={(e) => setUnlimited(e.target.checked)}
              style={{ marginRight: '0.35rem' }}
            />
            Unlimited
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

        <CollapsibleTable title="Existing codes">
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
                // A null maxUses is unlimited (migration 036) and can never be
                // spent — only revoked or expired.
                const spent = code.maxUses !== null && code.useCount >= code.maxUses;
                const expired = code.expiresAt !== null && code.expiresAt < new Date().toISOString();
                const state = code.revokedAt ? 'revoked' : spent ? 'spent' : expired ? 'expired' : 'live';
                return (
                  <tr key={code.id}>
                    <td className="wide">{code.label}</td>
                    <td className="num">
                      {code.useCount}/{code.maxUses ?? '∞'}
                    </td>
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
        </CollapsibleTable>
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

        <CollapsibleTable title="Allowed addresses">
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
        </CollapsibleTable>
      </section>
    </>
  );
}
