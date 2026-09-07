import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Pagination } from '@/components/Pagination';
import { VenueMatchHistory } from '@/components/VenueMatchHistory';
import { sql } from '@/db/client';
import { getVenueMatches } from '@/db/queries/venues';
import { formatNumber, venuePath } from '@/lib/format';
import { firstValue, parsePage, parseSlug } from '@/lib/params';
import { isFilteredView, notFoundMetadata, pageMetadata } from '@/lib/seo';

// Paging lives on this child route rather than the venue page so the
// venue page itself stays free of searchParams and can be served from
// the full route cache. Same split as /players/[slug]/matches.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

async function getVenue(slug: string) {
  const [row] = await sql<{
    id: number; slug: string; canonicalName: string;
  }[]>`
    SELECT id, slug, canonical_name AS "canonicalName"
      FROM venues WHERE slug = ${slug}
  `;
  return row ?? null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  const venue = parsed ? await getVenue(parsed) : null;
  if (!venue) return notFoundMetadata('Venue');

  return pageMetadata({
    title: `${venue.canonicalName} — Complete Match History`,
    description:
      `Every VFL/AFL match played at ${venue.canonicalName}, newest first, `
      + 'with the clubs, the score and the crowd.',
    path: `${venuePath(venue.slug)}/matches`,
    // Every page but the first is a slice of the same list, and the
    // canonical already points all of them at page one. See /players.
    noindex: isFilteredView(await searchParams),
  });
}

export default async function VenueMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const venue = await getVenue(parsed);
  if (!venue) notFound();

  if (slug !== venue.slug) permanentRedirect(`${venuePath(venue.slug)}/matches`);

  const page = parsePage(firstValue(query.page));
  const { rows, total } = await getVenueMatches(venue.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const venuePagePath = venuePath(venue.slug);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Venues', href: '/venues' },
        { label: venue.canonicalName, href: venuePagePath },
        { label: 'Match history' },
      ]} />

      <div className="page-header">
        <h1>{venue.canonicalName} — Match History</h1>
        <p className="subtitle">{formatNumber(total)} matches</p>
      </div>

      {total === 0 ? (
        <div className="empty">
          <h2>No matches found</h2>
          <p><Link href={venuePagePath}>Back to {venue.canonicalName}</Link></p>
        </div>
      ) : (
        <>
          <VenueMatchHistory
            matches={rows}
            venueName={venue.canonicalName}
            from={from}
            to={to}
            total={total}
          />
          <Pagination
            basePath={`${venuePagePath}/matches`}
            params={{}}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
