import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { listAflwClubs, listAflwSeasons } from '@/db/queries/aflw';
import { aflwClubPath, formatNumber, formatPercentage } from '@/lib/format';
import { aflwClubFilterFields } from '@/search/aflw-filters';
import { describeFilters, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLW Clubs',
  description:
    'Every AFLW club with its full record: matches, wins, finals and premierships '
    + 'since the competition began in 2017.',
  alternates: { canonical: '/aflw/clubs' },
};

export default async function AflwClubsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const fields = aflwClubFilterFields();
  const values = parseFilterValues(fields, params);

  const [clubs, seasons] = await Promise.all([
    listAflwClubs({ q: values.text.q, ranges: values }),
    listAflwSeasons(),
  ]);
  const byOrdinal = new Map(seasons.map((season) => [season.ordinal, season.displayLabel]));
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters action="/aflw/clubs" anchor="club-records" fields={fields} values={values} />
  );

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <span>Clubs</span>
      </nav>

      <div className="page-header">
        <h1>AFLW Clubs</h1>
        <p className="subtitle">
          {clubs.length} clubs
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        id="club-records"
        title="Club records"
        note={`${clubs.length} matching`}
        filters={filters}
      >
        {clubs.length === 0 ? (
          <div className="empty">
            <h2>No clubs match those filters</h2>
            <p>Try widening a range or clearing the name.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>
                Club names are the current ones. The source applies them to every
                season it publishes, so a 2017 match already reads Kuwarna rather
                than Adelaide; no AFLW rename history exists in this data.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col" className="num">Played</th>
                  <th scope="col" className="num">W–D–L</th>
                  <th scope="col" className="num">Win %</th>
                  <th scope="col" className="num">Finals</th>
                  <th scope="col" className="num">Prem</th>
                  <th scope="col" className="num">For</th>
                  <th scope="col" className="num">Against</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((club) => (
                  <tr key={club.code}>
                    <td className="wide">
                      <Link href={aflwClubPath(club.code)}>{club.name}</Link>
                      <div className="muted" style={{ fontSize: '0.72rem' }}>
                        {byOrdinal.get(club.firstSeasonOrdinal)}
                        {club.firstSeasonOrdinal !== club.lastSeasonOrdinal
                          && `–${byOrdinal.get(club.lastSeasonOrdinal)}`}
                      </div>
                    </td>
                    <td className="num">{club.seasonsContested}</td>
                    <td className="num">{formatNumber(club.matches)}</td>
                    <td className="num nowrap">
                      {club.wins}–{club.draws}–{club.losses}
                    </td>
                    <td className="num">
                      {club.matches > 0
                        ? formatPercentage((club.wins / club.matches) * 100)
                        : '—'}
                    </td>
                    <td className="num">{formatNumber(club.finals)}</td>
                    <td className="num">
                      {club.premierships > 0 ? <strong>{club.premierships}</strong> : '—'}
                    </td>
                    <td className="num">{formatNumber(club.pointsFor)}</td>
                    <td className="num">{formatNumber(club.pointsAgainst)}</td>
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
