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
import { isFilteredView, pageMetadata } from '@/lib/seo';
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

/**
 * The unfiltered index is the indexable page; every filter, sort and page
 * beyond the first is a view OF it.
 *
 * Those views stay crawlable and `follow`, because the links out of them are
 * how a crawler reaches players deep in the list. What they must not be is
 * indexable: the canonical already points every one of them at `/players`,
 * and canonicalising materially different result sets to one URL is the
 * mistake that gets a canonical ignored altogether. `noindex, follow` says
 * the same thing without asking Google to believe something untrue.
 *
 * The combinatorial space behind this page is unbounded — any pair of bounds
 * on any of a dozen career fields — but the DISCOVERABLE space is not: the
 * filters are a GET form rather than a grid of links, so a crawler only ever
 * finds the five example searches, the seven sort links and the pager.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  return pageMetadata({
    title: 'AFL & VFL Players — Every Player Since 1897',
    description:
      'Every player to appear in a VFL/AFL match since 1897. Search by name or '
      + 'filter by career games, goals, finals, premierships, Brownlow votes, '
      + 'clubs and debut season. Every search is a shareable link.',
    path: '/players',
    noindex: isFilteredView(params),
  });
}

const SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: 'games', label: 'Games' },
  { value: 'goals', label: 'Goals' },
  { value: 'brownlow_votes', label: 'Brownlow' },
  { value: 'finals', label: 'Finals' },
  { value: 'premierships', label: 'Premierships' },
  { value: 'debut', label: 'Debut' },
  { value: 'name', label: 'Name' },
];

/**
 * Searches worth starting from, shown only on an unfiltered index.
 *
 * These came across from Advanced Player Search when the two pages merged:
 * the filter panel answers the same questions the standalone form did, but a
 * panel of empty min/max pairs does not suggest what to ask it. Every link is
 * a plain URL against this page's own parameters.
 */
const EXAMPLE_SEARCHES: { href: string; label: string }[] = [
  {
    href: '/players?games_min=200&goals_min=100&finals_min=15',
    label: '200+ games, 100+ goals and 15+ finals',
  },
  {
    href: '/players?debut_min=1960&debut_max=1969&clubs_min=2&clubs_max=2',
    label: 'Debuted in the 1960s and played for exactly two clubs',
  },
  {
    href: '/players?games_min=200&games_max=249&finals_min=16',
    label: '200–249 games with 16 or more finals',
  },
  {
    href: '/players?goals_min=50&goals_max=199&brownlow_votes_max=0',
    label: '50–199 career goals and no Brownlow votes',
  },
  {
    href: '/players?premierships_min=4&sort=premierships',
    label: 'Four or more premierships',
  },
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
          Search by name or combine career criteria in the filters below — every
          search is a shareable URL.{' '}
          <Link href="/players/compare">Compare two players →</Link>
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <nav className="sort-nav" aria-label="Sort players">
        <span className="sort-label">Sort by</span>
        {SORT_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={sortHref(option.value)}
            className="sort-link"
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
                    <th scope="col" className="num">Prem</th>
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
                      <td className="num">{formatNumber(p.premierships)}</td>
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

      {values.active === 0 && (
        <section className="section">
          <h2>Example searches</h2>
          <ul className="ruled-list">
            {EXAMPLE_SEARCHES.map((example) => (
              <li key={example.href}>
                <Link href={example.href}>{example.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
