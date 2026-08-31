'use client';

import { useActionState, useState } from 'react';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';

import {
  addAllowedEmail,
  approveJoinRequest,
  createAccessCode,
  deleteAccessCode,
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

/**
 * Delete, behind a deliberate second click.
 *
 * Revoke and Delete sit in the same cell, and only one of them can be
 * undone by cutting another code. So Delete does not submit on the
 * first press: it opens an in-row confirmation naming the code, in the
 * same shape DeleteMatchButton uses for the other destructive control
 * in the admin. The button is coloured with --loss to say, before the
 * click, that this one is not like its neighbour.
 *
 * The confirmation is a courtesy to the admin, not a security control.
 * Nothing here decides whether the code may be deleted -- the action
 * re-checks the session and the DELETE matches only a row whose
 * revoked_at is set, so skipping this component entirely changes
 * nothing about what the server will accept.
 */
function DeleteCodeButton({
  code, action,
}: {
  code: CodeRow;
  action: (formData: FormData) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-danger"
        onClick={() => setConfirming(true)}
      >
        Delete…
      </button>
    );
  }

  return (
    <div className="delete-confirm">
      <p className="delete-confirm-note">
        Permanently delete “{code.label}” ({code.revokedAt ? 'revoked' : 'spent'})?
        The record goes for good; only the audit trail will remember it.
      </p>
      <div className="delete-confirm-actions">
        <form action={action}>
          <input type="hidden" name="id" value={code.id} />
          <button className="btn btn-danger" type="submit">Delete permanently</button>
        </form>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AccessManager({
  codes, emails, requests,
}: {
  codes: CodeRow[]; emails: EmailRow[]; requests: JoinRequestRow[];
}) {
  const [createState, createAction, creating] =
    useActionState<AccessState, FormData>(createAccessCode, {});
  const [revokeCodeState, revokeCodeAction] =
    useActionState<AccessState, FormData>(revokeAccessCode, {});
  const [deleteCodeState, deleteCodeAction] =
    useActionState<AccessState, FormData>(deleteAccessCode, {});
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
          <div className="table-wrap">
            <SortableTable
              defaultSort="requested"
              defaultDir="asc"
              columns={[
                { key: 'email', label: 'Email', sortType: 'text' },
                { key: 'name', label: 'Name', sortType: 'text' },
                { key: 'said', label: 'What they said', sortType: 'text' },
                { key: 'requested', label: 'Requested', sortType: 'text', className: 'nowrap' },
                { key: 'actions', label: '', sortType: 'none' },
              ]}
              items={requests.map((request) => ({
                id: String(request.id),
                values: {
                  email: request.email,
                  name: request.name ?? '',
                  said: request.message ?? '',
                  requested: request.requestedAt,
                  actions: null,
                },
                element: (
                  <tr key={request.id}>
                    <td className="wide">{request.email}</td>
                    <td className="muted">{request.name ?? ''}</td>
                    <td className="wide muted">
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
                ),
              }))}
            />
          </div>
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
        {deleteCodeState.message && <p className="notice">{deleteCodeState.message}</p>}
        {deleteCodeState.error && <p className="notice" role="alert">{deleteCodeState.error}</p>}

        <CollapsibleTable title="Existing codes">
        <div className="table-wrap">
          <div className="table-wrap">
            <SortableTable
              defaultSort="expires"
              defaultDir="desc"
              columns={[
                { key: 'label', label: 'Label', sortType: 'text' },
                { key: 'used', label: 'Used', sortType: 'number', className: 'num' },
                { key: 'expires', label: 'Expires', sortType: 'text', className: 'nowrap' },
                { key: 'state', label: 'State', sortType: 'text' },
                { key: 'actions', label: '', sortType: 'none' },
              ]}
              items={codes.map((code) => {
                const spent = code.maxUses !== null && code.useCount >= code.maxUses;
                const expired = code.expiresAt !== null && code.expiresAt < new Date().toISOString();
                const state = code.revokedAt ? 'revoked' : spent ? 'spent' : expired ? 'expired' : 'live';
                return {
                  id: String(code.id),
                  values: {
                    label: code.label,
                    used: code.useCount,
                    expires: code.expiresAt ?? 'z',
                    state: state,
                    actions: null,
                  },
                  element: (
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
                        {/* Revoked and spent both offer Delete; the server
                            enforces that independently, so this is which
                            control to show, not which rule applies. A spent
                            code is deletable directly -- revoking something
                            the database already refuses changed nothing.
                            `live` here includes a partly-used code, which is
                            still redeemable and so still needs a revoke. */}
                        {(state === 'revoked' || state === 'spent') && (
                          <DeleteCodeButton code={code} action={deleteCodeAction} />
                        )}
                      </td>
                    </tr>
                  ),
                };
              })}
            />
          </div>
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
          <div className="table-wrap">
            <SortableTable
              defaultSort="email"
              defaultDir="asc"
              columns={[
                { key: 'email', label: 'Email', sortType: 'text' },
                { key: 'note', label: 'Note', sortType: 'text' },
                { key: 'state', label: 'State', sortType: 'text' },
                { key: 'actions', label: '', sortType: 'none' },
              ]}
              items={emails.map((entry) => ({
                id: String(entry.id),
                values: {
                  email: entry.email,
                  note: entry.note ?? '',
                  state: entry.revokedAt ? 'revoked' : 'allowed',
                  actions: null,
                },
                element: (
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
                ),
              }))}
            />
          </div>
        </div>
        </CollapsibleTable>
      </section>
    </>
  );
}
