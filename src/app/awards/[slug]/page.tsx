import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  getAward,
  getAwardLeaders,
  getAwardWinners,
  getNominationSeasons,
  getNominationsByClub,
  listAwards,
} from '@/db/queries/awards';
import {
  awardPath,
  awardSeasonPath,
  clubPath,
  formatNumber,
  formatSpan,
  isLinked,
  playerPath,
  seasonPath,
} from '@/lib/format';

export const revalidate = 86400;

const RISING_STAR = 'rising-star';
const ALL_AUSTRALIAN = 'all-australian';

export async function generateStaticParams() {
  const awards = await listAwards();
  return awards.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const award = await getAward(slug);
  if (!award) return { title: 'Award not found' };

  return {
    title: `${award.name} — Winners and History`,
    description:
      award.description
      ?? `Every ${award.name} winner, ${formatSpan(award.firstSeason, award.lastSeason)}.`,
    alternates: { canonical: awardPath(award.slug) },
  };
}

export default async function AwardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const award = await getAward(slug);
  if (!award) notFound();

  const isRisingStar = award.slug === RISING_STAR;
  const isTeam = award.category === 'honour_team';

  const [winners, leaders, nominationSeasons, nominationClubs] = await Promise.all([
    getAwardWinners(award.id),
    getAwardLeaders(award.id),
    isRisingStar ? getNominationSeasons(award.id) : Promise.resolve([]),
    isRisingStar ? getNominationsByClub(award.id) : Promise.resolve([]),
  ]);

  // A representative team has twenty-odd names a season; listing them all
  // on one page would bury the seasons. Seasons index them instead.
  const seasonsOfTeam = isTeam
    ? [...new Set(winners.map((w) => w.season).filter((s): s is number => s !== null))]
      .sort((a, b) => b - a)
    : [];

  const unlinked = winners.filter((w) => !isLinked(w.linkStatus)).length;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/awards">Awards</Link>
        <span aria-hidden="true">/</span>
        <span>{award.name}</span>
      </nav>

      <div className="page-header">
        <h1>{award.name}</h1>
        <p className="subtitle">
          {award.clubSlug && (
            <>
              <Link href={clubPath(award.clubSlug)}>{award.clubName}</Link>
              {' · '}
            </>
          )}
          {award.competition ? `${award.competition} · ` : ''}
          {formatSpan(award.firstSeason, award.lastSeason)}
        </p>
      </div>

      {award.description && <p className="notice">{award.description}</p>}

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(award.seasonCount)}</div>
          <div className="label">Seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(award.winnerCount)}</div>
          <div className="label">{isTeam ? 'Selections' : 'Winners'}</div>
        </div>
        {isRisingStar && (
          <div className="stat">
            <div className="value">
              {formatNumber(nominationSeasons.reduce((n, s) => n + s.nominations, 0))}
            </div>
            <div className="label">Nominations</div>
          </div>
        )}
        {unlinked > 0 && (
          <div className="stat">
            <div className="value">{formatNumber(unlinked)}</div>
            <div className="label">Unlinked names</div>
          </div>
        )}
      </div>

      {unlinked > 0 && (
        <p className="notice">
          {formatNumber(unlinked)} of these {formatNumber(award.winnerCount)} entries name
          a player AFLDB could not identify with confidence — most often a state-league
          footballer with no VFL/AFL record. They are listed as the source spelled them,
          without a link.
        </p>
      )}

      {isRisingStar && (
        <section className="section">
          <p className="section-note">
            One player is nominated each round. Every nomination since 1993 is recorded,
            with the match statistics that earned it.
          </p>
          <CollapsibleTable title="Nominations by season">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">Nominations</th>
                  <th scope="col">Winner</th>
                </tr>
              </thead>
              <tbody>
                {nominationSeasons.map((s) => (
                  <tr key={s.season}>
                    <td>
                      <Link href={awardSeasonPath(award.slug, s.season)}>{s.season}</Link>
                    </td>
                    <td className="num">{s.nominations}</td>
                    <td className="wide">{s.winner ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {isTeam && (
        <section className="section">
          <CollapsibleTable title="Teams by season">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">Selected</th>
                  <th scope="col">Captain</th>
                </tr>
              </thead>
              <tbody>
                {seasonsOfTeam.map((season) => {
                  const members = winners.filter((w) => w.season === season);
                  const captain = members.find((m) => m.isCaptain);
                  return (
                    <tr key={season}>
                      <td>
                        <Link href={awardSeasonPath(award.slug, season)}>{season}</Link>
                      </td>
                      <td className="num">{members.length}</td>
                      <td className="wide">
                        {captain
                          ? captain.playerId && isLinked(captain.linkStatus)
                            ? (
                              <Link href={playerPath(captain.playerSlug!, captain.playerId)}>
                                {captain.playerName}
                              </Link>
                            )
                            : captain.playerName
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {leaders.length > 0 && (
        <section className="section">
          <CollapsibleTable title="Multiple winners">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Wins</th>
                  <th scope="col">Seasons</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.playerId}>
                    <td className="wide">
                      <Link href={playerPath(l.slug, l.playerId)}>{l.displayName}</Link>
                    </td>
                    <td className="num">{l.wins}</td>
                    <td className="wide muted">{l.seasons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {isRisingStar && nominationClubs.length > 0 && (
        <section className="section">
          <p className="section-note">
            Counted by club as a continuing entity, so Footscray and Western Bulldogs
            nominations are one club’s.
          </p>
          <CollapsibleTable title="Nominations by club">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Nominations</th>
                  <th scope="col" className="num">Winners</th>
                </tr>
              </thead>
              <tbody>
                {nominationClubs.map((c) => (
                  <tr key={c.clubId}>
                    <td className="wide"><Link href={clubPath(c.slug)}>{c.name}</Link></td>
                    <td className="num">{c.nominations}</td>
                    <td className="num">{c.winners}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {!isTeam && (
        <section className="section">
          <CollapsibleTable title="Every winner">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  {winners.some((w) => w.votes !== null) && (
                    <th scope="col" className="num">Votes</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {winners.map((w) => (
                  <tr key={w.id}>
                    <td>
                      {w.season
                        ? <Link href={seasonPath(w.season)}>{w.season}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="wide">
                      {w.playerId && isLinked(w.linkStatus) ? (
                        <Link href={playerPath(w.playerSlug!, w.playerId)}>
                          {w.playerName}
                        </Link>
                      ) : (
                        <span title="Not linked to an AFLDB player">{w.playerName}</span>
                      )}
                    </td>
                    <td>
                      {w.clubSlug
                        ? <Link href={clubPath(w.clubSlug)}>{w.clubName}</Link>
                        : <span className="muted">{w.clubNameRaw ?? '—'}</span>}
                    </td>
                    {winners.some((x) => x.votes !== null) && (
                      <td className="num">{w.votes ?? <span className="muted">—</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}
    </>
  );
}
