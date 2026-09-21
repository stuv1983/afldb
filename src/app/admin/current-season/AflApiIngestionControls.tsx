'use client';

/**
 * AFLDB-ISSUE-228 follow-up — the super-admin AFL API ingestion switches.
 *
 * Two independent controls (hard requirement, "prefer separate controls
 * rather than one ambiguous master switch"): AFL API current-season
 * ingestion, and Brownlow live ingestion. Both call Server Actions directly
 * rather than submitting a form — `startTransition`/no `FormData`, the same
 * shape `SettleRunPanel.tsx` uses — so authorization is entirely server-side
 * in `actions.ts`; `disabled` here is a courtesy to the operator, never the
 * control (§C).
 *
 * The Brownlow row states all three facts (§ "Admin UX"): the admin
 * control's own state, the deployment gate's state, and the effective
 * (AND-ed) result — never a single collapsed "enabled" that could read as
 * live when the deployment gate is actually still closed.
 */
import { useState, useTransition } from 'react';

import {
  setAflApiBrownlowIngestionAction,
  setAflApiCurrentSeasonIngestionAction,
  type AflApiIngestionAdminView,
  type IngestionControlsAdminState,
} from './actions';

type ServerAction = (enabled: boolean) => Promise<IngestionControlsAdminState>;

function StatePill({ enabled }: { enabled: boolean }) {
  const text = enabled ? 'Enabled' : 'Disabled';
  return enabled ? <strong className="mono">{text}</strong> : <span className="mono muted">{text}</span>;
}

export function AflApiIngestionControls({
  initialView,
}: {
  initialView: AflApiIngestionAdminView;
}) {
  const [view, setView] = useState<AflApiIngestionAdminView>(initialView);
  const [feedback, setFeedback] = useState<IngestionControlsAdminState>({});
  const [pendingKey, setPendingKey] = useState<'currentSeason' | 'brownlow' | null>(null);
  const [pending, startTransition] = useTransition();

  function invoke(
    key: 'currentSeason' | 'brownlow', action: ServerAction, enabled: boolean,
  ) {
    setPendingKey(key);
    startTransition(async () => {
      const result = await action(enabled);
      setFeedback(result);
      if (!result.error) {
        setView((current) => (
          key === 'currentSeason'
            ? { ...current, currentSeasonEnabled: enabled }
            : {
              ...current,
              brownlow: {
                ...current.brownlow,
                adminEnabled: enabled,
                effectiveEnabled: current.brownlow.deploymentGateEnabled && enabled,
              },
            }
        ));
      }
      setPendingKey(null);
    });
  }

  return (
    <section className="section">
      <h2>AFL API ingestion</h2>
      <p>
        <strong>Super-admin-controlled, fail-closed switches.</strong> Missing, unreadable or
        malformed state always means disabled. Every acquisition and settle tool in{' '}
        <span className="mono">tools/current-season/</span> checks the same switch itself —
        the nightly timer and a direct CLI invocation are bound by it exactly like this panel.
      </p>

      <div aria-live="polite">
        {feedback.error && <p className="notice" role="alert">{feedback.error}</p>}
        {feedback.message && <p className="notice">{feedback.message}</p>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Switch</th>
              <th scope="col">State</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">AFL API Current-Season Ingestion</th>
              <td><StatePill enabled={view.currentSeasonEnabled} /></td>
              <td>
                <button
                  className="btn"
                  type="button"
                  disabled={pending}
                  onClick={() => invoke(
                    'currentSeason', setAflApiCurrentSeasonIngestionAction, !view.currentSeasonEnabled,
                  )}
                >
                  {pending && pendingKey === 'currentSeason'
                    ? 'Working...'
                    : view.currentSeasonEnabled ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
            <tr>
              <th scope="row">Brownlow Live Ingestion</th>
              <td>
                <div>Admin control: <StatePill enabled={view.brownlow.adminEnabled} /></div>
                <div>Deployment gate: <StatePill enabled={view.brownlow.deploymentGateEnabled} /></div>
                <div>Effective state: <StatePill enabled={view.brownlow.effectiveEnabled} /></div>
              </td>
              <td>
                <button
                  className="btn"
                  type="button"
                  disabled={pending}
                  onClick={() => invoke(
                    'brownlow', setAflApiBrownlowIngestionAction, !view.brownlow.adminEnabled,
                  )}
                >
                  {pending && pendingKey === 'brownlow'
                    ? 'Working...'
                    : view.brownlow.adminEnabled ? 'Disable admin control' : 'Enable admin control'}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!view.brownlow.deploymentGateEnabled && (
        <p className="muted">
          The deployment gate (<span className="mono">AFLDB_AFL_API_BROWNLOW_ENABLED</span>) is not
          set on this host, so Brownlow ingestion cannot run regardless of the admin control above.
          This panel cannot change that value — it is set in <span className="mono">.env</span> by
          the operator, outside the live count window.
        </p>
      )}
    </section>
  );
}
