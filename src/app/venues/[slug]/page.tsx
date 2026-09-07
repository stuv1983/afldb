import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { VenueClubRecords } from '@/components/VenueClubRecords';
import { VenuePlayerLeaders } from '@/components/VenuePlayerLeaders';
import { VenueRecords } from '@/components/VenueRecords';
import { sql } from '@/db/client';
import {
  getVenueClubRecords,
  getVenueMatches,
  getVenueOverview,
  getVenuePlayerLeaders,
  getVenueRecords,
  type VenueMatchBrief,
} from '@/db/queries/venues';
import {
  clubPath,
  formatAttendance,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatSpan,
  matchPath,
  venuePath,
} from '@/lib/format';
import { parseSlug } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

/** Only ~52 venues: prerender them all. */
export async function generateStaticParams() {
  const rows = await sql<{ slug: string }[]>`SELECT slug FROM venues`;
  return rows.map((v) => ({ slug: v.slug }));
}

/** How many recent matches the venue page previews before linking on to the full log. */
const PREVIEW_MATCHES = 10;

async function getVenue(slug: string) {
  const [row] = await sql<{
    id: number; slug: string; canonicalName: string; legacyName: string | null;
    firstSeason: number | null; lastSeason: number | null;
  }[]>`
    SELECT id, slug, canonical_name AS "canonicalName", legacy_name AS "legacyName",
           first_season AS "firstSeason", last_season AS "lastSeason"
      FROM venues WHERE slug = ${slug}
  `;
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  const venue = parsed ? await getVenue(parsed) : null;
  if (!venue) return notFoundMetadata('Venue');
  return pageMetadata({
    title: `${venue.canonicalName} — AFL/VFL Venue Record`,
    description:
      `Every VFL/AFL match at ${venue.canonicalName}`
      + (venue.legacyName && venue.legacyName !== venue.canonicalName
        ? ` (also known as ${venue.legacyName})`
        : '')
      + ': the clubs that played there and their records, the ground records, '
      + 'the leading players and the complete match history.',
    path: venuePath(venue.slug),
  });
}

/** One linked line for the first / most recent match in the overview. */
function OverviewMatchRow({
  label,
  match,
}: {
  label: string;
  match: VenueMatchBrief | null;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {match ? (
        <>
          <td className="nowrap">
            <Link href={matchPath(match.id)}>{formatDate(match.matchDate)}</Link>
          </td>
          <td className="nowrap">
            {match.season} {formatRoundShort(match.roundType, match.roundNumber)}
          </td>
          <td className="wide"><Link href={clubPath(match.homeSlug)}>{match.homeName}</Link></td>
          <td className="num nowrap">{match.homeScore}&ndash;{match.awayScore}</td>
          <td className="wide"><Link href={clubPath(match.awaySlug)}>{match.awayName}</Link></td>
          <td className="num">{formatAttendance(match.attendance)}</td>
        </>
      ) : (
        <td colSpan={5} className="muted">Not recorded</td>
      )}
    </tr>
  );
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const venue = await getVenue(parsed);
  if (!venue) notFound();

  // See the club route: `parseSlug` lower-cases, so a mixed-case address
  // resolved and then rendered at a second, non-canonical URL.
  if (slug !== venue.slug) permanentRedirect(venuePath(venue.slug));

  const [overview, clubRecords, records, leaders, preview] = await Promise.all([
    getVenueOverview(venue.id),
    getVenueClubRecords(venue.id),
    getVenueRecords(venue.id),
    getVenuePlayerLeaders(venue.id),
    getVenueMatches(venue.id, { limit: PREVIEW_MATCHES, offset: 0 }),
  ]);

  const matchesPath = `${venuePath(venue.slug)}/matches`;

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Venues', href: '/venues' },
        { label: venue.canonicalName },
      ]} />

      <div className="page-header">
        <h1>{venue.canonicalName}</h1>
        <p className="subtitle">
          {formatSpan(venue.firstSeason, venue.lastSeason)}
          {venue.legacyName && venue.legacyName !== venue.canonicalName && (
            <> · also recorded as “{venue.legacyName}”</>
          )}
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(overview.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatAttendance(overview.avgAttendance)}</div>
          <div className="label">Average crowd</div>
        </div>
        <div className="stat">
          <div className="value">
            {formatAttendance(records.highestAttendance?.attendance ?? null)}
          </div>
          <div className="label">Record crowd</div>
        </div>
      </div>

      {(overview.firstMatch || overview.latestMatch) && (
        <section className="section">
          {overview.matchesWithAttendance < overview.matches && (
            <p className="section-note">
              {formatNumber(overview.matches - overview.matchesWithAttendance)} of{' '}
              {formatNumber(overview.matches)} matches have no recorded attendance.
            </p>
          )}
          <CollapsibleTable title="First & most recent match">
            <div className="table-wrap">
              <table>
                <caption>First and most recent recorded match at {venue.canonicalName}</caption>
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col" className="nowrap">Date</th>
                    <th scope="col" className="nowrap">Rd</th>
                    <th scope="col">Home</th>
                    <th scope="col" className="num nowrap">Score</th>
                    <th scope="col">Away</th>
                    <th scope="col" className="num">Crowd</th>
                  </tr>
                </thead>
                <tbody>
                  <OverviewMatchRow label="First match" match={overview.firstMatch} />
                  <OverviewMatchRow label="Most recent" match={overview.latestMatch} />
                </tbody>
              </table>
            </div>
          </CollapsibleTable>
        </section>
      )}

      <VenueRecords records={records} venueName={venue.canonicalName} />

      <VenueClubRecords clubs={clubRecords} venueName={venue.canonicalName} />

      <VenuePlayerLeaders leaders={leaders} venueName={venue.canonicalName} />

      <section className="section">
        <p className="section-note">
          The {Math.min(PREVIEW_MATCHES, preview.total)} most recent matches at this
          venue.{' '}
          {preview.total > PREVIEW_MATCHES && (
            <Link href={matchesPath}>
              Complete match history ({formatNumber(preview.total)}) →
            </Link>
          )}
        </p>
        <CollapsibleTable title="Recent matches">
          <div className="table-wrap">
            <table>
              <caption>Most recent {preview.rows.length} matches at {venue.canonicalName}</caption>
              <thead>
                <tr>
                  <th scope="col" className="nowrap">Date</th>
                  <th scope="col" className="nowrap">Rd</th>
                  <th scope="col">Home</th>
                  <th scope="col" className="num nowrap">Score</th>
                  <th scope="col">Away</th>
                  <th scope="col" className="num">Crowd</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">
                      <Link href={matchPath(m.id)}>{formatDate(m.matchDate)}</Link>
                    </td>
                    <td className="nowrap">
                      {m.season} {formatRoundShort(m.roundType, m.roundNumber)}
                    </td>
                    <td className="wide"><Link href={clubPath(m.homeSlug)}>{m.homeName}</Link></td>
                    <td className="num nowrap">{m.homeScore}&ndash;{m.awayScore}</td>
                    <td className="wide"><Link href={clubPath(m.awaySlug)}>{m.awayName}</Link></td>
                    <td className="num">{formatAttendance(m.attendance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      </section>
    </>
  );
}
