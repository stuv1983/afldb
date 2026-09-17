import Link from 'next/link';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import type {
  ClubBrownlowHistory,
  ComparisonOrganization,
  H2HBrownlow,
} from '@/db/queries/club-comparison';
import {
  coverageLabel,
  h2hBrownlowCoverageSentence,
} from '@/lib/club-comparison-format';
import { formatNumber, playerPath } from '@/lib/format';

/**
 * Brownlow presentation for /clubs/compare (AFLDB-ISSUE-144 Stage 8;
 * selected-season block removed by the Club Rivalry Explorer follow-up,
 * FR-1 — this page is all-time only). Collapsed behind one top-level
 * disclosure by FR-3: the club history and H2H match votes used to be
 * two independently-collapsible panels nested inside a plain `<section>`;
 * now the whole "Brownlow" section is the one collapsed unit, so its two
 * subsections are plain `<h3>` blocks rather than their own disclosures.
 *
 * Two separate things, kept separate because the query layer keeps them
 * separate:
 *
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
  brownlowA,
  brownlowB,
  h2hBrownlow,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  brownlowA: ClubBrownlowHistory;
  brownlowB: ClubBrownlowHistory;
  h2hBrownlow: H2HBrownlow;
}) {
  const sides = [
    { org: organizationA, history: brownlowA },
    { org: organizationB, history: brownlowB },
  ];

  return (
    <CollapsiblePanel id="brownlow" title="Brownlow" defaultOpen={false}>
      <div id="brownlow-history">
        <h3>Club Brownlow history</h3>
        <p className="section-note">
          Seasons whose published season totals are complete, attributed to the club the
          player is recorded with for that season. Votes that cannot honestly be
          attributed to one club are disclosed below and are not counted.
        </p>
        <div className="grid grid-panels grid-shrink">
          {sides.map(({ org, history }) => (
            <div key={org.id}>
              <h4>{org.name}</h4>
              <ClubHistory history={history} />
            </div>
          ))}
        </div>
      </div>

      <div id="h2h-brownlow">
        <h3>Brownlow votes in this rivalry</h3>
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
      </div>
    </CollapsiblePanel>
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
