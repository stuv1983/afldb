'use client';

import { useActionState, useState } from 'react';

import { revokeSession, type AdminSessionState } from '@/app/admin/admins/actions';
import { LifecycleControls } from '@/app/admin/admins/LifecycleControls';
import type { LifecycleState } from '@/app/admin/admins/lifecycle-actions';
import {
  issueTemporaryPassword,
  type PasswordResetState,
} from '@/app/admin/admins/password-actions';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  isActive,
  isViableSuperAdmin,
  type LifecycleAccountState,
  type LifecycleRole,
} from '@/lib/auth/admin-lifecycle';

type Session = {
  sessionId: number;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
};

/**
 * One account as the page renders it. It is a `LifecycleAccountState` plus
 * the display-only fields, so the same object can be handed straight to the
 * eligibility helper the server will consult again.
 *
 * `hasPassword`/`hasTotp` are presence flags. No hash, secret or session
 * token reaches this component (AFLDB-ISSUE-155 Phase B §26.9).
 */
type Admin = LifecycleAccountState & {
  email: string;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  sessions: Session[];
};

const stamp = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const day = (iso: string) => iso.slice(0, 10);

function SessionRow({ session, canRevoke }: { session: Session; canRevoke: boolean }) {
  const [state, action, pending] = useActionState<AdminSessionState, FormData>(revokeSession, {});

  return (
    <tr>
      <td className="nowrap muted">{stamp(session.createdAt)}</td>
      <td className="nowrap muted">{stamp(session.expiresAt)}</td>
      <td className="muted">{session.ip ?? '—'}</td>
      <td className="wide muted" style={{ fontSize: '0.75rem' }}>{session.userAgent ?? '—'}</td>
      <td>
        {canRevoke && (
          <form action={action}>
            <input type="hidden" name="sessionId" value={session.sessionId} />
            <button className="btn btn-secondary" type="submit" disabled={pending}>
              {pending ? 'Signing out…' : 'Sign out'}
            </button>
          </form>
        )}
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
        <input type="hidden" name="userId" value={admin.id} />
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

function roleLabel(admin: Admin): string {
  if (admin.role === 'super_admin') return 'Super admin';
  if (admin.role === 'contributor') return 'Contributor';
  return admin.canManageAdmins ? 'Admin · can manage admins' : 'Admin';
}

function AccountCard({
  admin, viewer, canManage, actor, viableOtherSuperAdmins, lifecycleResult, onLifecycleResult,
}: {
  admin: Admin;
  viewer: { id: number; role: LifecycleRole };
  canManage: boolean;
  /** The signed-in super admin's own row; null for any other viewer. */
  actor: LifecycleAccountState | null;
  viableOtherSuperAdmins: number;
  /** This account's last lifecycle result, if it is the one that has one. */
  lifecycleResult: LifecycleState | null;
  onLifecycleResult: (state: LifecycleState) => void;
}) {
  const isSelf = admin.id === viewer.id;
  const active = isActive(admin);
  const sessionsVisible = admin.sessions.length > 0;

  return (
    <CollapsibleTable
      title={admin.email}
      // Deactivated accounts are filed away closed, except the one just
      // acted on: deactivating moves its card down here and remounts it,
      // and a confirmation folded inside a closed card is no confirmation.
      defaultOpen={active || lifecycleResult !== null}
      note={[
        roleLabel(admin),
        active ? '' : `deactivated ${day(String(admin.disabledAt))}`,
        `${admin.sessions.length} live session${admin.sessions.length === 1 ? '' : 's'}`,
        admin.mustChangePassword ? 'temporary password outstanding' : '',
      ].filter(Boolean).join(' · ')}
    >
      <p style={{ margin: '0 0 0.6rem' }}>
        <span className="badge">{roleLabel(admin)}</span>
        {active
          ? <span className="badge">Active</span>
          : <span className="badge badge-warn">Deactivated {day(String(admin.disabledAt))}</span>}
        {isSelf && <span className="badge">You</span>}
        {(!admin.hasPassword || !admin.hasTotp) && (
          <span className="badge badge-warn">Not yet enrolled</span>
        )}
      </p>

      <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.75rem' }}>
        Created {day(admin.createdAt)}
        {' · last signed in '}
        {admin.lastSignInAt ? stamp(admin.lastSignInAt) : 'never'}
      </p>

      {sessionsVisible ? (
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
              {admin.sessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  // An ordinary admin may end their own session and nobody
                  // else's; the server applies the same rule regardless
                  // (actions.ts). Other accounts' sessions are not even
                  // loaded for them.
                  canRevoke={isSelf || viewer.role === 'super_admin'}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {isSelf || viewer.role === 'super_admin'
            ? 'No live sessions.'
            : 'Live sessions are visible to a super admin.'}
        </p>
      )}

      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.75rem' }}>
        Password last changed{' '}
        {admin.passwordChangedAt
          ? stamp(admin.passwordChangedAt)
          : 'before this was recorded'}
        {admin.mustChangePassword
          && ' — a temporary password has been issued and not yet replaced.'}
      </p>

      {canManage && <PasswordReset admin={admin} isSelf={isSelf} />}

      {actor && (
        <LifecycleControls
          account={admin}
          actor={actor}
          viableOtherSuperAdmins={viableOtherSuperAdmins}
          result={lifecycleResult}
          onResult={onLifecycleResult}
        />
      )}
    </CollapsibleTable>
  );
}

export function AdminSessionsClient({
  admins,
  canManage,
  viewer,
}: {
  admins: Admin[];
  /** Whether the viewer may reset other people's passwords. */
  canManage: boolean;
  viewer: { id: number; role: LifecycleRole };
}) {
  // The lifecycle actor is the viewer's own row: eligibility depends on
  // their live role and status, not on what the session cookie was minted
  // with. Only a super admin gets controls at all, and the server checks
  // the same thing again under the lifecycle lock.
  const actor = viewer.role === 'super_admin'
    ? admins.find((a) => a.id === viewer.id) ?? null
    : null;

  const viableSuperAdminIds = new Set(
    admins.filter((a) => isViableSuperAdmin(a)).map((a) => a.id),
  );
  const viableOthers = (admin: Admin) =>
    viableSuperAdminIds.size - (viableSuperAdminIds.has(admin.id) ? 1 : 0);

  const active = admins.filter((a) => isActive(a));
  const deactivated = admins.filter((a) => !isActive(a));

  // The last lifecycle result lives here, above both lists, because
  // deactivating or reactivating an account moves its card from one list
  // to the other and remounts it. Held any lower, the confirmation would
  // be thrown away by the very change it is reporting (§26.9).
  const [lifecycleResult, setLifecycleResult] = useState<
    { accountId: number; state: LifecycleState } | null
  >(null);

  const card = (admin: Admin) => (
    <AccountCard
      key={admin.email}
      admin={admin}
      viewer={viewer}
      canManage={canManage}
      actor={actor}
      viableOtherSuperAdmins={viableOthers(admin)}
      lifecycleResult={
        lifecycleResult?.accountId === admin.id ? lifecycleResult.state : null
      }
      onLifecycleResult={(state) => setLifecycleResult({ accountId: admin.id, state })}
    />
  );

  return (
    <>
      {active.map(card)}

      {deactivated.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Deactivated accounts</h2>
          <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 0 }}>
            These accounts cannot sign in. They are kept, not deleted, so everything they
            edited, reviewed or resolved still names them.
          </p>
          {deactivated.map(card)}
        </>
      )}
    </>
  );
}
