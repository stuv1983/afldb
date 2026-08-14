import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/Pagination';
import { isPlayerSort, listPlayers, type PlayerSort } from '@/db/queries/players';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue, parsePage, parseSeason, parseSlug } from '@/lib/params';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Players',
  description:
    'Every player to appear in a VFL/AFL match since 1897, with career games, '
    + 'goals, finals and Brownlow votes.',
  alternates: { canonical: '/players' },
};

const SORT_OPTIONS: { key: PlayerSort; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'goals', label: 'Goals' },
  { key: 'brownlow_votes', label: 'Brownlow' },
  { key: 'finals', label: 'Finals' },
  { key: 'debut', label: 'Debut' },
  { key: 'name', label: 'Name' },
];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const sortParam = firstValue(params.sort);
  const sort: PlayerSort = isPlayerSort(sortParam) ? sortParam : 'games';
  const club = parseSlug(firstValue(params.club));
  const season = parseSeason(firstValue(params.season));

  const { rows, total } = await listPlayers({
    sort,
    limit: DEFAULT_PAGE_SIZE,
    offset: (page - 1) * DEFAULT_PAGE_SIZE,
    club,
    season,
  });

  const linkParams = { sort, club, season: season ? String(season) : undefined };

  // A page past the end is a real URL people arrive at from stale links and
  // hand-edited query strings. Send them to the last page that exists rather
  // than rendering an empty table under a full result count.
  if (total > 0 && rows.length === 0) {
    const lastPage = Math.ceil(total / DEFAULT_PAGE_SIZE);
    if (page > lastPage) {
      const query = new URLSearchParams();
      query.set('sort', sort);
      if (club) query.set('club', club);
      if (season) query.set('season', String(season));
      if (lastPage > 1) query.set('page', String(lastPage));
      redirect(`/players?${query}`);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Players</h1>
        <p className="subtitle">
          {formatNumber(total)} players
          {club ? ` · club: ${club}` : ''}
          {season ? ` · season: ${season}` : ''}
        </p>
      </div>

      <nav aria-label="Sort players" style={{ marginBottom: '0.75rem' }}>
        <span className="muted" style={{ fontSize: '0.8125rem', marginRight: '0.5rem' }}>
          Sort by:
        </span>
        {SORT_OPTIONS.map((option) => {
          const query = new URLSearchParams();
          query.set('sort', option.key);
          if (club) query.set('club', club);
          if (season) query.set('season', String(season));
          return (
            <Link
              key={option.key}
              href={`/players?${query}`}
              className="badge"
              style={{
                marginRight: '0.3rem',
                background: option.key === sort ? 'var(--accent)' : undefined,
                color: option.key === sort ? 'var(--text-invert)' : undefined,
              }}
              aria-current={option.key === sort ? 'true' : undefined}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="empty">
          <h2>No players match those filters</h2>
          <p>Try removing the club or season filter.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption>Career totals. Brownlow votes are season totals from 1924.</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Clubs</th>
                  <th scope="col" className="num">Span</th>
                  <th scope="col" className="num">Games</th>
                  <th scope="col" className="num">Goals</th>
                  <th scope="col" className="num">Finals</th>
                  <th scope="col" className="num">Brownlow</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="wide">
                      <Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link>
                    </td>
                    <td className="wide">{p.clubNames ?? '—'}</td>
                    <td className="num nowrap">
                      {p.debutSeason}–{p.finalSeason}
                    </td>
                    <td className="num">{formatNumber(p.games)}</td>
                    <td className="num">{formatNumber(p.goals)}</td>
                    <td className="num">{formatNumber(p.finals)}</td>
                    <td className="num">{formatNumber(p.brownlowVotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            basePath="/players"
            params={linkParams}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
