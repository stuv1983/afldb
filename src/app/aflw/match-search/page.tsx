import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { TableFilters } from '@/components/TableFilters';
import {
  type AflwMatchSort,
  getAflwSeasonOptions,
  isAflwMatchSort,
  listAflwClubs,
  listAflwVenues,
  runAflwMatchSearch,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwMatchPath,
  aflwSeasonPath,
  formatDate,
  formatNumber,
  formatScore,
} from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import {
  AFLW_MATCH_GROUPS,
  AFLW_MATCH_SORT_OPTIONS,
  aflwMatchFilterFields,
} from '@/search/aflw-filters';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';
import {
  describeFilters,
  filterQueryParams,
  parseFilterValues,
} from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLW Match Search',
  description:
    'Search every AFLW match by margin, combined score, club, season, venue, '
    + 'result and match type. Every search is a shareable link.',
  alternates: { canonical: '/aflw/match-search' },
};

export default async function AflwMatchSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const sortParam = firstValue(params.sort);
  const sort: AflwMatchSort = isAflwMatchSort(sortParam) ? sortParam : 'date_desc';

  const [clubs, seasons, venues] = await Promise.all([
    listAflwClubs(),
    getAflwSeasonOptions(),
    listAflwVenues(),
  ]);
  const fields = aflwMatchFilterFields({
    clubs: clubs
      .map((club) => ({ value: club.code, label: club.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    seasons: seasons.map((season) => ({ value: season.key, label: season.label })),
    venues: venues.map((venue) => ({
      value: venue.slug,
      label: `${venue.name} (${venue.matches})`,
    })),
  });
  const values = parseFilterValues(fields, params);

  const { rows, total } = await runAflwMatchSearch({
    sort,
    limit: DEFAULT_PAGE_SIZE,
    offset: (page - 1) * DEFAULT_PAGE_SIZE,
    clubs: values.multi.club,
    seasonKey: values.select.season,
    venue: values.select.venue,
    outcome: values.select.outcome,
    matchType: values.select.match_type,
    ranges: values,
  });

  const linkParams = { ...filterQueryParams(fields, values), sort };
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters
      action="/aflw/match-search"
      fields={fields}
      values={values}
      groups={AFLW_MATCH_GROUPS}
      sort={{
        name: 'sort', label: 'Sort by', value: sort, options: AFLW_MATCH_SORT_OPTIONS,
      }}
      submitLabel="Search matches"
      defaultOpen
    />
  );

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <span>Match Search</span>
      </nav>

      <div className="page-header">
        <h1>AFLW Match Search</h1>
        <p className="subtitle">
          Find AFLW games by scoreline, club, season and venue. Every result set is a
          shareable URL. Looking for career statistics?{' '}
          <Link href="/aflw/players">Search players</Link>.
        </p>
      </div>

      {values.errors.length > 0 && (
        <div className="notice filter-errors" role="alert">
          {values.errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      <CollapsibleTable
        title="Matches"
        note={`${formatNumber(total)} matching`}
        filters={filters}
      >
        {described.length > 0 && <p className="section-note">{described.join(' · ')}</p>}

        {rows.length === 0 ? (
          <div className="empty">
            <h2>No matches meet those criteria</h2>
            <p>Try increasing a maximum or removing a filter.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Season</th>
                    <th scope="col">Round</th>
                    <th scope="col">Home</th>
                    <th scope="col" className="num">Score</th>
                    <th scope="col">Away</th>
                    <th scope="col" className="num">Margin</th>
                    <th scope="col">Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((match) => (
                    <tr key={match.matchKey}>
                      <td className="nowrap">
                        <Link href={aflwMatchPath(match.matchKey)}>
                          {formatDate(match.matchDate)}
                        </Link>
                      </td>
                      <td className="nowrap">
                        <Link href={aflwSeasonPath(match.seasonKey)}>
                          {match.seasonLabel}
                        </Link>
                      </td>
                      <td className="nowrap">
                        {match.roundType === 'home_and_away'
                          ? `R${match.roundNumber}`
                          : match.roundCode}
                      </td>
                      <td className="wide">
                        <Link href={aflwClubPath(match.homeTeamCode)}>
                          {match.homeClubName}
                        </Link>
                      </td>
                      <td className="num nowrap">
                        {formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}–
                        {formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}
                      </td>
                      <td className="wide">
                        <Link href={aflwClubPath(match.awayTeamCode)}>
                          {match.awayClubName}
                        </Link>
                      </td>
                      <td className="num">
                        {match.result === 'draw' ? 'Draw' : `${match.margin} pts`}
                      </td>
                      <td>{match.venueName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              basePath="/aflw/match-search"
              params={linkParams}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
            />
          </>
        )}
      </CollapsibleTable>

      <section className="section">
        <h2>Example searches</h2>
        <ul>
          <li>
            <Link href="/aflw/match-search?margin_max=6&sort=margin_asc">
              Decided by a goal or less, closest first
            </Link>
          </li>
          <li>
            <Link href="/aflw/match-search?match_type=grand_final&sort=date_desc">
              Every Grand Final
            </Link>
          </li>
          <li>
            <Link href="/aflw/match-search?outcome=draw&sort=date_desc">
              Drawn matches
            </Link>
          </li>
          <li>
            <Link href="/aflw/match-search?high_score_min=100&sort=high_score_desc">
              Games where a team passed 100 points
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
