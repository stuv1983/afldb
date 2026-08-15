import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getSeasonLeagues, listSeasons } from '@/db/queries/seasons';
import { clubPath, formatNumber, seasonPath } from '@/lib/format';
import { clubOptions, seasonFilterFields } from '@/search/list-filters';
import { describeFilters, optionsFrom, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seasons',
  description: 'Every VFL/AFL season from 1897, with premiers, match counts and ladders.',
  alternates: { canonical: '/seasons' },
};

export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [leagues, clubs] = await Promise.all([getSeasonLeagues(), getClubOptions()]);
  const fields = seasonFilterFields({
    leagues: optionsFrom(leagues),
    premiers: clubOptions(clubs),
  });
  const values = parseFilterValues(fields, params);

  const seasons = await listSeasons({
    league: values.select.league,
    status: values.select.status,
    premier: values.select.premier,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  const filters = <TableFilters action="/seasons" fields={fields} values={values} />;

  return (
    <>
      <div className="page-header">
        <h1>Seasons</h1>
        <p className="subtitle">
          {formatNumber(seasons.length)} seasons from 1897.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      {values.errors.length > 0 && (
        <div className="notice filter-errors" role="alert">
          {values.errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      <CollapsibleTable
        title="Seasons"
        note={`${formatNumber(seasons.length)} matching`}
        filters={filters}
      >
        {seasons.length === 0 ? (
          <div className="empty">
            <h2>No seasons match those filters</h2>
            <p>Try widening the season range or clearing the premier.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">League</th>
                  <th scope="col">Premier</th>
                  <th scope="col" className="num">Matches</th>
                  <th scope="col" className="num">Clubs</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={s.year}>
                    <td><Link href={seasonPath(s.year)}>{s.year}</Link></td>
                    <td>{s.league}</td>
                    <td className="wide">
                      {s.premierSlug ? (
                        <Link href={clubPath(s.premierSlug)}>{s.premierName}</Link>
                      ) : (
                        <span className="not-recorded">—</span>
                      )}
                    </td>
                    <td className="num">{formatNumber(s.matchCount)}</td>
                    <td className="num">{formatNumber(s.clubCount)}</td>
                    <td>
                      {s.isComplete
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
