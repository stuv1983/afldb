import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Pagination } from '@/components/Pagination';
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

// Paging lives here rather than on the profile so that the profile
// itself stays free of searchParams and can be served from the full
// route cache.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  const player = parsed ? await getPlayer(parsed.id) : null;
  if (!player) return { title: 'Player not found' };

  return {
    title: `${player.displayName} — Complete Match Log`,
    description: `Every VFL/AFL match played by ${player.displayName}.`,
    alternates: { canonical: `${playerPath(player.slug, player.id)}/matches` },
  };
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

  const matches = await getPlayerMatches(player.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    season: seasonFilter,
  });

  const profilePath = playerPath(player.slug, player.id);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/players">Players</Link>
        <span aria-hidden="true">/</span>
        <Link href={profilePath}>{player.displayName}</Link>
        <span aria-hidden="true">/</span>
        <span>Match log</span>
      </nav>

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
          <div className="table-wrap">
            <table>
              <caption>“—” means the statistic was not recorded in that era.</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Date</th>
                  <th scope="col">Rd</th>
                  <th scope="col">Club</th>
                  <th scope="col">Opponent</th>
                  <th scope="col">Res</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col" className="num">G</th>
                  <th scope="col" className="num">B</th>
                  <th scope="col" className="num">K</th>
                  <th scope="col" className="num">HB</th>
                  <th scope="col" className="num">D</th>
                  <th scope="col" className="num">M</th>
                  <th scope="col" className="num">T</th>
                  <th scope="col" className="num">HO</th>
                  <th scope="col" className="num">BV</th>
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
