import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { SortableTable } from '@/components/SortableTable';
import type { CoachCareer } from '@/db/queries/coaches';
import { getCoach, getCoachCareer, listCoaches } from '@/db/queries/coaches';
import {
  clubPath,
  coachPath,
  formatNumber,
  formatPercentage,
  formatSpan,
  parseEntitySlug,
  playerPath,
} from '@/lib/format';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { coachSlug } from '@/lib/slugs';
import { coachSchema } from '@/lib/structured-data';

// Coaching careers are historical and change only when an import runs, same
// as the player profile this route mirrors.
export const revalidate = 3600;

/** Coach-only people are a small set (a few hundred at most): prerender them all. */
export async function generateStaticParams() {
  const coaches = await listCoaches();
  return coaches
    .filter((c) => c.playerId === null)
    .map((c) => ({ slug: `${coachSlug(c.displayName)}-${c.id}` }));
}

function coachDescription(name: string, career: CoachCareer): string {
  if (career.totals.games === 0) {
    return `${name} is a listed VFL/AFL coach with no coaching games recorded yet.`;
  }
  const span = formatSpan(career.clubs[0]?.firstSeason ?? null, career.clubs.at(-1)?.lastSeason ?? null);
  const clause = career.totals.premierships > 0
    ? `, winning ${career.totals.premierships} `
      + `${career.totals.premierships === 1 ? 'premiership' : 'premierships'}`
    : '';
  return (
    `${name} coached ${formatNumber(career.totals.games)} VFL/AFL games (${span})${clause}. `
    + 'Full coaching record and club-by-club breakdown.'
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  if (!parsed) return notFoundMetadata('Coach');

  const coach = await getCoach(parsed.id);
  if (!coach) return notFoundMetadata('Coach');

  const career = await getCoachCareer(coach.id);
  if (!career) return notFoundMetadata('Coach');

  return pageMetadata({
    title: `${coach.displayName} — VFL/AFL Coaching Record`,
    description: coachDescription(coach.displayName, career),
    path: coachPath(coachSlug(coach.displayName), coach.id),
    ogType: 'profile',
  });
}

export default async function CoachPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  if (!parsed) notFound();

  const coach = await getCoach(parsed.id);
  if (!coach) notFound();

  // A coach who also played gets no separate coach-only profile: their
  // canonical page is their player page, which already carries their
  // coaching record via PlayerCoachingCareer.
  if (coach.playerId !== null) {
    if (coach.playerSlug === null) notFound();
    permanentRedirect(playerPath(coach.playerSlug, coach.playerId));
  }

  const canonicalSlug = coachSlug(coach.displayName);
  if (parsed.slug !== canonicalSlug) {
    permanentRedirect(coachPath(canonicalSlug, coach.id));
  }

  const career = await getCoachCareer(coach.id);
  if (!career) notFound();

  const { totals } = career;
  const path = coachPath(canonicalSlug, coach.id);

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Coaches', href: '/coaches' },
        { label: coach.displayName },
      ]} />

      <JsonLd data={coachSchema({
        name: coach.displayName,
        path,
        description: coachDescription(coach.displayName, career),
        dob: coach.dob,
        clubs: career.clubs.map((c) => ({ name: c.clubName, slug: c.clubSlug })),
      })} />

      <div className="page-header">
        <h1>{coach.displayName}</h1>
        <p className="subtitle">
          {career.clubs.map((c, i) => (
            <span key={c.clubId}>
              {i > 0 && ' · '}
              <Link href={clubPath(c.clubSlug)}>{c.clubName}</Link>
            </span>
          ))}
          {career.clubs.length > 0 && ' · '}
          {formatSpan(career.clubs[0]?.firstSeason ?? null, career.clubs.at(-1)?.lastSeason ?? null)}
        </p>
        <p className="lede">{coachDescription(coach.displayName, career)}</p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(totals.games)}</div>
          <div className="label">Games</div>
        </div>
        <div className="stat">
          <div className="value">{formatPercentage(totals.winPct)}</div>
          <div className="label">Win %</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.finals)}</div>
          <div className="label">Finals</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.grandFinals)}</div>
          <div className="label">Grand Finals</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.premierships)}</div>
          <div className="label">Premierships</div>
        </div>
      </div>

      <section className="section">
        <h2>Coaching record</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Games</th>
                <td className="num">{formatNumber(totals.games)}</td>
                <th scope="row">Win %</th>
                <td className="num">{formatPercentage(totals.winPct)}</td>
              </tr>
              <tr>
                <th scope="row">Record</th>
                <td className="num nowrap">{totals.wins}W – {totals.losses}L – {totals.draws}D</td>
                <th scope="row">Finals</th>
                <td className="num">{formatNumber(totals.finals)}</td>
              </tr>
              <tr>
                <th scope="row">Grand Finals</th>
                <td className="num">{formatNumber(totals.grandFinals)}</td>
                <th scope="row">Premierships</th>
                <td className="num">{formatNumber(totals.premierships)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {career.clubs.length > 0 && (
          <div className="table-wrap">
            <SortableTable
              defaultSort="firstSeason"
              defaultDir="asc"
              columns={[
                { key: 'club', label: 'Club', sortType: 'text' },
                { key: 'firstSeason', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
                { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
                { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
                { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
                { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
                { key: 'premierships', label: 'Prem', sortType: 'number', className: 'num' },
              ]}
              items={career.clubs.map((c) => ({
                id: String(c.clubId),
                values: {
                  club: c.clubName,
                  firstSeason: c.firstSeason,
                  games: c.games,
                  wld: c.wins,
                  winPct: c.winPct ?? -1,
                  finals: c.finals,
                  grandFinals: c.grandFinals,
                  premierships: c.premierships,
                },
                element: (
                  <tr key={c.clubId}>
                    <td><Link href={clubPath(c.clubSlug)}>{c.clubName}</Link></td>
                    <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
                    <td className="num">{formatNumber(c.games)}</td>
                    <td className="num nowrap">{c.wins}–{c.losses}–{c.draws}</td>
                    <td className="num">{formatPercentage(c.winPct)}</td>
                    <td className="num">{formatNumber(c.finals)}</td>
                    <td className="num">{formatNumber(c.grandFinals)}</td>
                    <td className="num">{formatNumber(c.premierships)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        )}
      </section>
    </>
  );
}
