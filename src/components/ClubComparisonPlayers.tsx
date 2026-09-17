import Link from 'next/link';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type {
  ComparisonOrganization,
  CrossoverPlayer,
  CrossoverSummary,
  H2HAverageBoard,
  H2HPlayerAverages,
  H2HPlayerLeader,
  H2HPlayerLeaders,
  H2HStatRecord,
} from '@/db/queries/club-comparison';
import { crossoverDirectionLabel } from '@/lib/club-comparison-format';
import { clubPath, formatDate, formatNumber, formatStat, matchPath, playerPath } from '@/lib/format';

/**
 * The player-shaped rivalry sections of /clubs/compare
 * (AFLDB-ISSUE-144 Stage 8): H2H leaderboards, connected players and
 * H2H per-match averages. Collapsed behind one top-level disclosure by
 * the Club Rivalry Explorer follow-up, FR-3 — its three subsections use
 * `<h3>` rather than `<h2>`, since the outer `CollapsiblePanel` supplies
 * the section's own `<h2>` in its `<summary>`.
 *
 * Two contracts are load-bearing in the markup. A player who appeared
 * for both clubs in this rivalry is ONE leaderboard row with two
 * breakdowns, never two rows — so the breakdown columns are always
 * shown. And "direction" is the first recorded representation and
 * nothing more: the wording never claims a trade, a transfer or a move.
 */
