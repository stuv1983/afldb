import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ClubPlayerRow } from '@/db/queries/clubs';
import { formatNumber, formatSpan, playerPath } from '@/lib/format';

/**
 * The club page's complete Players list (AFLDB-ISSUE-149): every player
 * in the canonical `player_clubs` data for the club's lineage, from
 * {@link getClubPlayers} — one row per player, with this club's games and
 * goals only.
 *
 * This is the whole historical list, not a Top-N leaderboard, so for an
 * old club it can run to many hundreds of rows. It is therefore
 * default-collapsed (the reader opens it deliberately) but never
 * truncated: the entire list is in the DOM and the existing
 * `SortableTable` lets the reader re-sort it. The default order is games
 * descending, then goals, then name — deterministic.
 */
export function ClubPlayers({
  players,
  clubRecordName,
  hasLineage,
}: {
  players: ClubPlayerRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  if (players.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        Every one of the {formatNumber(players.length)} players to represent{' '}
        {clubRecordName}
        {hasLineage && ', across every era of the club'}. Games and goals are for{' '}
        {clubRecordName} only.
      </p>
      <CollapsibleTable title="Players" defaultOpen={false}>
        <div className="table-wrap">
          <SortableTable
            defaultSort="games"
            defaultDir="desc"
            caption={`All ${formatNumber(players.length)} ${clubRecordName} players, from the canonical player_clubs record`}
            columns={[
              { key: 'player', label: 'Player', sortType: 'text' },
              { key: 'years', label: 'Years', sortType: 'number', className: 'num nowrap' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
              { key: 'goals', label: 'Goals', sortType: 'number', className: 'num' },
            ]}
            items={players.map((p) => ({
              id: String(p.id),
              values: {
                player: p.displayName,
                years: p.firstSeason,
                games: p.games,
                goals: p.goals,
              },
              element: (
                <tr key={p.id}>
                  <td className="wide">
                    <Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link>
                  </td>
                  <td className="num nowrap">{formatSpan(p.firstSeason, p.lastSeason)}</td>
                  <td className="num">{formatNumber(p.games)}</td>
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
