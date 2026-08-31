'use client';

import { useActionState } from 'react';

import {
  runCurrentSeasonAdminAction,
  type CurrentSeasonAdminState,
} from './actions';

const INITIAL: CurrentSeasonAdminState = {};

function ResultSummary({ state }: { state: CurrentSeasonAdminState }) {
  const result = state.result;
  const report = state.report;
  if (!state.message && !state.error && !result && !report) return null;

  return (
    <section className="section" aria-live="polite">
      {state.error && <p className="notice" role="alert">{state.error}</p>}
      {state.message && <p className="notice">{state.message}</p>}
      {result && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Observations fetched</th>
                <th scope="col">Complete observations</th>
                <th scope="col">Observations with scores</th>
                <th scope="col">Observations staged</th>
                <th scope="col">Versions inserted</th>
                <th scope="col">Marked absent</th>
                <th scope="col">Canonical matches resolved</th>
                <th scope="col">Canonical rows inserted</th>
                <th scope="col">Canonical rows updated</th>
                <th scope="col">Unresolved observations</th>
                <th scope="col">Incomplete source records</th>
                <th scope="col">Rejected/conflicted</th>
                <th scope="col">Disagreements</th>
                <th scope="col">Within-group conflicts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num">{result.observationsFetched}</td>
                <td className="num">{result.completeObservations}</td>
                <td className="num">{result.observationsWithScores}</td>
                <td className="num">{result.observationsStaged}</td>
                <td className="num">{result.observationVersionsInserted}</td>
                <td className="num">{result.observationsMarkedAbsent}</td>
                <td className="num">{result.canonicalMatchesResolved}</td>
                <td className="num">{result.canonicalRowsInserted}</td>
                <td className="num">{result.canonicalRowsUpdated}</td>
                <td className="num">{result.unresolvedObservations}</td>
                <td className="num">{result.incompleteSourceRecords}</td>
                <td className="num">{result.rejectedOrConflicted}</td>
                <td className="num">{result.sourceDisagreements}</td>
                <td className="num">{result.sameGroupConflicts}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {report && <CurrentSeasonReportTable report={report} />}
    </section>
  );
}

export function CurrentSeasonReportTable({
  report,
}: {
  report: NonNullable<CurrentSeasonAdminState['report']>;
}) {
  if (report.rows.length === 0) {
    return <p className="muted">No staged external current-season rows for {report.year}.</p>;
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="num">Current observations</th>
              <th scope="col" className="num">Observations resolving to canonical</th>
              <th scope="col" className="num">Complete observations</th>
              <th scope="col" className="num">Observations with score fields</th>
              <th scope="col" className="num">Unresolved teams</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.source}>
                <td className="mono">{row.source}</td>
                <td className="num">{row.staged}</td>
                <td className="num">{row.resolved}</td>
                <td className="num">{row.complete}</td>
                <td className="num">{row.withScores}</td>
                <td className="num">{row.unresolvedTeams}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.incompleteSamples.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <h4>Incomplete fixture samples</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">External id</th>
                <th scope="col">Date</th>
                <th scope="col">Round</th>
                <th scope="col">Home</th>
                <th scope="col">Away</th>
              </tr>
            </thead>
            <tbody>
              {report.incompleteSamples.map((sample) => (
                <tr key={`${sample.source}-${sample.externalGameId}`}>
                  <td className="mono">{sample.source}</td>
                  <td className="mono">{sample.externalGameId}</td>
                  <td>{sample.matchDate ?? 'not recorded'}</td>
                  <td>{sample.round ?? 'not recorded'}</td>
                  <td>{sample.home ?? 'not recorded'}</td>
                  <td>{sample.away ?? 'not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.unresolvedMatchSamples.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <h4>Unresolved match samples</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">External id</th>
                <th scope="col">Date</th>
                <th scope="col">Round</th>
                <th scope="col">Home</th>
                <th scope="col">Away</th>
              </tr>
            </thead>
            <tbody>
              {report.unresolvedMatchSamples.map((sample) => (
                <tr key={`${sample.source}-${sample.externalGameId}`}>
                  <td className="mono">{sample.source}</td>
                  <td className="mono">{sample.externalGameId}</td>
                  <td>{sample.matchDate ?? 'not recorded'}</td>
                  <td>{sample.round ?? 'not recorded'}</td>
                  <td>{sample.home ?? 'not recorded'}</td>
                  <td>{sample.away ?? 'not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.unresolvedTeamSamples.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <h4>Unresolved team samples</h4>
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">External id</th>
                <th scope="col">Date</th>
                <th scope="col">Round</th>
                <th scope="col">Home</th>
                <th scope="col">Away</th>
              </tr>
            </thead>
            <tbody>
              {report.unresolvedTeamSamples.map((sample) => (
                <tr key={`${sample.source}-${sample.externalGameId}`}>
                  <td className="mono">{sample.source}</td>
                  <td className="mono">{sample.externalGameId}</td>
                  <td>{sample.matchDate ?? 'not recorded'}</td>
                  <td>{sample.round ?? 'not recorded'}</td>
                  <td>{sample.home ?? 'not recorded'}</td>
                  <td>{sample.away ?? 'not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function CurrentSeasonControls({
  year,
}: {
  year: number;
}) {
  const [state, action, pending] = useActionState<CurrentSeasonAdminState, FormData>(
    runCurrentSeasonAdminAction,
    INITIAL,
  );

  return (
    <>
      <section className="section">
        <form action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '34rem' }}>
          <input type="hidden" name="mode" value="auto" />
          <label>
            Season
            <input name="year" type="number" min="2000" max="2100" defaultValue={year} required />
          </label>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Updating...' : 'Auto update from API'}
          </button>
        </form>
      </section>

      <section className="section">
        <h2>Manual controls</h2>
        <form action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '34rem' }}>
          <input type="hidden" name="mode" value="manual" />
          <label>
            Season
            <input name="year" type="number" min="2000" max="2100" defaultValue={year} required />
          </label>
          <label>
            Source
            <select name="source" defaultValue="kali">
              <option value="kali">Kali AFL Stats</option>
              <option value="squiggle">Squiggle</option>
              <option value="all">Both sources</option>
            </select>
          </label>
          <label>
            <input name="apply" type="checkbox" /> Apply staging rows
          </label>
          <label>
            <input name="updateMatches" type="checkbox" /> Overwrite existing resolved final scores
          </label>
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? 'Running...' : 'Run manual refresh'}
          </button>
        </form>
      </section>

      <section className="section">
        <form action={action}>
          <input type="hidden" name="mode" value="report" />
          <input type="hidden" name="year" value={year} />
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? 'Loading...' : 'Refresh report'}
          </button>
        </form>
      </section>

      <ResultSummary state={state} />
    </>
  );
}
