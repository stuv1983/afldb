import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { getVenueStates, listVenues } from '@/db/queries/venues';
import { formatNumber, formatSpan, venuePath } from '@/lib/format';
import { firstValue, parseSearchTerm } from '@/lib/params';

export const revalidate = 86400;

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
  const q = parseSearchTerm(firstValue(params.q));
  const state = firstValue(params.state) || undefined;

  const [venues, states] = await Promise.all([
    listVenues({ q, state }),
    getVenueStates(),
  ]);

  return (
    <>
      <div className="page-header">
        <h1>Venues</h1>
        <p className="subtitle">{venues.length} grounds have hosted VFL/AFL matches.</p>
      </div>

      <form method="get" action="/venues">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          <div>
            <label htmlFor="q">Name</label>
            <input id="q" name="q" type="search" placeholder="Search by name" defaultValue={q ?? ''} />
          </div>
          <div>
            <label htmlFor="state">State</label>
            <select id="state" name="state" defaultValue={state ?? ''}>
              <option value="">Any state</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="submit">Filter</button>
          <Link className="btn btn-secondary" href="/venues">Reset</Link>
        </div>
      </form>

      {venues.length === 0 ? (
        <div className="empty">
          <h2>No venues match those filters</h2>
          <p>Try widening the name or state.</p>
        </div>
      ) : (
        <CollapsibleTable title="Venues">
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
        </CollapsibleTable>
      )}
    </>
  );
}
