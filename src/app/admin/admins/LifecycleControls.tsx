'use client';

import { useActionState, useState } from 'react';

import {
  deactivateAccount,
  demoteSuperAdmin,
  promoteAdmin,
  reactivateAccount,
  type LifecycleState,
} from '@/app/admin/admins/lifecycle-actions';
import {
  isActive,
  lifecycleEligibility,
  lifecycleUnavailableReason,
  type LifecycleAccountState,
  type LifecycleAction,
  type LifecycleDecision,
} from '@/lib/auth/admin-lifecycle';

/**
 * Promote, demote, deactivate and reactivate, for a super admin only
 * (AFLDB-ISSUE-155 Phase B §26.9).
 *
 * Everything decided here is decided again on the server, against rows
 * read under the lifecycle lock. A disabled button is an explanation, not
 * a control: the reason is printed beside it so a super admin can see why
 * the site will not let them strand itself, and submitting the same form
 * from a stale second tab gets the same answer from the transaction.
 *
 * The result of an action is reported UPWARDS and rendered from a prop,
 * rather than held in the control that produced it. A successful
 * lifecycle mutation revalidates the page, and the control that submitted
 * it is then replaced by the next one -- promote gives way to demote,
 * deactivate to reactivate -- while deactivation and reactivation move the
 * whole card between the active and deactivated lists, remounting it. A
 * result held anywhere inside the card would be discarded by the same
 * commit that produced it, and the super admin would never see the
 * confirmation §26.9 asks for. The list owns it instead, so the message
 * survives both the swap and the move.
 */

type LifecycleAccount = LifecycleAccountState & { email: string };

type ServerAction = (previous: LifecycleState, formData: FormData) => Promise<LifecycleState>;

/** One action's live state: what its form submits to, and whether it is in flight. */
type Runner = {
  submit: (formData: FormData) => void;
  pending: boolean;
};

const ACTION_SERVER: Record<LifecycleAction, ServerAction> = {
  promote: promoteAdmin,
  demote: demoteSuperAdmin,
  deactivate: deactivateAccount,
  reactivate: reactivateAccount,
};

/** The three hidden fields every lifecycle form carries (§26.9). */
function ExpectedState({ account }: { account: LifecycleAccount }) {
  return (
    <>
      <input type="hidden" name="userId" value={account.id} />
      <input type="hidden" name="expectedRole" value={account.role} />
      <input type="hidden" name="expectedActive" value={isActive(account) ? '1' : '0'} />
    </>
  );
}

function Result({ state }: { state: LifecycleState }) {
  if (!state.error && !state.message) return null;
  return (
    <p className="notice" role={state.error ? 'alert' : undefined} style={{ margin: '0.5rem 0 0' }}>
      {state.error ?? state.message}
      {(state.code === 'stale' || state.code === 'conflict') && (
        <>
          {' '}
          <a href="/admin/admins">Reload the page →</a>
        </>
      )}
    </p>
  );
}

/** Promote and reactivate: reversible, non-destructive, no confirmation (§26.2.8). */
function DirectAction({
  account, action, label, decision, runner,
}: {
  account: LifecycleAccount;
  action: LifecycleAction;
  label: string;
  decision: LifecycleDecision;
  runner: Runner;
}) {
  return (
    <div>
      <form action={runner.submit}>
        <ExpectedState account={account} />
        <button
          className="btn btn-secondary"
          type="submit"
          disabled={runner.pending || !decision.allowed}
        >
          {runner.pending ? `${label}…` : label}
        </button>
      </form>
      {!decision.allowed && (
        <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.35rem 0 0' }}>
          {lifecycleUnavailableReason(action, decision.reason, { email: account.email })}
        </p>
      )}
    </div>
  );
}

/** Demotion: one ordinary confirm step, because it removes powers. */
function DemoteAction({
  account, decision, runner,
}: {
  account: LifecycleAccount;
  decision: LifecycleDecision;
  runner: Runner;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      {confirming ? (
        <form action={runner.submit}>
          <ExpectedState account={account} />
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '0 0 0.4rem' }}>
            {account.email} becomes a plain admin and loses admin-management delegation.
            Their sessions are signed out.
          </p>
          <button className="btn" type="submit" disabled={runner.pending}>
            {runner.pending ? 'Demoting…' : 'Confirm demotion'}
          </button>
          {' '}
          <button className="btn btn-secondary" type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="btn btn-secondary"
          type="button"
          disabled={!decision.allowed}
          onClick={() => setConfirming(true)}
        >
          Demote to admin
        </button>
      )}
      {!decision.allowed && (
        <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.35rem 0 0' }}>
          {lifecycleUnavailableReason('demote', decision.reason, { email: account.email })}
        </p>
      )}
    </div>
  );
}