export function ClubComparisonPlayers({
  organizationA,
  organizationB,
  playerLeaders,
  crossoverSummary,
  crossoverPlayers,
  playerAverages,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  playerLeaders: H2HPlayerLeaders;
  crossoverSummary: CrossoverSummary;
  crossoverPlayers: CrossoverPlayer[];
  playerAverages: H2HPlayerAverages;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <CollapsiblePanel id="players" title="Players" defaultOpen={false}>
      <section id="player-leaders">
        <h3>Player rivalry leaders</h3>
        <p className="section-note">
          Across every meeting of the two clubs. A player who appeared for both clubs in
          this rivalry — and several have — is one row here, with the split shown.
        </p>

        <LeaderBoard
          caption={`Most matches in this rivalry`}
          valueLabel="Matches"
          leaders={playerLeaders.games}
          aName={aName}
          bName={bName}
          value={(leader) => formatNumber(leader.games)}
          aValue={(leader) => formatNumber(leader.a.games)}
          bValue={(leader) => formatNumber(leader.b.games)}
        />

        <LeaderBoard
          caption={`Most goals in this rivalry`}
          valueLabel="Goals"
          leaders={playerLeaders.goals}
          aName={aName}
          bName={bName}
          value={(leader) => formatStat(leader.goals)}
          aValue={(leader) => formatStat(leader.a.goals)}
          bValue={(leader) => formatStat(leader.b.goals)}
          note="Goals are counted from matches in which goals were recorded."
        />

        <StatRecordTable
          title="Most goals in one match"
          record={playerLeaders.singleMatchGoals}
        />
        <StatRecordTable
          title="Most disposals in one match"
          record={playerLeaders.singleMatchDisposals}
        />
      </section>

      <section id="connected-players">
        <h3>Connected players</h3>
        <p className="section-note">
          Players who represented both clubs, counting every name each club has played
          under. “Order” is the club a player is first recorded for, and nothing more:
          these rows do not record a trade, a transfer or a direct move.
        </p>

        {crossoverPlayers.length === 0 ? (
          <p className="empty">No player is recorded as representing both clubs.</p>
        ) : (
          <>
            <p>
              {formatNumber(crossoverSummary.players)}{' '}
              {crossoverSummary.players === 1 ? 'player has' : 'players have'} represented both{' '}
              {aName} and {bName}.
            </p>
            <div className="table-wrap">
              <table>
                <caption>First and most recent to represent both clubs</caption>
                <tbody>
                  <CrossoverMilestoneRow
                    label="First to represent both"
                    players={crossoverSummary.firstToRepresentBoth}
                  />
                  <CrossoverMilestoneRow
                    label="Most recent to represent both"
                    players={crossoverSummary.mostRecentToRepresentBoth}
                  />
                </tbody>
              </table>
            </div>

            <CollapsibleTable
              id="connected-players-table"
              title="Every connected player"
              note={`${formatNumber(crossoverPlayers.length)} players`}
              defaultOpen={false}
              headingLevel={4}
            >
              <div className="table-wrap">
                <SortableTable
                  defaultSort="combined"
                  defaultDir="desc"
                  caption={`Players who represented both ${aName} and ${bName}`}
                  columns={[
                    { key: 'player', label: 'Player', sortType: 'text' },
                    { key: 'aGames', label: `${aName} games`, sortType: 'number', className: 'num' },
                    { key: 'aGoals', label: `${aName} goals`, sortType: 'number', className: 'num' },
                    { key: 'aSpan', label: `${aName} first–last`, sortType: 'date', className: 'nowrap' },
                    { key: 'bGames', label: `${bName} games`, sortType: 'number', className: 'num' },
                    { key: 'bGoals', label: `${bName} goals`, sortType: 'number', className: 'num' },
                    { key: 'bSpan', label: `${bName} first–last`, sortType: 'date', className: 'nowrap' },
                    { key: 'combined', label: 'Combined games', sortType: 'number', className: 'num' },
                    { key: 'careerGames', label: 'Career games', sortType: 'number', className: 'num' },
                    { key: 'careerGoals', label: 'Career goals', sortType: 'number', className: 'num' },
                    { key: 'direction', label: 'Order', sortType: 'text' },
                    { key: 'between', label: 'Clubs in between', sortType: 'text' },
                  ]}
                  items={crossoverPlayers.map((player) => ({
                    id: player.playerId,
                    values: {
                      player: player.sortName,
                      aGames: player.a.games,
                      aGoals: player.a.goals,
                      aSpan: player.a.firstMatchDate,
                      bGames: player.b.games,
                      bGoals: player.b.goals,
                      bSpan: player.b.firstMatchDate,
                      combined: player.combinedGames,
                      careerGames: player.careerGames,
                      careerGoals: player.careerGoals,
                      direction: crossoverDirectionLabel(player.direction, aName, bName),
                      between: player.interveningOrganizations.map((o) => o.name).join(', '),
                    },
                    element: (
                      <tr key={player.playerId}>
                        <td className="wide">
                          <Link href={playerPath(player.slug, player.playerId)}>
                            {player.displayName}
                          </Link>
                        </td>
                        <td className="num">{formatNumber(player.a.games)}</td>
                        <td className="num">{formatNumber(player.a.goals)}</td>
                        <td className="nowrap">
                          {formatDate(player.a.firstMatchDate)} – {formatDate(player.a.lastMatchDate)}
                        </td>
                        <td className="num">{formatNumber(player.b.games)}</td>
                        <td className="num">{formatNumber(player.b.goals)}</td>
                        <td className="nowrap">
                          {formatDate(player.b.firstMatchDate)} – {formatDate(player.b.lastMatchDate)}
                        </td>
                        <td className="num">{formatNumber(player.combinedGames)}</td>
                        <td className="num">{formatStat(player.careerGames)}</td>
                        <td className="num">{formatStat(player.careerGoals)}</td>
                        <td className="nowrap">
                          {crossoverDirectionLabel(player.direction, aName, bName)}
                        </td>
                        <td className="wide">
                          {player.interveningOrganizations.length === 0
                            ? '—'
                            : player.interveningOrganizations.map((org, index) => (
                                <span key={org.organizationId}>
                                  {index > 0 && ', '}
                                  <Link href={clubPath(org.slug)}>{org.name}</Link>
                                </span>
                              ))}
                        </td>
                      </tr>
                    ),
                  }))}
                />
              </div>
            </CollapsibleTable>
          </>
        )}
      </section>

      <section id="player-averages">
        <h3>Player averages in this rivalry</h3>
        <p className="section-note">
          Per-match averages over recorded rivalry matches only. A player needs at least{' '}
          {playerAverages.minimumRecordedGames} recorded rivalry games for the statistic in
          question to appear, and each average is over the matches the statistic was
          actually recorded in — never over unrecorded historical eras.
        </p>
        <CollapsiblePanel
          id="player-average-boards"
          title="Average leaderboards"
          note={`${formatNumber(playerAverages.boards.length)} statistics`}
          defaultOpen={false}
          headingLevel={4}
        >
          {playerAverages.boards.map((board) => (
            <AverageBoard key={board.key} board={board} minimum={playerAverages.minimumRecordedGames} />
          ))}
        </CollapsiblePanel>
      </section>
    </CollapsiblePanel>
  );
}

