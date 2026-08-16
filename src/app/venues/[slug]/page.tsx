import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { sql } from '@/db/client';
import {
  clubPath,
  formatAttendance,
  formatDate,
  formatNumber,
  formatSpan,
  matchPath,
  venuePath,
} from '@/lib/format';
import { parseSlug } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

/** Only 52 venues: prerender them all. */
export async function generateStaticParams() {
  const rows = await sql<{ slug: string }[]>`SELECT slug FROM venues`;
  return rows.map((v) => ({ slug: v.slug }));
}

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
    title: `${venue.canonicalName} — AFL/VFL Matches & Venue Record`,
    description:
      `Every VFL/AFL match played at ${venue.canonicalName}`
      + (venue.legacyName && venue.legacyName !== venue.canonicalName
        ? ` (also known as ${venue.legacyName})`
        : '')
      + ', with the clubs that played there and the seasons it was used.',
    path: venuePath(venue.slug),
  });
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

  const [[totals], recent] = await Promise.all([
    sql<{ matches: number; avgAttendance: number | null; maxAttendance: number | null }[]>`
      SELECT count(*)::int AS matches,
             round(avg(attendance))::int AS "avgAttendance",
             max(attendance)::int AS "maxAttendance"
        FROM matches WHERE venue_id = ${venue.id}
    `,
    sql<{
      id: number; season: number; matchDate: Date;
      homeName: string; homeSlug: string; awayName: string; awaySlug: string;
      homeScore: number; awayScore: number; attendance: number | null;
    }[]>`
      SELECT m.id, m.season, m.match_date AS "matchDate",
             h.name AS "homeName", h.slug AS "homeSlug",
             a.name AS "awayName", a.slug AS "awaySlug",
             m.home_score AS "homeScore", m.away_score AS "awayScore",
             m.attendance
        FROM matches m
        JOIN clubs h ON h.id = m.home_club_id
        JOIN clubs a ON a.id = m.away_club_id
       WHERE m.venue_id = ${venue.id}
       ORDER BY m.match_date DESC
       LIMIT 50
    `,
  ]);

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
          <div className="value">{formatNumber(totals.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatAttendance(totals.avgAttendance)}</div>
          <div className="label">Average crowd</div>
        </div>
        <div className="stat">
          <div className="value">{formatAttendance(totals.maxAttendance)}</div>
          <div className="label">Record crowd</div>
        </div>
      </div>

      <section className="section">
        <CollapsibleTable title="Recent matches">
        <div className="table-wrap">
          <table>
            <caption>Most recent {recent.length} matches at this venue</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Home</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Away</th>
                <th scope="col" className="num">Crowd</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">
                    <Link href={matchPath(m.id)}>{formatDate(m.matchDate)}</Link>
                  </td>
                  <td className="wide"><Link href={clubPath(m.homeSlug)}>{m.homeName}</Link></td>
                  <td className="num nowrap">{m.homeScore}–{m.awayScore}</td>
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
