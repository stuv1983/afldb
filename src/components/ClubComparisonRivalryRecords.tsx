import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type {
  ComparisonOrganization,
  H2HDecade,
  H2HMeeting,
  H2HPeriodRecordKind,
  H2HPeriodRecords,
  H2HRecordEntry,
  H2HRecordKind,
  H2HRecords,
  H2HStreak,
  H2HStreaks,
} from '@/db/queries/club-comparison';
import type { ComparisonEffectiveParams } from '@/app/clubs/compare/state';
import {
  decadeLabel,
  eraCaptionSuffix,
  eraScopeSentence,
  outcomeLabel,
  periodCoverageSentence,
  periodRecordLabel,
  recordKindLabel,
  recordKindUnit,
  turnaroundSegmentLabel,
} from '@/lib/club-comparison-format';
import { formatDate, formatNumber, formatPercentage, formatStat, matchPath } from '@/lib/format';

const RECORD_ORDER: H2HRecordKind[] = [
  'biggest-win-a',
  'biggest-win-b',
  'closest-game',
  'highest-score-a',
  'highest-score-b',
  'lowest-score-a',
  'lowest-score-b',
  'highest-combined-score',
];

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
 * Rivalry records for /clubs/compare (Club Rivalry Explorer follow-up,
 * FR-3): the single-match records and streaks that were the old
 * `ClubComparisonHeadToHead`'s "Rivalry records" section, plus the
 * by-decade breakdown and period-score records that used to live in the
 * separate `ClubComparisonTrends` component. The approved reorder names
 * one "Rivalry records" section between the era explorer and Venues, so
 * all four live under that one heading now, as subsections.
 *
 * Always fully expanded — this is core rivalry-history content, not a
 * long tail — except the period-records table, which keeps the nested
 * disclosure it already had: that table is the one large enough to
 * warrant its own collapse even inside an otherwise-expanded section.
 *
 * Only the records table and (implicitly, via its own population) the
 * by-decade table honour the era filter; streaks stay all-time because a
 * decade boundary would truncate a run that crosses it, and the same is
 * true of period records, which are read from the pair's whole history.
 */
export function ClubComparisonRivalryRecords({
  organizationA,
  organizationB,
  params,
  records,
  streaks,
  decades,
  periodRecords,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  params: ComparisonEffectiveParams;
  records: H2HRecords;
  streaks: H2HStreaks;
  decades: H2HDecade[];
  periodRecords: H2HPeriodRecords;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <section className="section" id="rivalry-records">
      <h2>Rivalry records</h2>
      <p className="section-note">
        {eraScopeSentence(params.era)} Where a record is shared, every match that holds
        it is listed.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Rivalry records — {aName} and {bName}{eraCaptionSuffix(params.era)}</caption>
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">Measure</th>
              <th scope="col">Match</th>
              <th scope="col" className="num">Season</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {RECORD_ORDER.flatMap((kind) => {
              const entries = records[kind] ?? [];
              const label = recordKindLabel(kind, aName, bName);
              if (entries.length === 0) {
                return [(
                  <tr key={kind}>
                    <th scope="row">{label}</th>
                    <td className="not-recorded" colSpan={5}>Not recorded</td>
                  </tr>
                )];
              }
              return entries.map((entry: H2HRecordEntry, index) => (
                <tr key={`${kind}-${entry.matchId}`}>
                  <th scope="row">
                    {label}
                    {entries.length > 1 && (
                      <span className="badge">Tied {index + 1} of {entries.length}</span>
                    )}
                  </th>
                  <td className="num">{formatNumber(entry.value)}</td>
                  <td>{recordKindUnit(kind)}</td>
                  <td className="wide"><MeetingLink meeting={entry} /></td>
                  <td className="num">{entry.season}</td>
                  <td className="nowrap">
                    {formatStat(entry.aScore)}–{formatStat(entry.bScore)}
                    <span className="meta"> ({aName} first)</span>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {params.era !== null && (
        <p className="section-note">
          Streaks are always all-time — an era filter narrows records above, not streaks,
          because a decade boundary would truncate a run that crosses it.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption>Streaks</caption>
          <thead>
            <tr>
              <th scope="col">Streak</th>
              <th scope="col" className="num">Matches</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            <StreakRow label={`Longest winning streak — ${aName}`} streak={streaks.longestA} />
            <StreakRow label={`Longest winning streak — ${bName}`} streak={streaks.longestB} />
            <StreakRow
              label="Current streak"
              streak={streaks.current}
              outcomeName={streaks.current
                ? outcomeLabel(streaks.current.outcome, aName, bName)
                : undefined}
            />
          </tbody>
        </table>
      </div>

      <div id="by-decade">
        <h3>By decade</h3>
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
          This breakdown is always all-time — it is the source of the era chips above, not
          a view they narrow.
        </p>
      </div>

      <div id="period-records">
        <h3>Period records</h3>
        <p className="section-note">
          {periodCoverageSentence(
            periodRecords.coverage.usableMeetings,
            periodRecords.coverage.meetings,
          )}{' '}
          Break scores are cumulative. Full-time is the canonical match score. Always
          all-time, regardless of the era filter above.
        </p>
        <CollapsibleTable
          id="period-records-table"
          title="Leads, comebacks and turnarounds"
          defaultOpen={false}
          headingLevel={4}
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
      </div>
    </section>
  );
}

function MeetingLink({ meeting }: { meeting: H2HMeeting }) {
  return (
    <Link href={matchPath(meeting.matchId)}>
      {formatDate(meeting.matchDate)} — {meeting.homeClubName} v {meeting.awayClubName}
    </Link>
  );
}

function StreakRow({
  label,
  streak,
  outcomeName,
}: {
  label: string;
  streak: H2HStreak | null;
  outcomeName?: string;
}) {
  if (!streak) {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td className="not-recorded" colSpan={3}>None on record</td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row">
        {label}
        {outcomeName && <span className="meta"> ({outcomeName})</span>}
      </th>
      <td className="num">{formatNumber(streak.length)}</td>
      <td className="nowrap">
        <Link href={matchPath(streak.fromMatchId)}>
          {formatDate(streak.fromMatchDate)} ({streak.fromSeason})
        </Link>
      </td>
      <td className="nowrap">
        <Link href={matchPath(streak.toMatchId)}>
          {formatDate(streak.toMatchDate)} ({streak.toSeason})
        </Link>
      </td>
    </tr>
  );
}
