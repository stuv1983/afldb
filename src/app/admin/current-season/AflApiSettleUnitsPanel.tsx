/**
 * AFLDB-ISSUE-232 — the AFL API scheduled-settle units, read-only.
 *
 * ISSUE-228 S8 built `readSettleUnitTableStatus()` (`settle-status.ts`) and
 * left it unrendered. This shows its two AFL API rows: what systemd says each
 * unit is doing, and the newest `import_batches` row each settle CLI wrote.
 * The AFL Tables row is not repeated here; `SettleRunPanel` already owns it.
 *
 * It starts nothing and takes no input. The two facts stay separate for the
 * same reason `SettleRunPanel` keeps them apart: a run in flight has not
 * committed its batch yet, so the batch shown is the previous run's.
 *
 * A server component with no client state: every value is rendered from the
 * props, so this adds no Server Action and no new authority to the page.
 */
import type { SettleUnitStatus } from '@/lib/acquisition/settle-status';
import { SETTLE_UNITS, type SettleUnitKey } from '@/lib/acquisition/settle-trigger';

/** The two units this panel shows, with the operator name for each. */
export const AFL_API_SETTLE_UNIT_ROWS: readonly { key: SettleUnitKey; label: string }[] = [
  { key: 'afl_api', label: 'Match and player statistics' },
  { key: 'afl_api_brownlow', label: 'Brownlow votes' },
];

const PHASE_TEXT: Record<string, string> = {
  running: 'Running',
  idle: 'Idle',
  failed: 'Last run failed',
  unknown: 'Unknown',
};

function ServiceState({ status }: { status: SettleUnitStatus }) {
  const unit = status.unit;
  if (unit === null) {
    return <span className="muted">{status.unitError ?? 'Service state is not available on this host.'}</span>;
  }
  return (
    <>
      {PHASE_TEXT[unit.phase] ?? PHASE_TEXT.unknown}
      {unit.activeState !== '' && <> (<span className="mono">{unit.activeState}</span>)</>}
      {unit.result !== '' && unit.result !== 'success' && <>, result <span className="mono">{unit.result}</span></>}
      {unit.phase !== 'running' && unit.inactiveEnterTimestamp !== ''
        && <>, last finished {unit.inactiveEnterTimestamp}</>}
    </>
  );
}

function LatestBatch({ status }: { status: SettleUnitStatus }) {
  if (status.latestRunError !== null) {
    return <span role="alert">{status.latestRunError}</span>;
  }
  const run = status.latestRun;
  if (run === null) return <span className="muted">No batch recorded yet.</span>;
  return (
    <>
      Batch <span className="mono">{run.batchId}</span>, status <span className="mono">{run.status}</span>
      {run.snapshotLabel !== null && <>, snapshot <span className="mono">{run.snapshotLabel}</span></>}
      {run.season !== null && <>, season {run.season}</>}
      {run.completedAt !== null && <>, completed {run.completedAt}</>}.
      {' '}{run.recordsRead} records read, {run.recordsRejected} rejected.
    </>
  );
}

export function AflApiSettleUnitsPanel({
  units,
  error,
}: {
  units: Readonly<Record<SettleUnitKey, SettleUnitStatus>> | null;
  error: string | null;
}) {
  return (
    <section className="section">
      <h2>AFL API scheduled settles</h2>
      <p>
        The AFL.com.au match and Brownlow settles run from their own systemd timers once an
        operator installs them on this host (AFLDB-ISSUE-232). This table only reports: it
        starts nothing. While a run is in progress, the batch shown is the previous run&apos;s.
      </p>
      {error !== null ? (
        <p className="notice" role="alert">{error}</p>
      ) : units === null ? (
        <p className="muted">Unit status is not available.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Settle</th>
                <th scope="col">Service</th>
                <th scope="col">Latest committed batch</th>
              </tr>
            </thead>
            <tbody>
              {AFL_API_SETTLE_UNIT_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.label}
                    <br />
                    <span className="mono muted">{SETTLE_UNITS[row.key]}</span>
                  </th>
                  <td><ServiceState status={units[row.key]} /></td>
                  <td><LatestBatch status={units[row.key]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
