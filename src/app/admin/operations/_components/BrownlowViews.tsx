import {
  BROWNLOW_ELIGIBILITY_RULES,
  BROWNLOW_FINDING_SEVERITIES,
  type BrownlowEligibilityRule,
  type BrownlowFinding,
  type BrownlowReconciliationReport,
} from '@afldb/derived';

import { formatInstant } from '../format';

/**
 * Pure presentation of the read-only Brownlow reconciliation (AFLDB V2 Stage 5, plan D9; ADR 0007).
 * The report is EVIDENCE: it compares staged AFL API votes with the stored authoritative totals and
 * states a leader only when the determination is `determined`. It never states a "winner", and a
 * player appears by stable id only.
 */

const RULE_LABELS: Record<BrownlowEligibilityRule, string> = {
  unrecorded: 'Unrecorded (default): an ineligible vote-getter refuses the leader determination',
  stored_eligible_rank_one: 'Stored-table rule: ineligible players excluded, highest eligible total leads',
};

const OUTCOME_LABELS = { reconciled: 'Reconciled', discrepancies: 'Discrepancies found', refused: 'Refused' } as const;

/** The most findings listed row by row; every finding is still counted. */
export const FINDINGS_ROW_LIMIT = 100;

export function BrownlowCaveats() {
  return (
    <section className="section" id="brownlow-caveats" aria-labelledby="brownlow-caveats-heading">
      <h2 id="brownlow-caveats-heading">Read this first</h2>
      <p className="notice" data-caveat="eligibility-rule">
        <strong>No eligibility rule is recorded for API-era seasons (V2-GAP-016).</strong> The default{' '}
        <span className="mono">unrecorded</span> rule therefore refuses to state a leader whenever an
        ineligible player polled votes. The <span className="mono">stored_eligible_rank_one</span>{' '}
        rule reproduces the convention measured on the stored AFL Tables table; it is applied only if
        you choose it, and choosing it here decides nothing: this page writes nothing.
      </p>
      <p className="notice" data-caveat="leaderboard-not-staged">
        <strong>The API leaderboard is not staged (F-WB1-005).</strong> There is no staged table for
        it, so the leaderboard comparison always reads <em>not supplied</em>, and the provider team
        to club mapping is not committed, so club consistency is reported as unverifiable
        (informational). A reconciled season is reconciled against the round votes and the stored
        totals only.
      </p>
    </section>
  );
}

