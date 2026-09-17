import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ClubPremiershipPlayerRow } from '@/db/queries/clubs';
import { formatNumber, playerPath } from '@/lib/format';

/**
 * The club page's Premiership Players section (AFLDB-ISSUE-149), from
 * {@link getClubPremiershipPlayers}: the players in each of the club's
 * premiership sides, grouped by premiership season, newest first.
 *
 * Attribution is the canonical `player_club_season_stats.is_premier`
 * flag, scoped to the club's lineage — never inferred. A player who won
 * more than one flag appears once per season. The premiership seasons
 * here agree with the club's won Grand Finals (the Premierships section);
 * `tests/integration/club-premiership-players.test.ts` asserts that.
 *
 * Rendered as one sortable table with a Season column rather than
 * separate per-season blocks: the default order (season descending, then
 * games) keeps each season's players contiguous — a de-facto grouping —
 * while letting the reader re-sort by any column without a heading-level
 * jump on the page.
 */
export function ClubPremiershipPlayers({
  players,
  clubRecordName,
  hasLineage,
}: {
  players: ClubPremiershipPlayerRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  if (players.length === 0) return null;

  const seasons = new Set(players.map((p) => p.season));

  return (
    <section className="section">
      <p className="section-note">
        The players in each of {clubRecordName}&rsquo;s {formatNumber(seasons.size)}{' '}
        premiership {seasons.size === 1 ? 'side' : 'sides'}
        {hasLineage && ', across every era of the club'}, grouped by season, newest
        first. Games, finals and goals are that premiership season&rsquo;s.
      </p>
      <CollapsibleTable title="Premiership players">
        <div className="table-wrap">
          <SortableTable
            defaultSort="season"
            defaultDir="desc"
            caption={`${clubRecordName} premiership players, from player_club_season_stats.is_premier`}
            columns={[
              { key: 'season', label: 'Season', sortType: 'number', className: 'num' },
              { key: 'player', label: 'Player', sortType: 'text' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
              { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
              { key: 'goals', label: 'Goals', sortType: 'number', className: 'num' },
            ]}
            items={players.map((p) => ({
              id: `${p.season}-${p.playerId}`,
              values: {
                season: p.season,
                player: p.playerName,
                games: p.games,
                finals: p.finals,
                goals: p.goals ?? -1,
              },
              element: (
                <tr key={`${p.season}-${p.playerId}`}>
                  <td className="num">{p.season}</td>
                  <td className="wide">
                    <Link href={playerPath(p.playerSlug, p.playerId)}>{p.playerName}</Link>
                    {hasLineage && p.identityName !== clubRecordName && (
                      <span className="muted nowrap"> · {p.identityName}</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(p.games)}</td>
                  <td className="num">{formatNumber(p.finals)}</td>
                  <td className="num">{formatNumber(p.goals)}</td>
                </tr>
              ),
            }))}
          />
        </div>
      </CollapsibleTable>
    </section>
  );
}
