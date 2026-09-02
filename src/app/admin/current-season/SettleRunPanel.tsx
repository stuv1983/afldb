'use client';

/**
 * AFLDB-ISSUE-127 — the Super Admin on-demand AFL Tables refresh.
 *
 * One button and a bounded status read. It carries no season, label, source,
 * path or force input, because the action it calls accepts none: the whole
 * control expresses "run the approved pipeline now".
 *
 * Both buttons call Server Actions directly rather than submitting a form, so
 * there is no `FormData` for a crafted field to ride in on. Authorization is
 * server-side in `actions.ts` regardless — `disabled` here is a courtesy to
 * the operator, never the control.
 */
import { useState, useTransition } from 'react';

import {
  refreshSettleRunStatusAction,
  startSettleRunAction,
  type SettleRunAdminState,
} from './actions';

/** Both actions take no arguments; the panel could not pass one if it tried. */
type ServerAction = () => Promise<SettleRunAdminState>;

/** systemd's `ActiveState` in operator English. */
const PHASE_TEXT: Record<string, string> = {
  running: 'A settle run is in progress',
  idle: 'Idle — no run in progress',
  failed: 'The last run failed',
  unknown: 'Unknown',
};

function Counters({ counters }: { counters: NonNullable<
  NonNullable<SettleRunAdminState['status']>['latestRun']
>['counters'] }) {
  if (counters === null) {
    return (
      <p className="muted">
        This run recorded no counters, which means it did not reach the end of its
        transaction. Nothing was committed.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">Canonical inserted</th>
            <th scope="col" className="num">Canonical updated</th>
            <th scope="col" className="num">Ledger rows</th>
            <th scope="col" className="num">Apply refusals</th>
            <th scope="col" className="num">Apply failures</th>
            <th scope="col" className="num">Unresolved identity</th>
            <th scope="col" className="num">Disagreements</th>
            <th scope="col" className="num">Derived recompute</th>
            <th scope="col" className="num">Players recomputed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="num">{counters.canonicalRowsInserted}</td>
            <td className="num">{counters.canonicalRowsUpdated}</td>
            <td className="num">{counters.canonicalApplicationsLogged}</td>
            <td className="num">{counters.canonicalApplyRefusals}</td>
            <td className="num">{counters.canonicalApplyFailures}</td>
            <td className="num">{counters.unresolvedIdentity}</td>
            <td className="num">{counters.advisoryDisagreement}</td>
            <td className="num">{counters.derivedRecomputeRuns ? 'yes' : 'no'}</td>
            <td className="num">{counters.derivedRecomputePlayers}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function SettleRunPanel({
  initialStatus,
}: {
  initialStatus: SettleRunAdminState['status'];
}) {
  const [state, setState] = useState<SettleRunAdminState>({ status: initialStatus });
  const [pending, startTransition] = useTransition();

  // The start's correlation id is kept here rather than round-tripped through
  // the refresh action, so a refresh cannot assert one it did not establish.
  const [batchIdAtStart, setBatchIdAtStart] = useState<string | null | undefined>(undefined);

  function invoke(action: ServerAction, isStart: boolean) {
    startTransition(async () => {
      const next = await action();
      if (isStart) setBatchIdAtStart(next.batchIdAtStart ?? null);
      setState(next);
    });
  }

  const status = state.status;
  const unit = status?.unit ?? null;
  const run = status?.latestRun ?? null;
  const configured = status?.configured ?? false;

  // §8: while a run is in flight its own batch row is still uncommitted, so
  // the newest batch is the PREVIOUS run's. Say which one is on screen rather
  // than letting stale counters read as a fresh result.
  const isNewRun =
    batchIdAtStart !== undefined && run !== null && run.batchId !== batchIdAtStart;

  return (
    <section className="section">
      <h2>Fetch current AFL data now</h2>

      <p>
        <strong>AFL Tables is the authoritative current-season source.</strong> It is
        acquired, adjudicated and applied automatically every night in season, so this
        control is not normally needed. Pressing it starts <em>the same</em> pipeline
        immediately, with the same gates, the same transaction and the same fail-closed
        behaviour — it takes no options and cannot force anything through.
      </p>

      {!configured && (
        <p className="notice" role="status">
          {status?.unitError
            ?? 'On-demand refresh is not enabled on this host. The nightly timer is unaffected.'}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          type="button"
          disabled={pending || !configured || unit?.phase === 'running'}
          onClick={() => invoke(startSettleRunAction, true)}
        >
          {pending ? 'Working...' : 'Fetch current AFL data now'}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending}
          onClick={() => invoke(refreshSettleRunStatusAction, false)}
        >
          {pending ? 'Working...' : 'Refresh status'}
        </button>
      </div>

      <div aria-live="polite">
        {state.error && <p className="notice" role="alert">{state.error}</p>}
        {state.message && <p className="notice">{state.message}</p>}

        <h3>Pipeline</h3>
        {unit === null ? (
          <p className="muted">
            {status?.unitError ?? 'Service state is not available on this host.'}
          </p>
        ) : (
          <p>
            {PHASE_TEXT[unit.phase] ?? PHASE_TEXT.unknown}
            {unit.activeState !== '' && <> — <span className="mono">{unit.activeState}</span></>}
            {unit.result !== '' && unit.result !== 'success'
              && <> (<span className="mono">{unit.result}</span>)</>}
            {unit.phase !== 'running' && unit.inactiveEnterTimestamp !== ''
              && <>, last finished {unit.inactiveEnterTimestamp}</>}
          </p>
        )}

        <h3>Latest completed run</h3>
        {status?.latestRunError ? (
          <p className="notice" role="alert">{status.latestRunError}</p>
        ) : run === null ? (
          <p className="muted">No AFL Tables settle run has committed a batch yet.</p>
        ) : (
          <>
            <p>
              Snapshot <span className="mono">{run.snapshotLabel ?? 'not recorded'}</span>
              {run.season !== null && <> for season {run.season}</>}
              {' '}— batch <span className="mono">{run.batchId}</span>,
              status <span className="mono">{run.status}</span>
              {run.completedAt !== null && <>, completed {run.completedAt}</>}.
              {' '}{run.recordsRead} records read, {run.recordsRejected} rejected.
            </p>
            {batchIdAtStart !== undefined && !isNewRun && (
              <p className="muted">
                This is the run that was already recorded before the button was pressed.
                The run just started has not committed its batch yet — refresh again once
                the pipeline is idle.
              </p>
            )}
            <Counters counters={run.counters} />
          </>
        )}
      </div>
    </section>
  );
}
