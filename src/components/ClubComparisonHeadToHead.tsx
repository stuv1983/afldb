import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { SortableTable } from '@/components/SortableTable';
import type {
  ComparisonOrganization,
  H2HMeeting,
  H2HRecordEntry,
  H2HRecordKind,
  H2HRecords,
  H2HStreak,
  H2HStreaks,
  H2HSummary,
  H2HVenueRecord,
  MeetingsPage,
} from '@/db/queries/club-comparison';
import type { ComparisonEffectiveParams } from '@/app/clubs/compare/state';
import {
  matchTypeLabel,
  outcomeLabel,
  recordKindLabel,
  recordKindUnit,
} from '@/lib/club-comparison-format';
import { CLUB_COMPARE_PATH, clubCompareBaseParams } from '@/lib/club-comparison-url';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatRound,
  formatStat,
  matchPath,
} from '@/lib/format';

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

/**
 * Head-to-head overview, rivalry records and the meeting history
 * (AFLDB-ISSUE-144 Stage 8).
 *
 * The match-type filter is honoured exactly where the Stage 1 contract
 * applies it — the meeting history — and the all-time sections say so
 * rather than quietly appearing to be filtered. Every tied record
 * witness is listed: a rivalry's lowest score is genuinely held twice
 * often enough that collapsing it would be a silent edit.
 */
