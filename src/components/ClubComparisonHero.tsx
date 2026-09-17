import Link from 'next/link';

import type { ComparisonOrganization, H2HSummary } from '@/db/queries/club-comparison';
import { formatDate, formatNumber, formatPercentage, formatStat, matchPath } from '@/lib/format';

/**
 * The all-time head-to-head hero summary for /clubs/compare (Club Rivalry
 * Explorer follow-up, FR-3). Split out of the former monolithic
 * `ClubComparisonHeadToHead` so it can render immediately after the club
 * controls, ahead of the era explorer and every other section.
 *
 * This is the one summary that is never era-scoped and is never presented
 * behind a collapsed disclosure: it is the all-time rivalry at a glance.
 */
export function ClubComparisonHero({
  organizationA,
  organizationB,
  summary,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  summary: H2HSummary;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <section className="section" id="head-to-head">
      <h2>Head-to-head</h2>
      <p className="section-note">
        Every meeting the two clubs have played, across every name each has played under.
        This summary is all-time and is not narrowed by the match-type filter; the
        match history further down the page is.
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
  );
}
