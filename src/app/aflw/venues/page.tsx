import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { TableFilters } from '@/components/TableFilters';
import { listAflwVenues } from '@/db/queries/aflw';
import { formatNumber, formatSpanLabel } from '@/lib/format';
import { aflwVenueFilterFields } from '@/search/aflw-filters';
import { describeFilters, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFLW Venues',
  description: 'Every ground to host an AFLW match since 2017.',
  alternates: { canonical: '/aflw/venues' },
};

export default async function AflwVenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const fields = aflwVenueFilterFields();
  const values = parseFilterValues(fields, params);

  const venues = await listAflwVenues({ q: values.text.q, ranges: values });
  const described = describeFilters(fields, values);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <span>Venues</span>
      </nav>

      <div className="page-header">
        <h1>AFLW Venues</h1>
        <p className="subtitle">
          {venues.length} grounds have hosted AFLW matches
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        title="Venues"
        note={`${venues.length} matching`}
        filters={<TableFilters action="/aflw/venues" fields={fields} values={values} />}
      >
        {venues.length === 0 ? (
          <div className="empty">
            <h2>No venues match those filters</h2>
            <p>Try widening the name or the match count.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>
                Venue names are the free-text strings the AFLW source publishes. They
                have not been reconciled with the AFL venue records, so a ground that
                hosts both competitions appears in each under its own name.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Venue</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col" className="num">Matches</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((venue) => (
                  <tr key={venue.slug}>
                    <td className="wide">
                      <Link
                        href={`/aflw/match-search?venue=${encodeURIComponent(venue.slug)}`}
                      >
                        {venue.name}
                      </Link>
                    </td>
                    <td className="num nowrap">
                      {formatSpanLabel(venue.firstSeasonLabel, venue.lastSeasonLabel)}
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
