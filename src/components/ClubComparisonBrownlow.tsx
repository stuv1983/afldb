import Link from 'next/link';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import type {
  ClubBrownlowHistory,
  ClubSeasonBrownlowSummary,
  ClubSeasonComparison,
  ComparisonOrganization,
  H2HBrownlow,
} from '@/db/queries/club-comparison';
import {
  coverageLabel,
  h2hBrownlowCoverageSentence,
} from '@/lib/club-comparison-format';
import { formatNumber, formatStat, playerPath } from '@/lib/format';

/**
 * Brownlow presentation for /clubs/compare (AFLDB-ISSUE-144 Stage 8).
 *
 * Three separate things, kept separate because the query layer keeps
 * them separate:
 *
 *  - the SELECTED SEASON at the club grain, where a total is shown only
 *    when the season's coverage is authoritative and a pending season
 *    says "Pending" rather than nothing or zero;
 *  - the CLUB HISTORY, which counts complete seasons only and discloses
 *    the multi-club rows it could not honestly attribute;
 *  - the HEAD-TO-HEAD match votes, which are home-and-away only —
 *    finals are never polled — and always carry their X-of-Y coverage.
 *
 * No total on this page is derived from match-level votes.
 */
export function ClubComparisonBrownlow({
  organizationA,
  organizationB,
  season,
  seasonA,
  seasonB,
  brownlowA,
  brownlowB,
  h2hBrownlow,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  season: number | null;
  seasonA: ClubSeasonComparison | null;
  seasonB: ClubSeasonComparison | null;
  brownlowA: ClubBrownlowHistory;
  brownlowB: ClubBrownlowHistory;
  h2hBrownlow: H2HBrownlow;
}) {
  const sides = [
    { org: organizationA, season: seasonA, history: brownlowA },
    { org: organizationB, season: seasonB, history: brownlowB },
  ];

  return (
    <section className="section" id="brownlow">
      <h2>Brownlow</h2>

      <h3>Selected season{season === null ? '' : ` — ${season}`}</h3>
      <div className="grid grid-panels grid-shrink">
        {sides.map(({ org, season: data }) => (
          <div className="card" key={org.id}>
            <h4>{org.name}</h4>
            {!data ? (
              <p className="meta">No season is selected.</p>
            ) : (
              <SeasonBrownlow summary={data.brownlow} />
            )}
          </div>
        ))}
      </div>

      <CollapsiblePanel id="brownlow-history" title="Club Brownlow history" defaultOpen={false}>
        <p className="section-note">
          Seasons whose published season totals are complete, attributed to the club the
          player is recorded with for that season. Votes that cannot honestly be
          attributed to one club are disclosed below and are not counted.
        </p>
        <div className="grid grid-panels grid-shrink">
          {sides.map(({ org, history }) => (
            <div key={org.id}>
              {/* h3, not h4: this panel's own title is the <h2> inside
                  CollapsiblePanel's <summary>, so an h4 here skipped a
                  level for anyone navigating by heading. AFLDB-ISSUE-144
                  Stage 9. */}
              <h3>{org.name}</h3>
              <ClubHistory history={history} />
            </div>
          ))}
        </div>
      </CollapsiblePanel>

      <CollapsibleTable id="h2h-brownlow" title="Brownlow votes in this rivalry" defaultOpen={false}>
        <p className="section-note">
          {h2hBrownlowCoverageSentence(h2hBrownlow.coveredMeetings, h2hBrownlow.eligibleMeetings)}{' '}
          Coverage is {h2hBrownlow.coverage}. Only home-and-away meetings are eligible:
          finals are never polled and are no part of these totals.
        </p>
        {h2hBrownlow.players.length === 0 ? (
          <p className="empty">No Brownlow votes are recorded in any meeting of these two clubs.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>
                Brownlow votes polled in matches between these clubs —{' '}
                {formatNumber(h2hBrownlow.totalVotes)} votes
              </caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Votes</th>
                  <th scope="col" className="num">3-vote games</th>
                  <th scope="col" className="num">2-vote games</th>
                  <th scope="col" className="num">1-vote games</th>
                  <th scope="col" className="num">Polling games</th>
                  <th scope="col" className="num">For {organizationA.name}</th>
                  <th scope="col" className="num">For {organizationB.name}</th>
                </tr>
              </thead>
              <tbody>
                {h2hBrownlow.players.map((player) => (
                  <tr key={player.playerId}>
                    <td className="wide">
                      <Link href={playerPath(player.slug, player.playerId)}>
                        {player.displayName}
                      </Link>
                    </td>
                    <td className="num">{formatNumber(player.votes)}</td>
                    <td className="num">{formatNumber(player.threeVoteGames)}</td>
                    <td className="num">{formatNumber(player.twoVoteGames)}</td>
                    <td className="num">{formatNumber(player.oneVoteGames)}</td>
                    <td className="num">{formatNumber(player.pollingGames)}</td>
                    <td className="num">{formatNumber(player.aVotes)}</td>
                    <td className="num">{formatNumber(player.bVotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>
    </section>
  );
}

/**
 * A club's selected-season Brownlow. `isAuthoritative` is the only thing
 * that permits a total; a pending season says so in words, and no state
 * is ever rendered as zero.
 */
function SeasonBrownlow({ summary }: { summary: ClubSeasonBrownlowSummary }) {
  if (!summary.isAuthoritative) {
    return (
      <>
        <p className="not-recorded">{coverageLabel(summary.coverage)}</p>
        <p className="meta">
          {summary.coverage === 'pending'
            ? 'The season’s Brownlow count has not been published yet.'
            : 'No authoritative season total is available for this season.'}
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        <strong>{formatStat(summary.totalVotes)}</strong> votes from{' '}
        {formatStat(summary.playersWithVotes)} players.
      </p>
      {summary.winners.length > 0 && (
        <p>
          Medal winner{summary.winners.length > 1 ? 's' : ''}:{' '}
          {summary.winners.map((winner, index) => (
            <span key={winner.playerId}>
              {index > 0 && ', '}
              <Link href={playerPath(winner.slug, winner.playerId)}>{winner.displayName}</Link>
              {winner.isIneligible && <span className="badge badge-warn">Ineligible</span>}
            </span>
          ))}
        </p>
      )}
      {summary.leaders.length === 0 ? (
        <p className="muted">No player from this club polled a vote.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption>Leading vote-getters</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Votes</th>
              </tr>
            </thead>
            <tbody>
              {summary.leaders.map((leader) => (
                <tr key={`${leader.rank}-${leader.playerId}`}>
                  <td className="num">{leader.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(leader.slug, leader.playerId)}>
                      {leader.displayName}
                    </Link>
                    {leader.isWinner && <span className="badge">Winner</span>}
                    {leader.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                    {leader.attributionSource === 'unattributed' && (
                      <span className="badge badge-warn">Club not attributed</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(leader.votes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary.unattributedRows > 0 && (
        <p className="notice">
          {formatNumber(summary.unattributedRows)} vote{summary.unattributedRows === 1 ? '' : 's'}{' '}
          row{summary.unattributedRows === 1 ? '' : 's'} ({formatNumber(summary.unattributedVotes)}{' '}
          votes) could not be attributed to a single club this season and are not counted here.
        </p>
      )}
    </>
  );
}

function ClubHistory({ history }: { history: ClubBrownlowHistory }) {
  if (history.seasonsCovered === 0) {
    return <p className="muted">No season with complete published totals is on record.</p>;
  }
  return (
    <>
      <p>
        {formatNumber(history.totalVotes)} votes across{' '}
        {formatNumber(history.seasonsCovered)} seasons, and{' '}
        {formatNumber(history.winners.length)} medal
        {history.winners.length === 1 ? '' : 's'}.
      </p>
      {history.winners.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>Brownlow medallists</caption>
            <thead>
              <tr>
                <th scope="col" className="num">Season</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Votes</th>
              </tr>
            </thead>
            <tbody>
              {history.winners.map((winner) => (
                <tr key={`${winner.season}-${winner.playerId}`}>
                  <td className="num">{winner.season}</td>
                  <td className="wide">
                    <Link href={playerPath(winner.slug, winner.playerId)}>
                      {winner.displayName}
                    </Link>
                    {winner.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                  </td>
                  <td className="num">{formatNumber(winner.votes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.voteLeaders.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>Most club-attributed votes</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Votes</th>
                <th scope="col" className="num">Seasons</th>
              </tr>
            </thead>
            <tbody>
              {history.voteLeaders.map((leader) => (
                <tr key={`${leader.rank}-${leader.playerId}`}>
                  <td className="num">{leader.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(leader.slug, leader.playerId)}>
                      {leader.displayName}
                    </Link>
                    {leader.winners > 0 && (
                      <span className="badge">
                        {leader.winners} medal{leader.winners === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatNumber(leader.votes)}</td>
                  <td className="num">{formatNumber(leader.seasons)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.unattributed.rows > 0 && (
        <p className="notice">
          {formatNumber(history.unattributed.rows)} vote rows
          ({formatNumber(history.unattributed.votes)} votes) belong to players associated with
          this club but cannot be attributed to it, and are not counted above.
        </p>
      )}
      {history.excludedSeasons.length > 0 && (
        <p className="notice">
          Excluded, because their season totals are not complete:{' '}
          {history.excludedSeasons
            .map((excluded) => `${excluded.season} (${coverageLabel(excluded.coverage).toLowerCase()})`)
            .join(', ')}.
        </p>
      )}
    </>
  );
}
