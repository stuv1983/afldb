import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { TableFilters } from '@/components/TableFilters';
import {
  type AflwPlayerSort,
  getAflwSeasonOptions,
  isAflwPlayerSort,
  listAflwClubs,
  listAflwPlayers,
} from '@/db/queries/aflw';
import { aflwPlayerPath, formatNumber } from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import {
  AFLW_PLAYER_GROUPS,
  AFLW_PLAYER_SORT_OPTIONS,
  aflwPlayerFilterFields,
} from '@/search/aflw-filters';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';
import {
  describeFilters,
  filterQueryParams,
  parseFilterValues,
} from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLW Players',
  description:
    'Every player to appear in an AFLW match since 2017, searchable by games, '
    + 'goals, disposals, tackles, marks, premierships and club.',
  alternates: { canonical: '/aflw/players' },
};

export default async function AflwPlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(firstValue(params.page));
  const sortParam = firstValue(params.sort);
  const sort: AflwPlayerSort = isAflwPlayerSort(sortParam) ? sortParam : 'games';

  const [clubs, seasons] = await Promise.all([listAflwClubs(), getAflwSeasonOptions()]);
  const fields = aflwPlayerFilterFields({
    clubs: clubs
      .map((club) => ({ value: club.code, label: club.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    seasons: seasons.map((season) => ({ value: season.key, label: season.label })),
  });
  const values = parseFilterValues(fields, params);

  const { rows, total } = await listAflwPlayers({
    sort,
    limit: DEFAULT_PAGE_SIZE,
    offset: (page - 1) * DEFAULT_PAGE_SIZE,
    name: values.text.name,
    club: values.select.club,
    seasonKey: values.select.season,
    ranges: values,
  });

  const linkParams = { ...filterQueryParams(fields, values), sort };

  if (total > 0 && rows.length === 0) {
    const lastPage = Math.ceil(total / DEFAULT_PAGE_SIZE);
    if (page > lastPage) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(linkParams)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) query.append(key, item);
        else query.set(key, value);
      }
      if (lastPage > 1) query.set('page', String(lastPage));
      redirect(`/aflw/players?${query}`);
    }
  }

  const described = describeFilters(fields, values);

  // Same arrangement as the AFL player index: sort is a row of links, and
  // the panel carries the current sort through a submission.
  const sortHref = (key: string) => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filterQueryParams(fields, values))) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) query.append(name, item);
      else query.set(name, value);
    }
    query.set('sort', key);
    return `/aflw/players?${query}`;
  };

  const filters = (
    <TableFilters
      action="/aflw/players"
      fields={fields}
      values={values}
      groups={AFLW_PLAYER_GROUPS}
      hidden={{ sort }}
    />
  );

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <span>Players</span>
      </nav>

      <div className="page-header">
        <h1>AFLW Players</h1>
        <p className="subtitle">
          {formatNumber(total)} players
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      {values.errors.length > 0 && (
        <div className="notice filter-errors" role="alert">
          {values.errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      <nav aria-label="Sort players" style={{ marginBottom: '0.75rem' }}>
        <span className="muted" style={{ fontSize: '0.8125rem', marginRight: '0.5rem' }}>
          Sort by:
        </span>
        {AFLW_PLAYER_SORT_OPTIONS.map((option) => (
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
                <caption>
                  Career totals across every AFLW season. A player who did not score
                  in a match is recorded as nought, which is what the source means by
                  an empty scoring cell.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Clubs</th>
                    <th scope="col" className="num">Span</th>
                    <th scope="col" className="num">Games</th>
                    <th scope="col" className="num">Goals</th>
                    <th scope="col" className="num">Disposals</th>
                    <th scope="col" className="num">Marks</th>
                    <th scope="col" className="num">Tackles</th>
                    <th scope="col" className="num">Prem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((player) => (
                    <tr key={player.slug}>
                      <td className="wide">
                        <Link href={aflwPlayerPath(player.slug)}>{player.displayName}</Link>
                      </td>
                      <td className="wide">{player.clubNames ?? '—'}</td>
                      <td className="num nowrap">
                        {player.debutSeasonLabel === player.finalSeasonLabel
                          ? player.debutSeasonLabel
                          : `${player.debutSeasonLabel}–${player.finalSeasonLabel}`}
                      </td>
                      <td className="num">{formatNumber(player.games)}</td>
                      <td className="num">{formatNumber(player.goals)}</td>
                      <td className="num">{formatNumber(player.disposals)}</td>
                      <td className="num">{formatNumber(player.marks)}</td>
                      <td className="num">{formatNumber(player.tackles)}</td>
                      <td className="num">
                        {player.premierships > 0 ? player.premierships : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              basePath="/aflw/players"
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
