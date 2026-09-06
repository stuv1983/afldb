import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type {
  ComparisonOrganization,
  H2HDecade,
  H2HPeriodRecordKind,
  H2HPeriodRecords,
} from '@/db/queries/club-comparison';
import {
  decadeLabel,
  periodCoverageSentence,
  periodRecordLabel,
  turnaroundSegmentLabel,
} from '@/lib/club-comparison-format';
import { formatDate, formatNumber, formatPercentage, formatStat, matchPath } from '@/lib/format';

const PERIOD_ORDER: H2HPeriodRecordKind[] = [
  'biggest-quarter-time-lead-a',
  'biggest-quarter-time-lead-b',
  'biggest-half-time-lead-a',
  'biggest-half-time-lead-b',
  'biggest-three-quarter-time-lead-a',
  'biggest-three-quarter-time-lead-b',
  'biggest-comeback-from-quarter-time-a',
  'biggest-comeback-from-quarter-time-b',
  'biggest-comeback-from-half-time-a',
  'biggest-comeback-from-half-time-b',
  'biggest-comeback-from-three-quarter-time-a',
  'biggest-comeback-from-three-quarter-time-b',
  'largest-turnaround-a',
  'largest-turnaround-b',
];

/**
 * Rivalry by decade and period-score rivalry records
 * (AFLDB-ISSUE-144 Stage 8).
 *
 * Decade labels come from the rows: no decade, era or year boundary is
 * written down here.
 *
 * Every period record names the organisation whose record it is, and
 * carries both clubs' break scores plus the full-time score, because one
 * meeting routinely holds two opposite records — Adelaide's biggest
 * quarter-time lead over Brisbane Lions is the same match as Brisbane
 * Lions' biggest comeback from quarter time, and a bare margin would
 * misattribute one of them. The full-time score is the canonical match
 * score, never the fourth period's own points.
 */
export function ClubComparisonTrends({
  organizationA,
  organizationB,
  decades,
  periodRecords,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  decades: H2HDecade[];
  periodRecords: H2HPeriodRecords;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <>
      <section className="section" id="by-decade">
        <h2>By decade</h2>
        {decades.length === 0 ? (
          <p className="empty">There is no meeting to break down by decade.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>{aName} versus {bName}, decade by decade</caption>
              <thead>
                <tr>
                  <th scope="col">Decade</th>
                  <th scope="col" className="num">Meetings</th>
                  <th scope="col" className="num">{aName} wins</th>
                  <th scope="col" className="num">{bName} wins</th>
                  <th scope="col" className="num">Draws</th>
                  <th scope="col" className="num">{aName} win %</th>
                  <th scope="col" className="num">{bName} win %</th>
                  <th scope="col" className="num">{aName} points for</th>
                  <th scope="col" className="num">{aName} points against</th>
                  <th scope="col" className="num">Scored meetings</th>
                </tr>
              </thead>
              <tbody>
                {decades.map((decade) => (
                  <tr key={decade.decade}>
                    <th scope="row">{decadeLabel(decade.decade)}</th>
                    <td className="num">{formatNumber(decade.meetings)}</td>
                    <td className="num">{formatNumber(decade.aWins)}</td>
                    <td className="num">{formatNumber(decade.bWins)}</td>
                    <td className="num">{formatNumber(decade.draws)}</td>
                    <td className="num">
                      {decade.aWinPercentage === null
                        ? formatStat(null)
                        : `${formatPercentage(decade.aWinPercentage)}%`}
                    </td>
                    <td className="num">
                      {decade.bWinPercentage === null
                        ? formatStat(null)
                        : `${formatPercentage(decade.bWinPercentage)}%`}
                    </td>
                    <td className="num">{formatStat(decade.aPointsFor)}</td>
                    <td className="num">{formatStat(decade.aPointsAgainst)}</td>
                    <td className="num">{formatNumber(decade.scoredMeetings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="section-note">
          Points are summed over meetings with a recorded score only; “scored meetings” is
          the denominator behind them. {aName}’s points against are {bName}’s points for.
        </p>
      </section>

      <section className="section" id="period-records">
        <h2>Period records</h2>
        <p className="section-note">
          {periodCoverageSentence(
            periodRecords.coverage.usableMeetings,
            periodRecords.coverage.meetings,
          )}{' '}
          Break scores are cumulative. Full-time is the canonical match score.
        </p>
        <CollapsibleTable
          id="period-records-table"
          title="Leads, comebacks and turnarounds"
          defaultOpen={false}
        >
          {periodRecords.coverage.usableMeetings === 0 ? (
            <p className="empty">
              No meeting of these two clubs has complete period scores recorded.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>Period-score rivalry records — {aName} and {bName}</caption>
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col" className="num">Points</th>
                    <th scope="col">Match</th>
                    <th scope="col" className="num">Season</th>
                    <th scope="col" className="nowrap">{aName} QT/HT/3QT</th>
                    <th scope="col" className="nowrap">{bName} QT/HT/3QT</th>
                    <th scope="col" className="nowrap">Full time ({aName} first)</th>
                  </tr>
                </thead>
                <tbody>
                  {PERIOD_ORDER.flatMap((kind) => {
                    const entries = periodRecords.records[kind] ?? [];
                    const label = periodRecordLabel(kind, aName, bName);
                    if (entries.length === 0) {
                      return [(
                        <tr key={kind}>
                          <th scope="row">{label}</th>
                          <td className="not-recorded" colSpan={6}>Not recorded</td>
                        </tr>
                      )];
                    }
                    return entries.map((entry, index) => {
                      const segment = turnaroundSegmentLabel(entry.segment);
                      return (
                        <tr key={`${kind}-${entry.matchId}`}>
                          <th scope="row">
                            {label}
                            {segment && <span className="meta"> — {segment}</span>}
                            {entries.length > 1 && (
                              <span className="badge">Tied {index + 1} of {entries.length}</span>
                            )}
                          </th>
                          <td className="num">{formatNumber(entry.value)}</td>
                          <td className="wide">
                            <Link href={matchPath(entry.matchId)}>
                              {formatDate(entry.matchDate)} — {entry.homeClubName} v{' '}
                              {entry.awayClubName}
                            </Link>
                          </td>
                          <td className="num">{entry.season}</td>
                          <td className="num nowrap">
                            {entry.aQuarterTime}/{entry.aHalfTime}/{entry.aThreeQuarterTime}
                          </td>
                          <td className="num nowrap">
                            {entry.bQuarterTime}/{entry.bHalfTime}/{entry.bThreeQuarterTime}
                          </td>
                          <td className="num nowrap">
                            {formatStat(entry.aScore)}–{formatStat(entry.bScore)}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
          {periodRecords.coverage.incompleteMeetings > 0 && (
            <p className="notice">
              {formatNumber(periodRecords.coverage.incompleteMeetings)} of{' '}
              {formatNumber(periodRecords.coverage.meetings)} meetings have missing or
              incomplete period scores and are not part of these records.
            </p>
          )}
        </CollapsibleTable>
      </section>
    </>
  );
}
