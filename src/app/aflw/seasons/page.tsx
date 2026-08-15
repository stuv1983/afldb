import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { getAflwClubOptions, listAflwSeasons } from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwSeasonPath,
  formatDate,
  formatNumber,
} from '@/lib/format';
import { aflwSeasonFilterFields } from '@/search/aflw-filters';
import { describeFilters, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLW Seasons',
  description:
    'Every AFLW season from 2017, with premiers, ladders, match counts and the two '
    + 'seasons played in calendar 2022.',
  alternates: { canonical: '/aflw/seasons' },
};

export default async function AflwSeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clubs = await getAflwClubOptions();
  const fields = aflwSeasonFilterFields(clubs);
  const values = parseFilterValues(fields, params);

  const seasons = await listAflwSeasons({
    status: values.select.status,
    premier: values.select.premier,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  const filters = <TableFilters action="/aflw/seasons" fields={fields} values={values} />;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <span>Seasons</span>
      </nav>

      <div className="page-header">
        <h1>AFLW Seasons</h1>
        <p className="subtitle">
          {seasons.length} seasons from 2017
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        title="Seasons"
        note={`${seasons.length} matching`}
        filters={filters}
      >
        {seasons.length === 0 ? (
          <div className="empty">
            <h2>No seasons match those filters</h2>
            <p>Try widening the year range or clearing the premier.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>
                Season Six and Season Seven were both played in 2022, so the calendar
                year does not identify a season. 2020 was abandoned at the semi-finals
                and awarded no premiership.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Played</th>
                  <th scope="col">Premier</th>
                  <th scope="col" className="num">Matches</th>
                  <th scope="col" className="num">Clubs</th>
                  <th scope="col" className="num">Players</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.seasonKey}>
                    <td>
                      <Link href={aflwSeasonPath(season.seasonKey)}>
                        {season.displayLabel}
                      </Link>
                    </td>
                    <td className="num">{season.ordinal}</td>
                    <td className="nowrap muted">
                      {formatDate(season.firstFixtureDate)} – {formatDate(season.lastFixtureDate)}
                    </td>
                    <td className="wide">
                      {season.premierCode ? (
                        <Link href={aflwClubPath(season.premierCode)}>
                          {season.premierName}
                        </Link>
                      ) : (
                        <span className="not-recorded">
                          {season.hasGrandFinal ? '—' : 'No premiership awarded'}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {formatNumber(season.playedCount)}
                      {season.playedCount !== season.fixtureCount && (
                        <span className="muted"> / {season.fixtureCount}</span>
                      )}
                    </td>
                    <td className="num">{formatNumber(season.clubCount)}</td>
                    <td className="num">{formatNumber(season.playerCount)}</td>
                    <td>
                      {season.status === 'complete'
                        ? <span className="muted">Complete</span>
                        : <span className="badge badge-warn">In progress</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>
    </>
  );
}
