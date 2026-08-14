import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  getAward,
  getAwardSeason,
  getAwardSeasons,
  getNominationsBySeason,
} from '@/db/queries/awards';
import {
  awardPath,
  awardSeasonPath,
  clubPath,
  formatStat,
  isLinked,
  playerPath,
  seasonPath,
} from '@/lib/format';

export const revalidate = 86400;

const RISING_STAR = 'rising-star';

/** Statistics shown for a Rising Star nomination, in reading order. */
const STAT_ORDER: { key: string; label: string }[] = [
  { key: 'disposals', label: 'D' },
  { key: 'kicks', label: 'K' },
  { key: 'handballs', label: 'HB' },
  { key: 'marks', label: 'M' },
  { key: 'tackles', label: 'T' },
  { key: 'goals', label: 'G' },
  { key: 'behinds', label: 'B' },
  { key: 'hitouts', label: 'HO' },
];

function parseSeason(value: string): number | null {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1897 || year > 2100) return null;
  return year;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; season: string }>;
}): Promise<Metadata> {
  const { slug, season } = await params;
  const award = await getAward(slug);
  const year = parseSeason(season);
  if (!award || year === null) return { title: 'Not found' };

  return {
    title: `${year} ${award.name}`,
    description: `The ${year} ${award.name} in full.`,
    alternates: { canonical: awardSeasonPath(award.slug, year) },
  };
}

export default async function AwardSeasonPage({
  params,
}: {
  params: Promise<{ slug: string; season: string }>;
}) {
  const { slug, season } = await params;
  const year = parseSeason(season);
  if (year === null) notFound();

  const award = await getAward(slug);
  if (!award) notFound();

  const isRisingStar = award.slug === RISING_STAR;

  const [members, nominations, allSeasons] = await Promise.all([
    getAwardSeason(award.id, year),
    isRisingStar ? getNominationsBySeason(award.id, year) : Promise.resolve([]),
    getAwardSeasons(award.id),
  ]);

  if (members.length === 0 && nominations.length === 0) notFound();

  const seasonIndex = allSeasons.indexOf(year);
  const newer = seasonIndex > 0 ? allSeasons[seasonIndex - 1] : null;
  const older = seasonIndex >= 0 && seasonIndex < allSeasons.length - 1
    ? allSeasons[seasonIndex + 1]
    : null;

  // Only show a statistic column when at least one nomination recorded it:
  // tackles were not collected in 1993, and an empty column would read as
  // a row of zeroes.
  const shownStats = STAT_ORDER.filter((s) =>
    nominations.some((n) => n.statLine?.[s.key] !== undefined));

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/awards">Awards</Link>
        <span aria-hidden="true">/</span>
        <Link href={awardPath(award.slug)}>{award.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{year}</span>
      </nav>

      <div className="page-header">
        <h1>{year} {award.name}</h1>
        <p className="subtitle">
          <Link href={seasonPath(year)}>The {year} season</Link>
        </p>
      </div>

      <nav className="pagination" aria-label="Seasons">
        {older
          ? <Link href={awardSeasonPath(award.slug, older)}>← {older}</Link>
          : <span className="muted">←</span>}
        <Link href={awardPath(award.slug)}>All seasons</Link>
        {newer
          ? <Link href={awardSeasonPath(award.slug, newer)}>{newer} →</Link>
          : <span className="muted">→</span>}
      </nav>

      {members.length > 0 && (
        <section className="section">
          <h2>{award.category === 'honour_team' ? 'The team' : 'Winner'}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {members.some((m) => m.position) && <th scope="col">Position</th>}
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  {members.some((m) => m.note) && <th scope="col">Note</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    {members.some((x) => x.position) && (
                      <td className="nowrap">{m.position ?? <span className="muted">—</span>}</td>
                    )}
                    <td className="wide">
                      {m.playerId && isLinked(m.linkStatus) ? (
                        <Link href={playerPath(m.playerSlug!, m.playerId)}>{m.playerName}</Link>
                      ) : (
                        <span title="Not linked to an AFLDB player">{m.playerName}</span>
                      )}
                      {m.isCaptain && <strong> (c)</strong>}
                      {m.isViceCaptain && <span> (vc)</span>}
                    </td>
                    <td>
                      {m.clubSlug
                        ? <Link href={clubPath(m.clubSlug)}>{m.clubName}</Link>
                        : <span className="muted">{m.clubNameRaw ?? '—'}</span>}
                    </td>
                    {members.some((x) => x.note) && (
                      <td className="wide muted">{m.note ?? ''}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {nominations.length > 0 && (
        <section className="section">
          <h2>Round-by-round nominations</h2>
          <p className="section-note">
            The nominee’s figures are from the match that earned the nomination. A dash
            means the statistic was not collected that season, not that none was recorded.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="num">Rd</th>
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  <th scope="col">Opponent</th>
                  {shownStats.map((s) => (
                    <th scope="col" className="num" key={s.key}>{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nominations.map((n) => (
                  <tr key={n.id}>
                    <td className="num">{n.roundNumber ?? '—'}</td>
                    <td className="wide">
                      {n.playerId && isLinked(n.linkStatus) ? (
                        <Link href={playerPath(n.playerSlug!, n.playerId)}>{n.playerName}</Link>
                      ) : (
                        n.playerName
                      )}
                      {n.isWinner && <strong> — winner</strong>}
                      {n.isIneligible && (
                        <span
                          className="badge badge-warn"
                          title={n.ineligibleReason ?? undefined}
                        >
                          Ineligible
                        </span>
                      )}
                    </td>
                    <td>
                      {n.clubSlug
                        ? <Link href={clubPath(n.clubSlug)}>{n.clubName}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {n.opponentSlug
                        ? <Link href={clubPath(n.opponentSlug)}>{n.opponentName}</Link>
                        : <span className="muted">—</span>}
                    </td>
                    {shownStats.map((s) => (
                      <td className="num" key={s.key}>
                        {formatStat(n.statLine?.[s.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