export function ClubComparisonHeadToHead({
  organizationA,
  organizationB,
  params,
  summary,
  meetings,
  records,
  streaks,
  venues,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  params: ComparisonEffectiveParams;
  summary: H2HSummary;
  meetings: MeetingsPage;
  records: H2HRecords;
  streaks: H2HStreaks;
  venues: H2HVenueRecord[];
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <>
      <section className="section" id="head-to-head">
        <h2>Head-to-head</h2>
        <p className="section-note">
          Every meeting the two clubs have played, across every name each has played under.
          This summary is all-time and is not narrowed by the match-type filter; the
          match history below is.
        </p>

        {summary.meetings === 0 ? (
          <p className="empty">{aName} and {bName} have never met.</p>
        ) : (
          <>
            <div className="stat-strip">
              <div className="stat">
                <div className="value">{formatNumber(summary.meetings)}</div>
                <div className="label">Total meetings</div>
              </div>
              <div className="stat">
                <div className="value">{formatNumber(summary.aWins)}</div>
                <div className="label">{aName} wins</div>
                <div className="note">
                  {summary.aWinPercentage === null
                    ? formatStat(null)
                    : `${formatPercentage(summary.aWinPercentage)}%`}
                </div>
              </div>
              <div className="stat">
                <div className="value">{formatNumber(summary.bWins)}</div>
                <div className="label">{bName} wins</div>
                <div className="note">
                  {summary.bWinPercentage === null
                    ? formatStat(null)
                    : `${formatPercentage(summary.bWinPercentage)}%`}
                </div>
              </div>
              <div className="stat">
                <div className="value">{formatNumber(summary.draws)}</div>
                <div className="label">Draws</div>
              </div>
              <div className="stat">
                <div className="value">{formatNumber(summary.finalsSeriesMeetings)}</div>
                <div className="label">Finals-series meetings</div>
              </div>
              <div className="stat">
                <div className="value">{formatNumber(summary.grandFinalMeetings)}</div>
                <div className="label">Grand Final meetings</div>
              </div>
            </div>
            <p className="section-note">
              Win percentages count a draw as half a win. Finals-series meetings are
              matches flagged as part of a finals series; a Wildcard Final is not one.
            </p>
            <div className="table-wrap">
              <table>
                <caption>First and latest meeting</caption>
                <tbody>
                  <tr>
                    <th scope="row">First meeting</th>
                    <td>
                      {summary.firstMeeting ? (
                        <Link href={matchPath(summary.firstMeeting.matchId)}>
                          {formatDate(summary.firstMeeting.matchDate)} ({summary.firstMeeting.season})
                        </Link>
                      ) : formatStat(null)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Latest meeting</th>
                    <td>
                      {summary.latestMeeting ? (
                        <Link href={matchPath(summary.latestMeeting.matchId)}>
                          {formatDate(summary.latestMeeting.matchDate)} ({summary.latestMeeting.season})
                        </Link>
                      ) : formatStat(null)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="section" id="rivalry-records">
        <h2>Rivalry records</h2>
        <p className="section-note">
          All-time, over every meeting of the two clubs. Where a record is shared, every
          match that holds it is listed.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Rivalry records — {aName} and {bName}</caption>
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

        <CollapsibleTable id="venue-records" title="Venue records" defaultOpen={false}>
          {venues.length === 0 ? (
            <p className="empty">No venue is recorded for any meeting of these two clubs.</p>
          ) : (
            <div className="table-wrap">
              <SortableTable
                defaultSort="meetings"
                defaultDir="desc"
                caption={`Meetings by venue — ${aName} and ${bName}`}
                columns={[
                  { key: 'venue', label: 'Venue', sortType: 'text' },
                  { key: 'meetings', label: 'Meetings', sortType: 'number', className: 'num' },
                  { key: 'aWins', label: `${aName} wins`, sortType: 'number', className: 'num' },
                  { key: 'bWins', label: `${bName} wins`, sortType: 'number', className: 'num' },
                  { key: 'draws', label: 'Draws', sortType: 'number', className: 'num' },
                  { key: 'first', label: 'First', sortType: 'date', className: 'nowrap' },
                  { key: 'latest', label: 'Latest', sortType: 'date', className: 'nowrap' },
                ]}
                items={venues.map((venue, index) => ({
                  id: `${venue.venueId ?? 'raw'}-${venue.venueName ?? index}`,
                  values: {
                    venue: venue.venueName ?? '',
                    meetings: venue.meetings,
                    aWins: venue.aWins,
                    bWins: venue.bWins,
                    draws: venue.draws,
                    first: venue.firstMeeting,
                    latest: venue.latestMeeting,
                  },
                  element: (
                    <tr key={`${venue.venueId ?? 'raw'}-${venue.venueName ?? index}`}>
                      <td className="wide">{venue.venueName ?? 'Venue not recorded'}</td>
                      <td className="num">{formatNumber(venue.meetings)}</td>
                      <td className="num">{formatNumber(venue.aWins)}</td>
                      <td className="num">{formatNumber(venue.bWins)}</td>
                      <td className="num">{formatNumber(venue.draws)}</td>
                      <td className="nowrap">{formatDate(venue.firstMeeting)}</td>
                      <td className="nowrap">{formatDate(venue.latestMeeting)}</td>
                    </tr>
                  ),
                }))}
              />
            </div>
          )}
        </CollapsibleTable>
      </section>

      <section className="section" id="match-history">
        <h2>Match history</h2>
        <p className="section-note">
          {matchTypeLabel(meetings.matchType)}: {formatNumber(meetings.totalMeetings)}{' '}
          {meetings.totalMeetings === 1 ? 'meeting' : 'meetings'}, most recent first.
        </p>
        <CollapsibleTable id="match-history-table" title="Every meeting" defaultOpen={false}>
          {meetings.totalMeetings === 0 ? (
            <p className="empty">
              No meeting matches this filter. Try “All matches”.
            </p>
          ) : meetings.meetings.length === 0 ? (
            <p className="empty">
              Page {meetings.page} is past the end of this history — there are{' '}
              {formatNumber(meetings.totalPages)} pages.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>
                  {aName} versus {bName} — {matchTypeLabel(meetings.matchType)}, page{' '}
                  {meetings.page} of {formatNumber(meetings.totalPages)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="nowrap">Date</th>
                    <th scope="col" className="num">Season</th>
                    <th scope="col">Round</th>
                    <th scope="col">Venue</th>
                    <th scope="col">Home</th>
                    <th scope="col" className="num">Score</th>
                    <th scope="col">Away</th>
                    <th scope="col">Result</th>
                    <th scope="col" className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.meetings.map((meeting) => (
                    <tr key={meeting.matchId}>
                      <td className="nowrap">
                        <Link href={matchPath(meeting.matchId)}>
                          {formatDate(meeting.matchDate)}
                        </Link>
                      </td>
                      <td className="num">{meeting.season}</td>
                      <td className="nowrap">
                        {formatRound(meeting.roundType, meeting.roundNumber, meeting.roundCode)}
                        {meeting.isFinalsSeries && <span className="badge">Finals</span>}
                      </td>
                      <td className="wide">{meeting.venueName ?? 'Not recorded'}</td>
                      <td className="wide">
                        <Link href={clubPath(meeting.homeClubSlug)}>{meeting.homeClubName}</Link>
                      </td>
                      <td className="num nowrap">
                        {formatStat(meeting.homeScore)}–{formatStat(meeting.awayScore)}
                      </td>
                      <td className="wide">
                        <Link href={clubPath(meeting.awayClubSlug)}>{meeting.awayClubName}</Link>
                      </td>
                      <td>{outcomeLabel(meeting.outcome, aName, bName)}</td>
                      <td className="num">{formatStat(meeting.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            basePath={CLUB_COMPARE_PATH}
            params={clubCompareBaseParams(params)}
            page={meetings.page}
            pageSize={meetings.pageSize}
            total={meetings.totalMeetings}
          />
        </CollapsibleTable>
      </section>
    </>
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
