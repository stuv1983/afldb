import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  getClub,
  getClubGoalkickers,
  getClubLeaders,
  getClubLineage,
  getClubRelations,
  getClubSeasons,
  getClubTotals,
  listClubs,
} from '@/db/queries/clubs';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatSpan,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { parseSlug } from '@/lib/params';

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
  if (!club) return { title: 'Club not found' };

  return {
    title: `${club.name} — History and Statistics`,
    description:
      `${club.name} VFL/AFL history: season-by-season results, ladder positions, `
      + `premierships, games and goalkicking leaders.`,
    alternates: { canonical: clubPath(club.slug) },
  };
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

  const [totals, seasons, leaders, goalkickers, lineage, relations] = await Promise.all([
    getClubTotals(club.id),
    getClubSeasons(club.id),
    getClubLeaders(club.id),
    getClubGoalkickers(club.id),
    getClubLineage(club.id),
    getClubRelations(club.id),
  ]);

  const winRate = totals.played > 0
    ? ((totals.wins + totals.draws * 0.5) / totals.played) * 100
    : null;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/clubs">Clubs</Link>
        <span aria-hidden="true">/</span>
        <span>{club.name}</span>
      </nav>

      <div className="page-header">
        <h1>{club.name}</h1>
        <p className="subtitle">
          {formatSpan(club.firstSeason, club.lastSeason, club.isCurrent)}
          {club.homeState ? ` · ${club.homeState}` : ''}
          {!club.isCurrent && ` · ${club.succession}`}
        </p>
      </div>

      {club.notes && <p className="notice">{club.notes}</p>}

      {/* Renames within the same club: the seasons are continuous and
          belong to one record, so the other eras are offered as
          navigation rather than merged into these totals. */}
      {lineage.length > 1 && (
        <p className="notice">
          {club.name} is one era of a club that has also played as{' '}
          {lineage.filter((l) => !l.isSelf).map((l, i, arr) => (
            <span key={l.id}>
              <Link href={clubPath(l.slug)}>{l.name}</Link>
              {' '}({formatSpan(l.firstSeason, l.lastSeason, false)})
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
          . The figures on this page cover only the {club.name} era.
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

      <section className="section">
        <h2>Games leaders</h2>
        <div className="table-wrap">
          <table>
            <caption>Most games for {club.name}</caption>
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
      </section>

      <section className="section">
        <h2>Goalkicking leaders</h2>
        <div className="table-wrap">
          <table>
            <caption>Most goals for {club.name}</caption>
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
      </section>

      <section className="section">
        <h2>Season history</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
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
      </section>
    </>
  );
}
