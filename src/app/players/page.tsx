import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { Pagination } from '@/components/Pagination';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import { isPlayerSort, listPlayers, type PlayerSort } from '@/db/queries/players';
import { getSeasonBounds } from '@/db/queries/seasons';
import { formatNumber, playerPath } from '@/lib/format';
import { redirectPastEnd } from '@/lib/pagination';
import { firstValue, parsePage } from '@/lib/params';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';
import { CAREER_GROUPS, clubOptions, playerFilterFields } from '@/search/list-filters';
import {
  describeFilters,
  filterQueryParams,
  filterSearchParams,
  parseFilterValues,
  yearOptions,
} from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Players',
  description:
    'Every player to appear in a VFL/AFL match since 1897, with career games, '
    + 'goals, finals and Brownlow votes.',
  alternates: { canonical: '/players' },
};

const SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: 'games', label: 'Games' },
  { value: 'goals', label: 'Goals' },
  { value: 'brownlow_votes', label: 'Brownlow' },
  { value: 'finals', label: 'Finals' },
  { value: 'debut', label: 'Debut' },
  { value: 'name', label: 'Name' },
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

  const [clubs, bounds] = await Promise.all([getClubOptions(), getSeasonBounds()]);
  const fields = playerFilterFields({
    clubs: clubOptions(clubs),
    seasons: yearOptions(bounds.min, bounds.max),
  });
  const values = parseFilterValues(fields, params);

  const { rows, total } = await listPlayers({
    sort,
    limit: DEFAULT_PAGE_SIZE,
    offset: (page - 1) * DEFAULT_PAGE_SIZE,
    club: values.select.club,
    season: values.select.season ? Number(values.select.season) : undefined,
    name: values.text.name,
    ranges: values,
  });

  const linkParams = { ...filterQueryParams(fields, values), sort };

  redirectPastEnd({
    basePath: '/players',
    params: linkParams,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    total,
  });

  const described = describeFilters(fields, values);

  // Sort is a row of links rather than a control inside the panel: it is
  // one click, it stays shareable, and it survives a filter submission
  // through the hidden field below.
  const sortHref = (key: PlayerSort) =>
    `/players?${filterSearchParams(fields, values, { sort: key })}`;

  const filters = (
    <TableFilters
      action="/players"
      anchor="players"
      fields={fields}
      values={values}
      groups={CAREER_GROUPS}
      hidden={{ sort }}
    />
  );

  return (
    <>
      <div className="page-header">
        <h1>Players</h1>
        <p className="subtitle">
          {formatNumber(total)} players
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
        <p className="section-note">
          <Link href="/players/compare">Compare two players →</Link>{' '}
          — career stats side by side, from any club or era, plus every match they shared.
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <nav aria-label="Sort players" style={{ marginBottom: '0.75rem' }}>
        <span className="muted" style={{ fontSize: '0.8125rem', marginRight: '0.5rem' }}>
          Sort by:
        </span>
        {SORT_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={sortHref(option.value)}
            className="badge"
            style={{
              marginRight: '0.3rem',
              background: option.value === sort ? 'var(--accent)' : undefined,
              color: option.value === sort ? 'var(--text-invert)' : undefined,
            }}
            aria-current={option.value === sort ? 'true' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <CollapsibleTable
        id="players"
        title="Players"
        note={`${formatNumber(total)} matching`}
        filters={filters}
      >
        {rows.length === 0 ? (
          <div className="empty">
            <h2>No players match those filters</h2>
            <p>Try widening a range or clearing the club and season.</p>
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
      </CollapsibleTable>
    </>
  );
}
