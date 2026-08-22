import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { getVenueStates, listVenues } from '@/db/queries/venues';
import { formatNumber, formatSpan, venuePath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { venueFilterFields } from '@/search/list-filters';
import { describeFilters, optionsFrom, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Venues — Every Ground Since 1897',
  description:
    'Every ground to host a VFL/AFL match since 1897, with the matches played '
    + 'at each and the seasons it was used.',
  path: '/venues',
});

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
    <TableFilters action="/venues" anchor="venues" fields={fields} values={values} />
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
        id="venues"
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
              <SortableTable
                defaultSort="matches"
                defaultDir="desc"
                columns={[
                  { key: 'name', label: 'Venue', sortType: 'text' },
                  { key: 'seasons', label: 'Seasons', sortType: 'number', className: 'num' },
                  { key: 'matches', label: 'Matches', sortType: 'number', className: 'num' },
                ]}
                items={venues.map((venue) => ({
                  id: venue.id,
                  values: {
                    name: venue.canonicalName,
                    seasons: venue.firstSeason,
                    matches: venue.matches,
                  },
                  element: (
                    <tr key={venue.id}>
                      <td className="wide">
                        <Link href={venuePath(venue.slug)}>{venue.canonicalName}</Link>
                      </td>
                      <td className="num nowrap">
                        {formatSpan(venue.firstSeason, venue.lastSeason)}
                      </td>
                      <td className="num">{formatNumber(venue.matches)}</td>
                    </tr>
                  ),
                }))}
              />
            </div>
        )}
      </CollapsibleTable>
    </>
  );
}