function LeaderBoard({
  caption,
  valueLabel,
  leaders,
  aName,
  bName,
  value,
  aValue,
  bValue,
  note,
}: {
  caption: string;
  valueLabel: string;
  leaders: H2HPlayerLeader[];
  aName: string;
  bName: string;
  value: (leader: H2HPlayerLeader) => string;
  aValue: (leader: H2HPlayerLeader) => string;
  bValue: (leader: H2HPlayerLeader) => string;
  note?: string;
}) {
  if (leaders.length === 0) {
    return <p className="empty">{caption}: no player qualifies.</p>;
  }
  return (
    <>
      {note && <p className="section-note">{note}</p>}
      <div className="table-wrap">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Player</th>
              <th scope="col" className="num">{valueLabel}</th>
              <th scope="col" className="num">For {aName}</th>
              <th scope="col" className="num">For {bName}</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((leader) => (
              <tr key={leader.playerId}>
                <td className="num">{leader.rank}</td>
                <td className="wide">
                  <Link href={playerPath(leader.slug, leader.playerId)}>{leader.displayName}</Link>
                </td>
                <td className="num">{value(leader)}</td>
                <td className="num">{aValue(leader)}</td>
                <td className="num">{bValue(leader)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * A single-match rivalry record. A null value is a coverage statement —
 * the statistic was never recorded in any meeting of this pair — and is
 * never presented as a record of nought.
 */
function StatRecordTable({ title, record }: { title: string; record: H2HStatRecord }) {
  if (record.value === null || record.holders.length === 0) {
    return (
      <p className="muted">
        {title}: not recorded in any meeting of these two clubs.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption>
          {title} — {formatNumber(record.value)}
          {record.holders.length > 1 && `, shared by ${record.holders.length} players`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col" className="num">Value</th>
            <th scope="col">Playing for</th>
            <th scope="col">Match</th>
            <th scope="col" className="num">Season</th>
          </tr>
        </thead>
        <tbody>
          {record.holders.map((holder) => (
            <tr key={`${holder.playerId}-${holder.matchId}`}>
              <td className="wide">
                <Link href={playerPath(holder.slug, holder.playerId)}>{holder.displayName}</Link>
              </td>
              <td className="num">{formatNumber(holder.value)}</td>
              <td className="wide">
                <Link href={clubPath(holder.clubSlug)}>{holder.clubName}</Link>
              </td>
              <td className="nowrap">
                <Link href={matchPath(holder.matchId)}>{formatDate(holder.matchDate)}</Link>
              </td>
              <td className="num">{holder.season}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrossoverMilestoneRow({
  label,
  players,
}: {
  label: string;
  players: CrossoverPlayer[];
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {players.length === 0 ? (
          <span className="not-recorded">Not recorded</span>
        ) : (
          players.map((player, index) => (
            <span key={player.playerId}>
              {index > 0 && ', '}
              <Link href={playerPath(player.slug, player.playerId)}>{player.displayName}</Link>
              {' '}({formatDate(player.completionDate)})
            </span>
          ))
        )}
      </td>
    </tr>
  );
}

function AverageBoard({ board, minimum }: { board: H2HAverageBoard; minimum: number }) {
  if (!board.isAvailable) {
    return (
      <p className="muted">
        {board.label}: not recorded in any of this rivalry’s{' '}
        {formatNumber(board.rivalrySeasons)} seasons.
      </p>
    );
  }
  if (board.leaders.length === 0) {
    return (
      <p className="muted">
        {board.label}: no player has {minimum} or more recorded rivalry games for this
        statistic.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption>
          {board.label} — average per recorded rivalry match.{' '}
          Minimum {minimum} recorded rivalry games for this stat.
          {board.hasCoverageGap && (
            <> Recorded in {formatNumber(board.coveredSeasons)} of{' '}
              {formatNumber(board.rivalrySeasons)} rivalry seasons, so this does not span
              the whole rivalry.</>
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">Average</th>
            <th scope="col" className="num">Recorded games</th>
          </tr>
        </thead>
        <tbody>
          {board.leaders.map((leader) => (
            <tr key={`${leader.rank}-${leader.playerId}`}>
              <td className="num">{leader.rank}</td>
              <td className="wide">
                <Link href={playerPath(leader.slug, leader.playerId)}>{leader.displayName}</Link>
              </td>
              <td className="num">{leader.average.toFixed(1)}</td>
              <td className="num">{formatNumber(leader.recordedGames)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