/**
 * Deactivation: typed email plus a short reason (§26.2.8).
 *
 * The account is kept, and so is everything it has ever done -- there is
 * no delete here and none anywhere else. What ends is the ability to sign
 * in, immediately and for every live session.
 *
 * Both fields are controlled, because React resets an uncontrolled form
 * once its action returns: a refusal ("type the email exactly") would
 * otherwise clear the reason the super admin had already written and make
 * them type both again to correct one.
 */
function DeactivateAction({
  account, decision, runner,
}: {
  account: LifecycleAccount;
  decision: LifecycleDecision;
  runner: Runner;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');

  if (!open) {
    return (
      <div>
        <button
          className="btn btn-secondary btn-danger"
          type="button"
          disabled={!decision.allowed}
          onClick={() => setOpen(true)}
        >
          Deactivate
        </button>
        {!decision.allowed && (
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.35rem 0 0' }}>
            {lifecycleUnavailableReason('deactivate', decision.reason, { email: account.email })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <form action={runner.submit} style={{ maxWidth: '28rem' }}>
        <ExpectedState account={account} />
        <p className="muted" style={{ fontSize: '0.8125rem', margin: '0 0 0.5rem' }}>
          {account.email} will be signed out of every session and will not be able to sign
          in. The account and its history are kept; a super admin can reactivate it.
        </p>
        <label htmlFor={`deactivate-reason-${account.id}`}>Reason</label>
        <input
          id={`deactivate-reason-${account.id}`}
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          placeholder="Left the project"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <label htmlFor={`deactivate-confirm-${account.id}`}>
          Type <span className="mono">{account.email}</span> to confirm
        </label>
        <input
          id={`deactivate-confirm-${account.id}`}
          name="confirmEmail"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
        />
        <div style={{ marginTop: '0.6rem' }}>
          <button
            className="btn btn-danger"
            type="submit"
            disabled={runner.pending}
          >
            {runner.pending ? 'Deactivating…' : 'Deactivate account'}
          </button>
          {' '}
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => { setOpen(false); setReason(''); setConfirmEmail(''); }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function LifecycleControls({
  account,
  actor,
  viableOtherSuperAdmins,
  result,
  onResult,
}: {
  account: LifecycleAccount;
  /** The signed-in super admin, as their own row reads. */
  actor: LifecycleAccountState;
  /** Viable super admins other than this account, from the rows the page loaded. */
  viableOtherSuperAdmins: number;
  /** This account's last lifecycle result, held by the list above the card. */
  result: LifecycleState | null;
  /** Reports a settled result upwards, so it outlives this card. */
  onResult: (state: LifecycleState) => void;
}) {
  // Each action reports its own outcome up on the way back. The wrapper
  // runs after the transaction has answered, so what the list stores is
  // exactly what the Server Action returned -- a message or a refusal.
  const report = (action: ServerAction): ServerAction => async (previous, formData) => {
    const next = await action(previous, formData);
    onResult(next);
    return next;
  };

  const promote = useActionState<LifecycleState, FormData>(report(ACTION_SERVER.promote), {});
  const demote = useActionState<LifecycleState, FormData>(report(ACTION_SERVER.demote), {});
  const deactivate = useActionState<LifecycleState, FormData>(report(ACTION_SERVER.deactivate), {});
  const reactivate = useActionState<LifecycleState, FormData>(report(ACTION_SERVER.reactivate), {});

  const runners: Record<LifecycleAction, Runner> = {
    promote: { submit: promote[1], pending: promote[2] },
    demote: { submit: demote[1], pending: demote[2] },
    deactivate: { submit: deactivate[1], pending: deactivate[2] },
    reactivate: { submit: reactivate[1], pending: reactivate[2] },
  };

  if (account.id === actor.id) {
    return (
      <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.6rem 0 0' }}>
        This is your own account. Another super admin must change it.
      </p>
    );
  }

  const eligibility = lifecycleEligibility(actor, account, viableOtherSuperAdmins);
  const active = isActive(account);

  return (
    <div
      style={{
        marginTop: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.6rem',
      }}
    >
      {!active ? (
        <DirectAction
          account={account}
          action="reactivate"
          label="Reactivate"
          decision={eligibility.reactivate}
          runner={runners.reactivate}
        />
      ) : (
        <>
          {account.role === 'admin' && (
            <DirectAction
              account={account}
              action="promote"
              label="Promote to super admin"
              decision={eligibility.promote}
              runner={runners.promote}
            />
          )}
          {account.role === 'super_admin' && (
            <DemoteAction
              account={account}
              decision={eligibility.demote}
              runner={runners.demote}
            />
          )}
          <DeactivateAction
            account={account}
            decision={eligibility.deactivate}
            runner={runners.deactivate}
          />
        </>
      )}

      {result && <Result state={result} />}
    </div>
  );
}
