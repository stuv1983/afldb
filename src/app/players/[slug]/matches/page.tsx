import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { RouteSortHeader } from '@/components/RouteSortHeader';
import { getPlayer, getPlayerMatches } from '@/db/queries/players';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatStat,
  matchPath,
  parseEntitySlug,
  playerPath,
} from '@/lib/format';
import { firstValue, parsePage, parseSeason } from '@/lib/params';
import { isFilteredView, notFoundMetadata, pageMetadata } from '@/lib/seo';

// Paging lives here rather than on the profile so that the profile
// itself stays free of searchParams and can be served from the full
// route cache.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  const player = parsed ? await getPlayer(parsed.id) : null;
  if (!player) return notFoundMetadata('Player');

  return pageMetadata({
    title: `${player.displayName} — Complete Match Log`,
    description:
      `Every VFL/AFL match played by ${player.displayName}, with the opponent, `
      + 'result, score and his statistics in each.',
    path: `${playerPath(player.slug, player.id)}/matches`,
    // Every page but the first is a slice of the same log, and the canonical
    // already points all of them at page one. See /players for the reasoning.
    noindex: isFilteredView(await searchParams),
  });
}

export default async function PlayerMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const parsed = parseEntitySlug(slug);
  if (!parsed) notFound();

  const player = await getPlayer(parsed.id);
  if (!player) notFound();

  if (parsed.slug !== player.slug) {
    permanentRedirect(`${playerPath(player.slug, player.id)}/matches`);
  }

  const page = parsePage(firstValue(query.page));
  const seasonFilter = parseSeason(firstValue(query.season));

  const sort = firstValue(query.sort);
  const dir = firstValue(query.dir);

  const matches = await getPlayerMatches(player.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    season: seasonFilter,
    sort,
    dir,
  });

  const profilePath = playerPath(player.slug, player.id);

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Players', href: '/players' },
        { label: player.displayName, href: profilePath },
        { label: 'Match log' },
      ]} />

      <div className="page-header">
        <h1>{player.displayName} — Match Log</h1>
        <p className="subtitle">
          {formatNumber(matches.total)} matches
          {seasonFilter ? ` in ${seasonFilter}` : ''}
        </p>
      </div>

      {matches.total === 0 ? (
        <div className="empty">
          <h2>No matches found</h2>
          <p><Link href={profilePath}>Back to {player.displayName}</Link></p>
        </div>
      ) : (
        <>
          <CollapsibleTable title="Match log">
          <div className="table-wrap">
            <table>
              <caption>“—” means the statistic was not recorded in that era.</caption>
              <thead>
                <tr>
                  <RouteSortHeader sortKey="no" defaultSort="no" defaultDir="asc" className="num">#</RouteSortHeader>
                  <RouteSortHeader sortKey="date" defaultSort="no" defaultDir="asc">Date</RouteSortHeader>
                  <RouteSortHeader sortKey="rd" defaultSort="no" defaultDir="asc">Rd</RouteSortHeader>
                  <RouteSortHeader sortKey="club" defaultSort="no" defaultDir="asc">Club</RouteSortHeader>
                  <RouteSortHeader sortKey="opponent" defaultSort="no" defaultDir="asc">Opponent</RouteSortHeader>
                  <th scope="col">Res</th>
                  <RouteSortHeader sortKey="score" defaultSort="no" defaultDir="asc" className="num">Score</RouteSortHeader>
                  <RouteSortHeader sortKey="g" defaultSort="no" defaultDir="asc" className="num">G</RouteSortHeader>
                  <RouteSortHeader sortKey="b" defaultSort="no" defaultDir="asc" className="num">B</RouteSortHeader>
                  <RouteSortHeader sortKey="k" defaultSort="no" defaultDir="asc" className="num">K</RouteSortHeader>
                  <RouteSortHeader sortKey="hb" defaultSort="no" defaultDir="asc" className="num">HB</RouteSortHeader>
                  <RouteSortHeader sortKey="d" defaultSort="no" defaultDir="asc" className="num">D</RouteSortHeader>
                  <RouteSortHeader sortKey="m" defaultSort="no" defaultDir="asc" className="num">M</RouteSortHeader>
                  <RouteSortHeader sortKey="t" defaultSort="no" defaultDir="asc" className="num">T</RouteSortHeader>
                  <RouteSortHeader sortKey="ho" defaultSort="no" defaultDir="asc" className="num">HO</RouteSortHeader>
                  <RouteSortHeader sortKey="bv" defaultSort="no" defaultDir="asc" className="num">BV</RouteSortHeader>
                </tr>
              </thead>
              <tbody>
                {matches.rows.map((m) => (
                  <tr key={m.matchId}>
                    <td className="num">{m.careerGameNo ?? '—'}</td>
                    <td className="nowrap">
                      <Link href={matchPath(m.matchId)}>{formatDate(m.matchDate)}</Link>
                    </td>
                    <td className="nowrap">
                      {m.season} {formatRoundShort(m.roundType, m.roundNumber)}
                    </td>
                    <td>{m.clubName}</td>
                    <td className="wide">
                      <Link href={clubPath(m.opponentSlug)}>{m.opponentName}</Link>
                    </td>
                    <td className={`result-${m.outcome}`}>{m.outcome}</td>
                    <td className="num nowrap">{m.pointsFor}–{m.pointsAgainst}</td>
                    <td className="num">{formatStat(m.goals)}</td>
                    <td className="num">{formatStat(m.behinds)}</td>
                    <td className="num">{formatStat(m.kicks)}</td>
                    <td className="num">{formatStat(m.handballs)}</td>
                    <td className="num">{formatStat(m.disposals)}</td>
                    <td className="num">{formatStat(m.marks)}</td>
                    <td className="num">{formatStat(m.tackles)}</td>
                    <td className="num">{formatStat(m.hitouts)}</td>
                    <td className="num">{formatStat(m.brownlowVotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>

          <Pagination
            basePath={`${profilePath}/matches`}
            params={{ season: seasonFilter ? String(seasonFilter) : undefined }}
            page={page}
            pageSize={PAGE_SIZE}
            total={matches.total}
          />
        </>
      )}
    </>
  );
}
