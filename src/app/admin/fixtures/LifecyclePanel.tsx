'use client';

import { useState } from 'react';

import { cancelFixtureAction, reinstateFixtureAction, voidFixtureAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';
import type { FixtureStatus } from '@/lib/fixtures/spec';

/**
 * Lifecycle (AFLDB-ISSUE-162 §16, §37.8 item 8). Three visibly distinct
 * concepts, never three equal buttons:
 *
 * - Cancel: a REAL scheduled event that was cancelled. Reversible.
 * - Reinstate: only for a cancelled fixture, re-runs the §13 checks.
 * - Void: the AFLDB RECORD was erroneous and should never have existed.
 *   Terminal, destructive-confirmation, mandatory reason — and when the
 *   current status is already `cancelled`, the confirmation says plainly
 *   that this reclassifies a real cancellation as a data-entry mistake
 *   (§37.8 item 8), because it is a stronger claim than cancelling twice.
 *
 * Void is deliberately never rendered as an equivalent sibling of Cancel —
 * it lives in its own, more heavily worded block below.
 */
export function LifecyclePanel({
  fixtureKey, status, expectedUpdatedAt,
}: {
  fixtureKey: string;
  status: FixtureStatus;
  expectedUpdatedAt: string;
}) {
  const cancel = useFixtureActionSubmit(cancelFixtureAction, {});
  const reinstate = useFixtureActionSubmit(reinstateFixtureAction, {});
  const voidAction = useFixtureActionSubmit(voidFixtureAction, {});
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  if (status === 'void') {
    return (
      <section className="section">
        <h2>Lifecycle</h2>
        <p className="muted">
          This fixture was voided as a data-entry error and is terminal. Only its notes may still
          be changed.
        </p>
      </section>
    );
  }

  const anyPending = cancel.isPending || reinstate.isPending || voidAction.isPending;

  const handleCancel = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('reason', cancelReason);
    formData.set('confirmCancel', '1');
    cancel.submit(formData, event.currentTarget);
  };

  const handleReinstate = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    reinstate.submit(formData, event.currentTarget);
  };

  const handleVoid = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('reason', voidReason);
    formData.set('confirmVoid', '1');
    voidAction.submit(formData, event.currentTarget);
  };

  return (
    <>
      <section className="section">
        <h2>Lifecycle</h2>
        {status === 'scheduled' && (
          cancel.state.ok ? (
            <p className="notice" role="status">{cancel.state.message}</p>
          ) : !cancelling ? (
            <button type="button" className="btn btn-secondary" onClick={() => setCancelling(true)}>
              Cancel this fixture…
            </button>
          ) : (
            <div style={{ display: 'grid', gap: '0.4rem', maxWidth: '26rem' }}>
              <p role="alert">
                Cancelling means this real, scheduled game did not happen. The fixture is kept and
                can be reinstated later if it is replayed.
              </p>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Reason
                <input type="text" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required minLength={1} maxLength={500} disabled={anyPending} />
              </label>
              {cancel.state.error && <p className="notice" role="alert">{cancel.state.error}</p>}
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button type="button" className="btn btn-primary" onClick={handleCancel} disabled={anyPending || !cancelReason.trim()}>
                  {cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setCancelling(false)} disabled={anyPending}>
                  Back
                </button>
              </div>
            </div>
          )
        )}
        {status === 'cancelled' && (
          reinstate.state.ok ? (
            <p className="notice" role="status">{reinstate.state.message}</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Reinstating returns this fixture to the schedule and re-runs the round&rsquo;s
                collision checks.
              </p>
              {reinstate.state.error && <p className="notice" role="alert">{reinstate.state.error}</p>}
              <div>
                <button type="button" className="btn btn-secondary" onClick={handleReinstate} disabled={anyPending}>
                  {reinstate.isPending ? 'Reinstating…' : 'Reinstate'}
                </button>
              </div>
            </div>
          )
        )}
      </section>

      {!voidAction.state.ok && (
        <section className="section" style={{ borderColor: 'var(--color-warn, #b91c1c)' }}>
          <h2>Void this fixture record</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Void means this AFLDB record was a data-entry error and should never have represented a
            valid scheduled event — it is not a statement about the real world, and it is more
            severe than cancelling. The row is kept for audit and replay, but void is terminal: it
            cannot be reinstated, and only its notes can be changed afterwards. To correct a
            mistake, void it and enter a new fixture.
          </p>
          {!voiding ? (
            <button type="button" className="btn btn-secondary btn-danger" onClick={() => setVoiding(true)} disabled={anyPending}>
              Void this fixture…
            </button>
          ) : (
            <div style={{ display: 'grid', gap: '0.4rem', maxWidth: '26rem' }}>
              <p role="alert" className="notice">
                {status === 'cancelled'
                  ? 'This fixture is currently marked cancelled — a genuine scheduled event that did '
                    + 'not happen. Voiding it instead reclassifies that as a data-entry error: you are '
                    + 'saying the fixture should never have existed at all, not that the game was '
                    + 'called off. This cannot be undone from this page.'
                  : 'This cannot be undone from this page. The fixture will be marked void, kept for '
                    + 'audit, and excluded from the schedule.'}
              </p>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Reason
                <input type="text" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required minLength={1} maxLength={500} disabled={anyPending} />
              </label>
              {voidAction.state.error && <p className="notice" role="alert">{voidAction.state.error}</p>}
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button type="button" className="btn btn-danger" onClick={handleVoid} disabled={anyPending || !voidReason.trim()}>
                  {voidAction.isPending ? 'Voiding…' : 'Confirm void'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setVoiding(false)} disabled={anyPending}>
                  Back
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {voidAction.state.ok && (
        <section className="section">
          <p className="notice" role="status">{voidAction.state.message}</p>
        </section>
      )}
    </>
  );
}
