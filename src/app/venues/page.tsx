import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { getVenueStates, listVenues } from '@/db/queries/venues';
import { formatNumber, formatSpan, venuePath } from '@/lib/format';
import { venueFilterFields } from '@/search/list-filters';
import { describeFilters, optionsFrom, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Venues',
  description: 'Every ground to host a VFL/AFL match since 1897.',
  alternates: { canonical: '/venues' },
};

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const states = await getVenueStates();
  const fields = venueFilterFields(optionsFrom(states));
  const values = parseFilterValues(fields, params);

  const venues = await listVenues({
    q: values.text.q,
    state: values.select.state,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters action="/venues" fields={fields} values={values} />
  );

  return (
    <>
      <div className="page-header">
        <h1>Venues</h1>
        <p className="subtitle">
          {formatNumber(venues.length)} grounds have hosted VFL/AFL matches.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        title="Venues"
        note={`${formatNumber(venues.length)} matching`}
        filters={filters}
      >
        {venues.length === 0 ? (
          <div className="empty">
            <h2>No venues match those filters</h2>
            <p>Try widening the name, state or match count.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Venue</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col" className="num">Matches</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((venue) => (
                  <tr key={venue.id}>
                    <td className="wide">
                      <Link href={venuePath(venue.slug)}>{venue.canonicalName}</Link>
                    </td>
                    <td className="num nowrap">
                      {formatSpan(venue.firstSeason, venue.lastSeason)}
                    </td>
                    <td className="num">{formatNumber(venue.matches)}</td>
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
