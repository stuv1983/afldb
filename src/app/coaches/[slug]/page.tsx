import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CoachCareerBody, CoachOpponentRecordBody } from '@/components/CoachCareerRecord';
import { CoachOpponentSelector } from '@/components/CoachOpponentSelector';
import { JsonLd } from '@/components/JsonLd';
import { getComparisonOrganizations, type ComparisonOrganization } from '@/db/queries/club-comparison';
import type { CoachCareer } from '@/db/queries/coaches';
import { getCoach, getCoachCareer } from '@/db/queries/coaches';
import {
  clubPath,
  coachPath,
  formatNumber,
  formatPercentage,
  formatSpan,
  parseEntitySlug,
  playerPath,
} from '@/lib/format';
import { coachComparePath } from '@/lib/coach-comparison-url';
import { resolveCoachOpponentSelection, type CoachOpponentSelection } from '@/lib/coach-opponent-history';
import { firstValue } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { coachSlug } from '@/lib/slugs';
import { coachSchema } from '@/lib/structured-data';

/**
 * THE coach-centric profile for every coach (AFLDB-ISSUE-170 Stage 1E).
 *
 * Route context decides presentation, not identity. A person who both
 * played and coached has two legitimate pages: `/players/[slug]` leads with
 * the playing career and carries coaching lower down, and this route leads
 * with the coaching record and links out to the playing career. Stage 1E
 * removed the permanent redirect that used to send a player-linked coach to
 * their player page, which made "select a coach from /coaches" silently
 * deliver a player profile — the acceptance defect. Neither page is a
 * redirect alias of the other; each is canonical to itself.
 *
 * Stage 1D added a shareable `?opponent=` selection, which needs
 * `searchParams` — trading this route's previous ISR (`revalidate = 3600`
 * + `generateStaticParams`) for full server rendering, the same trade-off
 * `/clubs/compare` already makes. Even after Stage 1E widened the route to
 * all 386 coaches it remains a small, low-traffic set, so the trade still
 * costs nothing meaningful.
 *
 * `/players/[slug]` cannot make the same trade — it is static ISR for
 * ~13,000 players — so the player-linked coaching surface resolves the
 * identical selection client-side instead. See
 * `CoachOpponentHistoryClient` for the full reasoning.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  if (!parsed) return notFoundMetadata('Coach');

  const coach = await getCoach(parsed.id);
  if (!coach) return notFoundMetadata('Coach');

  const career = await getCoachCareer(coach.id);
  if (!career) return notFoundMetadata('Coach');

  // An opponent selection is a filtered view of the same canonical page
  // (the `/clubs/compare` convention for a non-landing query state), so
  // it is never offered to an index in place of the canonical record.
  const opponent = firstValue((await searchParams).opponent);

  return pageMetadata({
    title: `${coach.displayName} — VFL/AFL Coaching Record`,
    description: coachDescription(coach.displayName, career),
    path: coachPath(coachSlug(coach.displayName), coach.id),
    ogType: 'profile',
    noindex: Boolean(opponent),
  });
}

export default async function CoachPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  if (!parsed) notFound();

  const coach = await getCoach(parsed.id);
  if (!coach) notFound();

  const canonicalSlug = coachSlug(coach.displayName);
  if (parsed.slug !== canonicalSlug) {
    permanentRedirect(coachPath(canonicalSlug, coach.id));
  }

  const career = await getCoachCareer(coach.id);
  if (!career) notFound();

  const opponent = firstValue((await searchParams).opponent);

  // The opponent selector/record only makes sense once there is a real
  // canonical coaching record to scope (Stage 1A's zero-game convention);
  // for a zero-game coach neither query is worth running.
  let organizations: ComparisonOrganization[] = [];
  let selection: CoachOpponentSelection = { kind: 'none' };
  if (career.totals.games > 0) {
    [organizations, selection] = await Promise.all([
      getComparisonOrganizations(),
      resolveCoachOpponentSelection(coach.id, opponent),
    ]);
  }

  const { totals } = career;
  const path = coachPath(canonicalSlug, coach.id);

  // A coach who also played: their player page is a different presentation
  // of the same person, not a canonical replacement for this one, so it is
  // offered as a secondary link rather than imposed as a redirect.
  const playingCareerPath = coach.playerId !== null && coach.playerSlug !== null
    ? playerPath(coach.playerSlug, coach.playerId)
    : null;

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
        // Two pages, one human: `sameAs` is what tells a consumer that this
        // Person and the player page's Person are the same individual seen
        // in two contexts, rather than two people who share a name.
        sameAsPath: playingCareerPath,
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
        {/* The primary action on a COACH page compares coaches, with this
            coach already chosen. The player page keeps its own "Compare with
            another player" — each route offers the comparison that belongs
            to the career it is presenting. */}
        <p className="section-note">
          <Link href={coachComparePath({ a: coach.id })}>Compare with another coach →</Link>
          {playingCareerPath && (
            <>
              {' · '}
              <Link href={playingCareerPath}>View playing career →</Link>
            </>
          )}
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(totals.games)}</div>
          <div className="label">Games</div>
        </div>
        <div className="stat">
          <div className="value nowrap">{totals.wins}–{totals.losses}–{totals.draws}</div>
          <div className="label">W–L–D</div>
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
        <CoachCareerBody career={career} linkClubs />
      </section>

      {career.totals.games > 0 && (
        <section className="section">
          <h2>History against club</h2>
          <CoachOpponentSelector organizations={organizations} selected={opponent} basePath={path} />

          {selection.kind === 'invalid' && (
            <p className="muted">{selection.requested} is not a club on record.</p>
          )}
          {selection.kind === 'resolved' && (
            <CoachOpponentRecordBody record={selection.record} showCoachedClub={career.clubs.length > 1} />
          )}
        </section>
      )}
    </>
  );
}
