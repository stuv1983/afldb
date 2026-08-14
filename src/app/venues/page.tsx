import type { Metadata } from 'next';
import Link from 'next/link';

import { sql } from '@/db/client';
import { formatNumber, formatSpan, venuePath } from '@/lib/format';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Venues',
  description: 'Every ground to host a VFL/AFL match since 1897.',
  alternates: { canonical: '/venues' },
};

export default async function VenuesPage() {
  const venues = await sql<{
    id: number; slug: string; canonicalName: string;
    firstSeason: number | null; lastSeason: number | null; matches: number;
  }[]>`
    SELECT v.id, v.slug, v.canonical_name AS "canonicalName",
           v.first_season AS "firstSeason", v.last_season AS "lastSeason",
           count(m.id)::int AS matches
      FROM venues v
      LEFT JOIN matches m ON m.venue_id = v.id
     GROUP BY v.id
     ORDER BY count(m.id) DESC, v.canonical_name
  `;

  return (
    <>
      <div className="page-header">
        <h1>Venues</h1>
        <p className="subtitle">{venues.length} grounds have hosted VFL/AFL matches.</p>
      </div>

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
    </>
  );
}
