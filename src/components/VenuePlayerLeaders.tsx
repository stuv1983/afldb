import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type {
  VenueLeaderCategory, VenueLeaderRow, VenuePlayerLeaders as VenuePlayerLeadersData,
} from '@/db/queries/venues';
import { formatNumber, playerPath } from '@/lib/format';

/**
 * The venue page's player-leaders section (AFLDB-ISSUE-150): the top
 * five players at the ground for games, goals, marks, kicks and
 * handballs, from {@link getVenuePlayerLeaders}.
 *
 * Games count player-match rows at the venue. The statistical totals SUM
 * only the venue matches where the statistic was actually recorded — a
 * NULL (the stat was not collected in that era) is never treated as 0 —
 * so the marks / kicks / handballs boards carry a "recorded games"
 * count and a heading that says "Recorded", because those statistics do
 * not have complete historical coverage.
 */

const BOARDS: {
  category: VenueLeaderCategory;
  heading: string;
  valueLabel: string;
  /** Whether to show the recorded-games denominator and "Recorded" wording. */
  recorded: boolean;
}[] = [
  { category: 'games', heading: 'Games', valueLabel: 'Games', recorded: false },
  { category: 'goals', heading: 'Goals', valueLabel: 'Goals', recorded: true },
  { category: 'marks', heading: 'Recorded marks', valueLabel: 'Marks', recorded: true },
  { category: 'kicks', heading: 'Recorded kicks', valueLabel: 'Kicks', recorded: true },
  { category: 'handballs', heading: 'Recorded handballs', valueLabel: 'Handballs', recorded: true },
];

function LeaderBoard({
  heading,
  valueLabel,
  recorded,
  rows,
  venueName,
}: {
  heading: string;
  valueLabel: string;
  recorded: boolean;
  rows: VenueLeaderRow[];
  venueName: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption>{heading} at {venueName}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">{valueLabel}</th>
            {recorded && <th scope="col" className="num nowrap">Rec. games</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId}>
              <td className="num">{r.rank}</td>
              <td className="wide">
                <Link href={playerPath(r.playerSlug, r.playerId)}>{r.playerName}</Link>
              </td>
              <td className="num">{formatNumber(r.value)}</td>
              {recorded && <td className="num">{formatNumber(r.recordedGames)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VenuePlayerLeaders({
  leaders,
  venueName,
}: {
  leaders: VenuePlayerLeadersData;
  venueName: string;
}) {
  const hasAny = BOARDS.some((b) => leaders[b.category].length > 0);
  if (!hasAny) return null;

  return (
    <section className="section">
      <p className="section-note">
        The five players with the most games, goals, marks, kicks and handballs at{' '}
        {venueName}. Marks, kicks and handballs were not recorded for much of VFL/AFL
        history; those totals sum only the matches where the statistic was recorded,
        shown as &ldquo;Rec. games&rdquo;.
      </p>
      <CollapsibleTable title="Player leaders">
        <div className="grid grid-panels grid-shrink">
          {BOARDS.map((b) => (
            <LeaderBoard
              key={b.category}
              heading={b.heading}
              valueLabel={b.valueLabel}
              recorded={b.recorded}
              rows={leaders[b.category]}
              venueName={venueName}
            />
          ))}
        </div>
      </CollapsibleTable>
    </section>
  );
}
