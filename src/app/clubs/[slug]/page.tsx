import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { JsonLd } from '@/components/JsonLd';
import { ReorderableSections } from '@/components/ReorderableSections';
import { getClubBestAndFairest, getClubCaptains } from '@/db/queries/awards';
import {
  getClub,
  getClubEraTotals,
  getClubGoalkickers,
  getClubLeaders,
  getClubLineage,
  getClubRelations,
  getClubSeasons,
  getClubTotals,
  listClubs,
} from '@/db/queries/clubs';
import {
  awardPath,
  clubPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatSpan,
  isLinked,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { parseSlug } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { clubSchema } from '@/lib/structured-data';

export const revalidate = 86400;

/** Only 24 clubs: prerender them all. */
export async function generateStaticParams() {
  const clubs = await listClubs();
  return clubs.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  const club = parsed ? await getClub(parsed) : null;
  if (!club) return notFoundMetadata('Club');

  // A historical identity is described in its own terms — "Footscray, 1925 to
  // 1996" — rather than as the modern club under an old name. Collapsing the
  // two would be the keyword-consistency mistake §20 of the brief warns about,
  // and would also make two pages compete for one query.
  const era = club.firstSeason === null
    ? ''
    : ` (${formatSpan(club.firstSeason, club.lastSeason)})`;
  return pageMetadata({
    title: `${club.name} — Players, Seasons, Records & History`,
    description:
      `${club.name} in the VFL/AFL${era}: season-by-season results and ladder `
      + 'positions, premierships, games and goalkicking leaders, best-and-fairest '
      + 'winners and captains.',
    path: clubPath(club.slug),
  });
}

export default async function ClubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const club = await getClub(parsed);
  if (!club) notFound();

  // `parseSlug` lower-cases, so /clubs/Carlton found the club and then
  // rendered it at an address that is not the canonical one — a second live
  // URL for the same page, saved only by the canonical tag. One URL per
  // club instead, the same way a stale player slug is corrected.
  if (slug !== club.slug) permanentRedirect(clubPath(club.slug));

  // The club's record spans every name it has traded under; the season
  // table is scoped to the era on a historical identity's page, because
  // a page headed "Footscray" must not list 2016.
  const isContinuing = club.currentIdentityId === club.id;

  const [
    totals, eraTotals, seasons, leaders, goalkickers, lineage, relations,
    bestAndFairest, captains,
  ] = await Promise.all([
    getClubTotals(club.id),
    getClubEraTotals(club.id),
    getClubSeasons(club.id, isContinuing ? 'lineage' : 'era'),
    getClubLeaders(club.id),
    getClubGoalkickers(club.id),
    getClubLineage(club.id),
    getClubRelations(club.id),
    getClubBestAndFairest(club.id, 25),
    getClubCaptains(club.id),
  ]);

  const winRate = totals.played > 0
    ? ((totals.wins + totals.draws * 0.5) / totals.played) * 100
    : null;

  const otherEras = lineage.filter((l) => !l.isSelf);
  const hasLineage = otherEras.length > 0;
  // The whole club is named for its present identity, whichever era the
  // reader arrived at.
  const clubRecordName = club.currentIdentityName;

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'games-leaders',
    label: 'Games leaders',
    node: (
      <section className="section">
        <CollapsibleTable title="Games leaders">
        <div className="table-wrap">
          <table>
            <caption>
              Most games for {clubRecordName}
              {hasLineage && ', counting every era of the club'}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Seasons</th>
                <th scope="col" className="num">Games</th>
                <th scope="col" className="num">Goals</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((p, i) => (
                <tr key={p.id}>
                  <td className="num">{i + 1}</td>
                  <td className="wide"><Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link></td>
                  <td className="num nowrap">{formatSpan(p.firstSeason, p.lastSeason)}</td>
                  <td className="num">{formatNumber(p.games)}</td>
                  <td className="num">{formatNumber(p.goals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'goalkicking-leaders',
    label: 'Goalkicking leaders',
    node: (
      <section className="section">
        <CollapsibleTable title="Goalkicking leaders">
        <div className="table-wrap">
          <table>
            <caption>
              Most goals for {clubRecordName}
              {hasLineage && ', counting every era of the club'}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Seasons</th>
                <th scope="col" className="num">Goals</th>
                <th scope="col" className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {goalkickers.map((p, i) => (
                <tr key={p.id}>
                  <td className="num">{i + 1}</td>
                  <td className="wide"><Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link></td>
                  <td className="num nowrap">{formatSpan(p.firstSeason, p.lastSeason)}</td>
                  <td className="num">{formatNumber(p.goals)}</td>
                  <td className="num">{formatNumber(p.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  if (bestAndFairest.length > 0) {
    sections.push({
      id: 'best-and-fairest',
      label: 'Best and fairest',
      node: (
        <section className="section">
          <p className="section-note">
            {bestAndFairest[0].awardName}
            {hasLineage && ', across every era of the club'}. The source record begins in
            1980.{' '}
            <Link href={awardPath(bestAndFairest[0].awardSlug)}>Full history →</Link>
          </p>
          <CollapsibleTable title="Best and fairest">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Player</th>
                </tr>
              </thead>
              <tbody>
                {bestAndFairest.map((b) => (
                  <tr key={`${b.season}-${b.playerName}`}>
                    <td>{b.season ?? '—'}</td>
                    <td className="wide">
                      {b.playerId && isLinked(b.linkStatus) ? (
                        <Link href={playerPath(b.playerSlug!, b.playerId)}>{b.playerName}</Link>
                      ) : (
                        b.playerName
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (captains.length > 0) {
    sections.push({
      id: 'captains',
      label: 'Captains',
      node: (
        <section className="section">
          <p className="section-note">
            {formatNumber(captains.length)} recorded captaincy seasons
            {hasLineage && ', across every era of the club'}.
          </p>
          <CollapsibleTable title="Captains">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Captain</th>
                  {hasLineage && <th scope="col">Played as</th>}
                </tr>
              </thead>
              <tbody>
                {captains.map((c) => (
                  <tr key={`${c.season}-${c.playerName}`}>
                    <td>{c.season}</td>
                    <td className="wide">
                      {c.playerId && isLinked(c.linkStatus) ? (
                        <Link href={playerPath(c.playerSlug!, c.playerId)}>{c.playerName}</Link>
                      ) : (
                        c.playerName
                      )}
                    </td>
                    {hasLineage && <td className="muted nowrap">{c.identityName}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  sections.push({
    id: 'season-history',
    label: 'Season history',
    node: (
      <section className="section">
        {hasLineage && (
          <p className="section-note">
            {isContinuing ? (
              <>
                All {formatNumber(seasons.length)} seasons of the club, under every
                name it has played as.
              </>
            ) : (
              <>
                The {club.name} era only, {formatSpan(club.firstSeason, club.lastSeason, false)}.
                {' '}
                <Link href={clubPath(club.currentIdentitySlug)}>
                  All {formatNumber(totals.seasons)} seasons of the club →
                </Link>
              </>
            )}
          </p>
        )}
        <CollapsibleTable title="Season history">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                {hasLineage && isContinuing && <th scope="col">Played as</th>}
                <th scope="col" className="num">P</th>
                <th scope="col" className="num">W</th>
                <th scope="col" className="num">L</th>
                <th scope="col" className="num">D</th>
                <th scope="col" className="num">For</th>
                <th scope="col" className="num">Agst</th>
                <th scope="col" className="num">%</th>
                <th scope="col" className="num">Pos</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.season}>
                  <td><Link href={seasonPath(s.season)}>{s.season}</Link></td>
                  {hasLineage && isContinuing && (
                    <td className="nowrap">
                      {s.identitySlug === club.slug ? (
                        <span className="muted">{s.identityName}</span>
                      ) : (
                        <Link href={clubPath(s.identitySlug)}>{s.identityName}</Link>
                      )}
                    </td>
                  )}
                  <td className="num">{s.played}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.losses}</td>
                  <td className="num">{s.draws}</td>
                  <td className="num">{formatNumber(s.pointsFor)}</td>
                  <td className="num">{formatNumber(s.pointsAgainst)}</td>
                  <td className="num">{formatPercentage(s.percentage)}</td>
                  <td className="num">{s.ladderRank ?? '—'}</td>
                  <td>
                    {/* Honours are only shown once the season has been
                        decided. A club leading, or last, in an unfinished
                        season has a standing, not an honour. */}
                    {s.seasonStatus === 'in_progress' ? (
                      <span className="badge badge-warn" title={
                        s.dataThroughDate
                          ? `Provisional, as at ${formatDate(s.dataThroughDate)}`
                          : undefined
                      }>
                        In progress
                      </span>
                    ) : (
                      <>
                        {s.isPremier && <strong>Premiers</strong>}
                        {s.woodenSpoon && <span className="badge badge-warn">Wooden spoon</span>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Clubs', href: '/clubs' },
        { label: club.name },
      ]} />

      {/* The lineage becomes `alternateName`, which is the one point where
          AFLDB's identity model and Schema.org line up exactly: one team,
          several names, none of them rewritten into the others. */}
      <JsonLd data={clubSchema({
        name: club.name,
        path: clubPath(club.slug),
        description:
          `${club.name} VFL/AFL record: seasons, premierships, games and `
          + 'goalkicking leaders.',
        foundedSeason: club.firstSeason,
        dissolvedSeason: club.isCurrent ? null : club.lastSeason,
        alternateNames: otherEras.map((era) => era.name),
      })} />

      <div className="page-header">
        <h1>{club.name}</h1>
        <p className="subtitle">
          {formatSpan(club.firstSeason, club.lastSeason, club.isCurrent)}
          {club.homeState ? ` · ${club.homeState}` : ''}
          {!club.isCurrent && ` · ${club.succession}`}
        </p>
      </div>

      {club.notes && <p className="notice">{club.notes}</p>}

      {/* A rename does not start a new club, so the seasons either side of
          it are one continuous record and the totals below span all of
          them. Only the season table is scoped to a single era. */}
      {hasLineage && (
        <p className="notice">
          {club.name} is one era of a club that has also played as{' '}
          {otherEras.map((l, i, arr) => (
            <span key={l.id}>
              <Link href={clubPath(l.slug)}>{l.name}</Link>
              {' '}({formatSpan(l.firstSeason, l.lastSeason, false)})
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
          . A rename carries the club’s record forward, so the totals below are
          the whole {clubRecordName} record
          {isContinuing ? '' : (
            <>
              {' '}— of which the {club.name} era was{' '}
              {formatNumber(eraTotals.seasons)} seasons,{' '}
              {formatNumber(eraTotals.played)} matches and{' '}
              {formatNumber(eraTotals.premierships)}{' '}
              {eraTotals.premierships === 1 ? 'premiership' : 'premierships'}
            </>
          )}.
        </p>
      )}

      {/* Mergers link to a DIFFERENT club. Statistics are never combined
          across such a link: a merged club's record is its own. */}
      {relations.map((r) => (
        <p className="notice" key={`${r.relation}-${r.direction}-${r.slug ?? 'none'}`}>
          {r.relation === 'folded' ? (
            <>
              {club.name} left the competition after {(r.effectiveSeason ?? 1) - 1}.
            </>
          ) : r.direction === 'from' ? (
            <>
              {club.name} combined with another club to form{' '}
              <Link href={clubPath(r.slug!)}>{r.name}</Link> in {r.effectiveSeason}.
              The two clubs&rsquo; records are kept separate: nothing on this page is
              counted towards {r.name}.
            </>
          ) : (
            <>
              <Link href={clubPath(r.slug!)}>{r.name}</Link> combined into {club.name}{' '}
              in {r.effectiveSeason}. Its earlier seasons are recorded against{' '}
              {r.name}, not here.
            </>
          )}
        </p>
      ))}

      {hasLineage && (
        <h2 className="strip-heading">{clubRecordName} — whole club record</h2>
      )}

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(totals.seasons)}</div>
          <div className="label">Seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.played)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.wins)}</div>
          <div className="label">Wins</div>
        </div>
        <div className="stat">
          <div className="value">{winRate === null ? '—' : `${winRate.toFixed(1)}%`}</div>
          <div className="label">Win rate</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.premierships)}</div>
          <div className="label">Premierships</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(totals.woodenSpoons)}</div>
          <div className="label">Wooden spoons</div>
        </div>
      </div>

      <ReorderableSections storageKey={`/clubs/${club.slug}`} sections={sections} />
    </>
  );
}
