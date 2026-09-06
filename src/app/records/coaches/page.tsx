import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { type CoachRecordRow, getCoachRecordsByGames, getCoachRecordsByWinPct } from '@/db/queries/coaches';
import { coachPath, formatNumber, formatPercentage, formatSpan, playerPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { coachSlug } from '@/lib/slugs';

export const revalidate = 86400;

const TITLE = 'Coach Records';
const DEFINITION =
  'Most games and best win percentage for a VFL/AFL coach, from the canonical per-match '
  + 'coaching assignment — including coaches who never played at senior level.';
const MIN_GAMES = 50;

export const metadata: Metadata = pageMetadata({
  title: `${TITLE} — Most Games and Best Win Percentage`,
  description: DEFINITION,
  path: '/records/coaches',
});

function coachCell(row: CoachRecordRow) {
  const href = row.playerId !== null && row.playerSlug !== null
    ? playerPath(row.playerSlug, row.playerId)
    : coachPath(coachSlug(row.displayName), row.coachId);
  return <Link href={href}>{row.displayName}</Link>;
}

export default async function CoachRecordsPage() {
  const [byGames, byWinPct] = await Promise.all([
    getCoachRecordsByGames(50),
    getCoachRecordsByWinPct(MIN_GAMES, 50),
  ]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Records', href: '/records' }, { label: TITLE }]} />

      <div className="page-header">
        <h1>{TITLE}</h1>
        <p className="subtitle">{DEFINITION}</p>
      </div>

      <section className="section">
        <CollapsibleTable id="most-games" title="Most games coached" note={`${byGames.length} shown`} defaultOpen>
          <div className="table-wrap">
            <SortableTable
              defaultSort="rank"
              defaultDir="asc"
              columns={[
                { key: 'rank', label: '#', sortType: 'number', className: 'num' },
                { key: 'coach', label: 'Coach', sortType: 'text' },
                { key: 'span', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
                { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
                { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
                { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
                { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
                { key: 'premierships', label: 'Prem', sortType: 'number', className: 'num' },
              ]}
              items={byGames.map((r) => ({
                id: String(r.coachId),
                values: {
                  rank: r.rank,
                  coach: r.displayName,
                  span: r.firstSeason ?? -1,
                  games: r.games,
                  wld: r.wins,
                  winPct: r.winPct ?? -1,
                  finals: r.finals,
                  grandFinals: r.grandFinals,
                  premierships: r.premierships,
                },
                element: (
                  <tr key={r.coachId}>
                    <td className="num">{r.rank}</td>
                    <td className="wide">{coachCell(r)}</td>
                    <td className="num nowrap">{formatSpan(r.firstSeason, r.lastSeason)}</td>
                    <td className="num">{formatNumber(r.games)}</td>
                    <td className="num nowrap">{r.wins}–{r.losses}–{r.draws}</td>
                    <td className="num">{formatPercentage(r.winPct)}</td>
                    <td className="num">{formatNumber(r.finals)}</td>
                    <td className="num">{formatNumber(r.grandFinals)}</td>
                    <td className="num">{formatNumber(r.premierships)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable
          id="best-win-pct"
          title="Best win percentage"
          note={`Minimum ${MIN_GAMES} games coached · ${byWinPct.length} shown`}
        >
          <div className="table-wrap">
            <SortableTable
              defaultSort="rank"
              defaultDir="asc"
              columns={[
                { key: 'rank', label: '#', sortType: 'number', className: 'num' },
                { key: 'coach', label: 'Coach', sortType: 'text' },
                { key: 'span', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
                { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
                { key: 'premierships', label: 'Prem', sortType: 'number', className: 'num' },
              ]}
              items={byWinPct.map((r) => ({
                id: String(r.coachId),
                values: {
                  rank: r.rank,
                  coach: r.displayName,
                  span: r.firstSeason ?? -1,
                  games: r.games,
                  winPct: r.winPct ?? -1,
                  premierships: r.premierships,
                },
                element: (
                  <tr key={r.coachId}>
                    <td className="num">{r.rank}</td>
                    <td className="wide">{coachCell(r)}</td>
                    <td className="num nowrap">{formatSpan(r.firstSeason, r.lastSeason)}</td>
                    <td className="num">{formatNumber(r.games)}</td>
                    <td className="num">{formatPercentage(r.winPct)}</td>
                    <td className="num">{formatNumber(r.premierships)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <h2>About this record</h2>
        <p>
          Games, results and finals are counted from the canonical per-match coaching
          assignment (<code>match_coaches</code>), not from the AFL Tables coach index&rsquo;s
          own stored total, which is evidence only. A coach who also played at senior level
          links to their player profile rather than a separate coach-only page. The {MIN_GAMES}-game
          minimum for the win-percentage board is this page&rsquo;s own choice — AFLDB has no
          existing percentage-record convention to follow.
        </p>
        <p className="muted">
          Browse every coach, including those below the games/win-percentage thresholds, on the{' '}
          <Link href="/coaches">Coaches</Link> index.
        </p>
      </section>
    </>
  );
}