export function BrownlowSeasonPicker({
  season, rule, seasonError,
}: {
  season: number | null;
  rule: BrownlowEligibilityRule;
  seasonError: string | null;
}) {
  return (
    <section className="section" id="brownlow-picker" aria-labelledby="brownlow-picker-heading">
      <h2 id="brownlow-picker-heading">Choose a season</h2>
      <form method="get" action="/admin/operations/brownlow">
        <div className="filter-grid">
          <div>
            <label htmlFor="brownlow-season">Season</label>
            <input
              id="brownlow-season"
              name="season"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="YYYY"
              defaultValue={season ?? ''}
              aria-invalid={seasonError !== null}
            />
            {seasonError !== null && <p className="muted" role="alert" data-field-error="season">{seasonError}</p>}
          </div>
          <div>
            <label htmlFor="brownlow-rule">Eligibility rule</label>
            <select id="brownlow-rule" name="rule" defaultValue={rule}>
              {BROWNLOW_ELIGIBILITY_RULES.map((value) => (
                <option key={value} value={value}>{RULE_LABELS[value]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn" type="submit">Reconcile (read-only)</button>
        </div>
      </form>
    </section>
  );
}

function detailText(finding: BrownlowFinding): string {
  const entries = Object.entries(finding.detail);
  return entries.length === 0 ? '—' : entries.map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`).join(', ');
}

export function BrownlowReportView({ report }: { report: BrownlowReconciliationReport }) {
  const presentation = report.awardResultPresentation;
  const evidence = report.source.evidence;
  const bySeverity = BROWNLOW_FINDING_SEVERITIES.map((severity) => (
    [severity, report.findings.filter((finding) => finding.severity === severity).length] as const
  ));
  const shown = report.findings.slice(0, FINDINGS_ROW_LIMIT);
  const comparisons = report.rawVotes.comparisons;

  return (
    <div data-brownlow-report={report.source.season}>
      <section className="section" id="brownlow-outcome" aria-labelledby="brownlow-outcome-heading">
        <h2 id="brownlow-outcome-heading">Season {report.source.season}: {OUTCOME_LABELS[report.outcome]}</h2>
        <dl className="audit-kv">
          <dt>Outcome</dt>
          <dd><span className={report.outcome === 'reconciled' ? 'badge' : 'badge badge-warn'}>{OUTCOME_LABELS[report.outcome]}</span></dd>
          <dt>Season state</dt>
          <dd>{report.source.seasonState === 'complete' ? 'complete' : 'in progress'}</dd>
          <dt>Generated</dt>
          <dd>{formatInstant(report.generatedAt)}</dd>
          <dt>Match vote records</dt>
          <dd>{evidence.matchVoteRecords} across {evidence.contextMatches} context matches</dd>
          <dt>API leaderboard</dt>
          <dd>{evidence.leaderboardEntries === null ? 'not supplied' : `${evidence.leaderboardEntries} entries`}{report.source.leaderboardStatus === null ? '' : ` (status ${report.source.leaderboardStatus})`}</dd>
          <dt>Stored totals</dt>
          <dd>{evidence.storedRows === null ? 'not supplied' : `${evidence.storedRows} rows`}</dd>
          <dt>Evidence basis</dt>
          <dd className="mono">{report.rawVotes.basis ?? 'none'}</dd>
        </dl>
      </section>

      <section className="section" id="brownlow-result" aria-labelledby="brownlow-result-heading">
        <h2 id="brownlow-result-heading">Award-result presentation</h2>
        <p className="section-note">
          A leader is stated only when the status is <span className="mono">determined</span>. This is
          presentation of the evidence under the chosen rule, not a recorded award.
        </p>
        <dl className="audit-kv">
          <dt>Status</dt>
          <dd><span className="mono">{presentation.status}</span>{presentation.refusalCode === null ? '' : <> (<span className="mono">{presentation.refusalCode}</span>)</>}</dd>
          <dt>Eligibility rule</dt>
          <dd className="mono">{presentation.eligibilityRule}</dd>
          <dt>Leaders</dt>
          <dd>
            {presentation.leaders.length === 0
              ? 'none stated'
              : presentation.leaders.map((leader) => `player ${leader.playerId} (${leader.votes} votes)`).join(', ')}
            {presentation.tie === true && ' — a tie, joint leaders'}
          </dd>
          <dt>Note</dt>
          <dd>{presentation.note}</dd>
        </dl>
      </section>

      <section className="section" id="brownlow-comparisons" aria-labelledby="brownlow-comparisons-heading">
        <h2 id="brownlow-comparisons-heading">Comparisons</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Comparison</th>
                <th scope="col">State</th>
                <th scope="col" className="num">Compared</th>
                <th scope="col" className="num">Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Round votes against the API leaderboard', comparisons.leaderboard],
                ['Round votes against the stored totals', comparisons.stored],
                ['The stored totals against themselves', comparisons.storedInternal],
              ] as const).map(([label, summary]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td className="mono">{summary.state}</td>
                  <td className="num">{summary.compared}</td>
                  <td className="num">{summary.mismatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" id="brownlow-findings" aria-labelledby="brownlow-findings-heading">
        <h2 id="brownlow-findings-heading">Findings by severity</h2>
        <ul className="ruled-list" aria-label="Finding counts by severity">
          {bySeverity.map(([severity, count]) => (
            <li key={severity}><span className="mono">{severity}</span>: {count}</li>
          ))}
        </ul>
        {report.findings.length === 0 ? (
          <p className="muted">No findings.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Provider match</th>
                    <th scope="col" className="num">Player id</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((finding, index) => (
                    <tr key={`${finding.code}-${index}`}>
                      <td className="mono">{finding.code}</td>
                      <td><span className={finding.severity === 'info' ? 'badge' : 'badge badge-warn'}>{finding.severity}</span></td>
                      <td className="mono">{finding.providerMatchId ?? '—'}</td>
                      <td className="num">{finding.playerId ?? '—'}</td>
                      <td className="mono" style={{ overflowWrap: 'anywhere' }}>{detailText(finding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.findings.length > shown.length && (
              <p className="section-note">Showing the first {shown.length} of {report.findings.length} findings.</p>
            )}
          </>
        )}
      </section>

      <section className="section" id="brownlow-top" aria-labelledby="brownlow-top-heading">
        <h2 id="brownlow-top-heading">Raw vote totals</h2>
        <p className="section-note">
          The highest raw totals over every vote-getter, ineligible players included. These are what
          the sources said, not an award result.
        </p>
        {report.rawVotes.topVoteGetters.length === 0 ? (
          <p className="muted">No vote totals could be formed.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="num">Player id</th>
                  <th scope="col" className="num">Votes</th>
                  <th scope="col">Eligible</th>
                </tr>
              </thead>
              <tbody>
                {report.rawVotes.topVoteGetters.map((entry) => (
                  <tr key={entry.playerId}>
                    <td className="num">{entry.playerId}</td>
                    <td className="num">{entry.votes}</td>
                    <td>{entry.eligible ? 'eligible' : 'ineligible'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="section-note">{report.rawVotes.playerTotals.length} players have a total in this report.</p>
      </section>
    </div>
  );
}
