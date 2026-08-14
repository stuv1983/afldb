import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSeasonMatches } from '@/db/queries/matches';
import {
  getSeason,
  getSeasonBounds,
  getSeasonBrownlow,
  getSeasonGoalkickers,
  getSeasonLadder,
  listSeasons,
} from '@/db/queries/seasons';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatRound,
  matchPath,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { parseSeason } from '@/lib/params';

export const revalidate = 3600;

/**
 * Prerender every season. There are only ~130, and they are the pages
 * most likely to be linked to. Without this the route is rendered on
 * demand and not stored in the full route cache, which under load costs
 * roughly a second per request.
 */
export async function generateStaticParams() {
  const seasons = await listSeasons();
  return seasons.map((s) => ({ year: String(s.year) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  const parsed = parseSeason(year);
  const season = parsed ? await getSeason(parsed) : null;
  if (!season) return { title: 'Season not found' };

  return {
    title: `${season.year} ${season.league} Season`,
    description:
      `${season.year} ${season.league} season: final ladder, all ${season.matchCount ?? ''} `
      + `matches, leading goalkickers and Brownlow Medal votes.`,
    alternates: { canonical: seasonPath(season.year) },
  };
}

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const parsed = parseSeason(year);
  if (!parsed) notFound();

  const season = await getSeason(parsed);
  if (!season) notFound();

  const [ladder, matches, goalkickers, brownlow, bounds] = await Promise.all([
    getSeasonLadder(parsed),
    getSeasonMatches(parsed),
    getSeasonGoalkickers(parsed),
    getSeasonBrownlow(parsed),
    getSeasonBounds(),
  ]);

  const prev = parsed > bounds.min ? parsed - 1 : null;
  const next = parsed < bounds.max ? parsed + 1 : null;

  // Group matches by round, preserving chronological order.
  const rounds = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = formatRound(match.roundType, match.roundNumber);
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key)!.push(match);
  }

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/seasons">Seasons</Link>
        <span aria-hidden="true">/</span>
        <span>{season.year}</span>
      </nav>

      <div className="page-header">
        <h1>{season.year} {season.league} Season</h1>
        <p className="subtitle">
          {formatNumber(season.matchCount)} matches · {season.clubCount} clubs
          {season.premierName && (
            <> · Premiers: <Link href={clubPath(season.premierSlug!)}>{season.premierName}</Link></>
          )}
        </p>
      </div>

      {season.status === 'in_progress' && (
        <p className="notice">
          <strong>Season in progress.</strong>{' '}
          Every figure on this page is provisional and current only as at{' '}
          {formatDate(season.dataThroughDate)}
          {season.lastLoadedRound && <> (round {season.lastLoadedRound})</>}.
          No premier, wooden spoon or Brownlow Medal has been decided.
        </p>
      )}

      <nav className="pagination" aria-label="Season navigation">
        {prev
          ? <Link className="btn btn-secondary" href={seasonPath(prev)} rel="prev">← {prev}</Link>
          : <span />}
        <span className="spacer" />
        {next
          ? <Link className="btn btn-secondary" href={seasonPath(next)} rel="next">{next} →</Link>
          : <span />}
      </nav>

      <section className="section">
        <h2>Ladder</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">Pos</th>
                <th scope="col">Club</th>
                <th scope="col" className="num">P</th>
                <th scope="col" className="num">W</th>
                <th scope="col" className="num">L</th>
                <th scope="col" className="num">D</th>
                <th scope="col" className="num">For</th>
                <th scope="col" className="num">Agst</th>
                <th scope="col" className="num">%</th>
                <th scope="col" className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((row) => (
                <tr key={row.clubId}>
                  <td className="num">{row.ladderRank ?? '—'}</td>
                  <td className="wide">
                    <Link href={clubPath(row.clubSlug)}>{row.clubName}</Link>
                    {row.isPremier && <span className="badge" style={{ marginLeft: '0.35rem' }}>Premiers</span>}
                  </td>
                  <td className="num">{row.played}</td>
                  <td className="num">{row.wins}</td>
                  <td className="num">{row.losses}</td>
                  <td className="num">{row.draws}</td>
                  <td className="num">{formatNumber(row.pointsFor)}</td>
                  <td className="num">{formatNumber(row.pointsAgainst)}</td>
                  <td className="num">{formatPercentage(row.percentage)}</td>
                  <td className="num">{formatNumber(row.premiershipPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <section className="section">
          <h2>Leading goalkickers</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Goals</th>
                </tr>
              </thead>
              <tbody>
                {goalkickers.map((p) => (
                  <tr key={`${p.id}-${p.clubSlug}`}>
                    <td className="wide"><Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link></td>
                    <td><Link href={clubPath(p.clubSlug)}>{p.clubName}</Link></td>
                    <td className="num">{formatNumber(p.goals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <h2>Brownlow Medal</h2>
          {brownlow.length === 0 ? (
            <p className="muted">
              No Brownlow votes recorded for {season.year}
              {season.year < 1924 ? ' — the medal was first awarded in 1924.' : '.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col" className="num">Votes</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {brownlow.map((p) => (
                    <tr key={p.id}>
                      <td className="wide"><Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link></td>
                      <td className="num">{p.votes}</td>
                      <td>
                        {p.isWinner && <strong>Winner</strong>}
                        {p.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="section">
        <h2>Matches</h2>
        {[...rounds.entries()].map(([roundName, roundMatches]) => (
          <div
            key={roundName}
            // Anchor target for /seasons/1989#round-5 links from search.
            id={roundName.toLowerCase().replace(/\s+/g, '-')}
            style={{ marginBottom: '1.25rem', scrollMarginTop: '4rem' }}
          >
            <h3 style={{ marginBottom: '0.4rem' }}>{roundName}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Home</th>
                    <th scope="col" className="num">Score</th>
                    <th scope="col">Away</th>
                    <th scope="col">Venue</th>
                    <th scope="col" className="num">Crowd</th>
                  </tr>
                </thead>
                <tbody>
                  {roundMatches.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap"><Link href={matchPath(m.id)}>{formatDate(m.matchDate)}</Link></td>
                      <td className="wide"><Link href={clubPath(m.homeSlug)}>{m.homeName}</Link></td>
                      <td className="num nowrap">{m.homeScore}–{m.awayScore}</td>
                      <td className="wide"><Link href={clubPath(m.awaySlug)}>{m.awayName}</Link></td>
                      <td>{m.venueName}</td>
                      <td className="num">
                        {m.attendance === null
                          ? <span className="not-recorded">—</span>
                          : formatNumber(m.attendance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
