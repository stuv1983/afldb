import Link from 'next/link';

import { SortableTable } from '@/components/SortableTable';
import type { ResolvedCoach } from '@/app/coaches/compare/state';
import type { CoachCareerMatch, CoachHeadToHead, CoachHeadToHeadVenueRecord } from '@/db/queries/coaches';
import {
  NOT_RECORDED, clubPath, formatDate, formatNumber, formatPercentage, matchPath, venuePath,
} from '@/lib/format';

/**
 * Direct coach-v-coach head-to-head (AFLDB-ISSUE-170 Stage 2C): the record
 * between two selected coaches where they actually coached opposing clubs
 * against each other, kept clearly separate from Stage 2B's career
 * comparison ({@link CoachComparisonCareer}), which is independent of
 * whether the two coaches ever met.
 *
 * A plain prop-to-JSX renderer, no data fetching -- {@link getCoachHeadToHead}
 * decides everything about which matches count and how A/B are oriented;
 * this only renders the result it is handed.
 */

/** The two biggest-win rows, one per coach, following {@link CoachBiggestWinLossTable}'s row shape but labelled by coach name rather than "win"/"loss" -- both rows here are wins, just for different coaches. */
function CoachHeadToHeadBiggestWinsTable({
  coachA,
  coachB,
  biggestWinA,
  biggestWinB,
}: {
  coachA: ResolvedCoach;
  coachB: ResolvedCoach;
  biggestWinA: CoachCareerMatch | null;
  biggestWinB: CoachCareerMatch | null;
}) {
  if (biggestWinA === null && biggestWinB === null) {
    return <p className="muted">No qualifying (decided) direct meeting on record.</p>;
  }

  const rows: { label: string; match: CoachCareerMatch | null }[] = [
    { label: `${coachA.coach.displayName}’s biggest win`, match: biggestWinA },
    { label: `${coachB.coach.displayName}’s biggest win`, match: biggestWinB },
  ];

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col" className="num nowrap">Margin</th>
            <th scope="col">Coaching</th>
            <th scope="col" className="num">Season</th>
            <th scope="col" className="nowrap">Date</th>
            <th scope="col">Venue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, match }) => (
            <tr key={label}>
              <th scope="row">
                {label}
                {match?.roundType === 'grand_final' && <span className="muted"> — Grand Final</span>}
                {match?.roundType !== 'grand_final' && match?.isFinalsSeries && <span className="muted"> — Finals</span>}
              </th>
              {match ? (
                <>
                  <td className="num nowrap">+{formatNumber(match.margin)}</td>
                  <td><Link href={clubPath(match.coachedClubSlug)}>{match.coachedClubName}</Link></td>
                  <td className="num"><Link href={matchPath(match.matchId)}>{match.season}</Link></td>
                  <td className="nowrap">{formatDate(match.matchDate)}</td>
                  <td>
                    {match.venueSlug
                      ? <Link href={venuePath(match.venueSlug)}>{match.venueName}</Link>
                      : (match.venueName ?? NOT_RECORDED)}
                  </td>
                </>
              ) : (
                <td className="muted" colSpan={5}>No qualifying win on record.</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Direct-meeting venue history only (never career venue history), sorted `meetings DESC, venue name ASC, venue id ASC` (server order preserved as the sortable table's own default). */
function CoachHeadToHeadVenueTable({ venues }: { venues: CoachHeadToHeadVenueRecord[] }) {
  if (venues.length === 0) {
    return <p className="muted">No canonical direct-meeting venue history on record.</p>;
  }
  return (
    <div className="table-wrap">
      <SortableTable
        defaultSort="meetings"
        defaultDir="desc"
        columns={[
          { key: 'venue', label: 'Venue', sortType: 'text' },
          { key: 'meetings', label: 'Meetings', sortType: 'number', className: 'num' },
          { key: 'wld', label: 'A–B–D', sortType: 'number', className: 'num nowrap' },
          { key: 'aWinPct', label: 'A win %', sortType: 'number', className: 'num' },
          { key: 'bWinPct', label: 'B win %', sortType: 'number', className: 'num' },
          { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
          { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
          { key: 'firstMeeting', label: 'First', sortType: 'number', className: 'num nowrap' },
          { key: 'lastMeeting', label: 'Most recent', sortType: 'number', className: 'num nowrap' },
        ]}
        items={venues.map((v) => ({
          id: String(v.venueId),
          values: {
            venue: v.venueName,
            meetings: v.meetings,
            wld: v.aWins,
            aWinPct: v.aWinPct ?? -1,
            bWinPct: v.bWinPct ?? -1,
            finals: v.finals,
            grandFinals: v.grandFinals,
            firstMeeting: new Date(v.firstMeetingDate).getTime(),
            lastMeeting: new Date(v.lastMeetingDate).getTime(),
          },
          element: (
            <tr key={v.venueId}>
              <td><Link href={venuePath(v.venueSlug)}>{v.venueName}</Link></td>
              <td className="num">{formatNumber(v.meetings)}</td>
              <td className="num nowrap">{v.aWins}–{v.bWins}–{v.draws}</td>
              <td className="num">{formatPercentage(v.aWinPct)}</td>
              <td className="num">{formatPercentage(v.bWinPct)}</td>
              <td className="num">{formatNumber(v.finals)}</td>
              <td className="num">{formatNumber(v.grandFinals)}</td>
              <td className="num nowrap">{formatDate(v.firstMeetingDate)}</td>
              <td className="num nowrap">{formatDate(v.lastMeetingDate)}</td>
            </tr>
          ),
        }))}
      />
    </div>
  );
}

/**
 * The full Stage 2C section: totals, biggest direct win for each coach, and
 * direct-meeting venue history. `headToHead === null` is the unexpected
 * failed-load case (mirrors {@link CoachComparisonCareer}'s `careerA`/
 * `careerB` null handling); a real, distinct pair that never met is NOT
 * that case -- it is `totals.meetings === 0`, and gets its own deliberate
 * "never met" message rather than a fabricated table of zeros.
 */
export function CoachHeadToHeadSection({
  coachA,
  coachB,
  headToHead,
}: {
  coachA: ResolvedCoach;
  coachB: ResolvedCoach;
  headToHead: CoachHeadToHead | null;
}) {
  if (headToHead === null) {
    return (
      <section className="section">
        <h2>Head-to-head</h2>
        <p className="notice" role="status">
          Direct head-to-head data is not currently available for {coachA.coach.displayName} and{' '}
          {coachB.coach.displayName}. Try again shortly.
        </p>
      </section>
    );
  }

  const { totals } = headToHead;

  if (totals.meetings === 0) {
    return (
      <section className="section">
        <h2>Head-to-head</h2>
        <p className="muted">
          No canonical match has {coachA.coach.displayName} and {coachB.coach.displayName} coaching
          opposing clubs against each other.
        </p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Head-to-head</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <th scope="row">Meetings</th>
              <td className="num">{formatNumber(totals.meetings)}</td>
              <th scope="row">Finals</th>
              <td className="num">{formatNumber(totals.finals)}</td>
            </tr>
            <tr>
              <th scope="row">{coachA.coach.displayName} wins</th>
              <td className="num">{formatNumber(totals.aWins)}</td>
              <th scope="row">{coachB.coach.displayName} wins</th>
              <td className="num">{formatNumber(totals.bWins)}</td>
            </tr>
            <tr>
              <th scope="row">Draws</th>
              <td className="num">{formatNumber(totals.draws)}</td>
              <th scope="row">Grand Finals</th>
              <td className="num">{formatNumber(totals.grandFinals)}</td>
            </tr>
            <tr>
              <th scope="row">{coachA.coach.displayName} win %</th>
              <td className="num">{formatPercentage(totals.aWinPct)}</td>
              <th scope="row">{coachB.coach.displayName} win %</th>
              <td className="num">{formatPercentage(totals.bWinPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Biggest direct win</h3>
      <CoachHeadToHeadBiggestWinsTable
        coachA={coachA}
        coachB={coachB}
        biggestWinA={headToHead.biggestWinA}
        biggestWinB={headToHead.biggestWinB}
      />

      <h3>Venue history</h3>
      <CoachHeadToHeadVenueTable venues={headToHead.venues} />
    </section>
  );
}
