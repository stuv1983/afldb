import Link from 'next/link';

import { SearchBox } from '@/components/SearchBox';
import { sql } from '@/db/client';
import { getRecentMatches } from '@/db/queries/matches';
import { formatDate, formatRoundShort, matchPath, seasonPath } from '@/lib/format';

// Historical data changes only when an import runs.
export const revalidate = 3600;

async function getOverview() {
  const [row] = await sql<{
    players: number; matches: number; playerGames: number;
    clubs: number; venues: number; firstSeason: number; lastSeason: number;
  }[]>`
    SELECT (SELECT count(*) FROM players)::int             AS players,
           (SELECT count(*) FROM matches)::int             AS matches,
           (SELECT count(*) FROM player_match_stats)::int  AS "playerGames",
           (SELECT count(*) FROM clubs)::int               AS clubs,
           (SELECT count(*) FROM venues)::int              AS venues,
           (SELECT min(year) FROM seasons)::int            AS "firstSeason",
           (SELECT max(year) FROM seasons)::int            AS "lastSeason"
  `;
  return row;
}

export default async function HomePage() {
  const [overview, recent] = await Promise.all([getOverview(), getRecentMatches(8)]);

  return (
    <>
      <div className="search-hero">
        <h1>AFLDB</h1>
        <p className="tagline">
          Australian Football Statistics Database · {overview.firstSeason}–{overview.lastSeason}
        </p>
        <SearchBox autoFocus placeholder="Search AFL history…" />
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{overview.players.toLocaleString('en-AU')}</div>
          <div className="label">Players</div>
        </div>
        <div className="stat">
          <div className="value">{overview.matches.toLocaleString('en-AU')}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{overview.playerGames.toLocaleString('en-AU')}</div>
          <div className="label">Player games</div>
        </div>
        <div className="stat">
          <div className="value">{overview.clubs}</div>
          <div className="label">Clubs</div>
        </div>
        <div className="stat">
          <div className="value">{overview.venues}</div>
          <div className="label">Venues</div>
        </div>
      </div>

      <nav className="grid" aria-label="Browse">
        {[
          { href: '/players', title: 'Players', meta: 'Every player since 1897' },
          { href: '/clubs', title: 'Clubs', meta: 'Current and historical clubs' },
          { href: '/seasons', title: 'Seasons', meta: 'Ladders, results and finals' },
          { href: '/records', title: 'Records', meta: 'Career, season and single-game' },
          { href: '/brownlow', title: 'Brownlow', meta: 'Vote counts by season' },
          { href: '/advanced-search', title: 'Advanced Search', meta: 'Filter by career statistics' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="card">
            <h3>{item.title}</h3>
            <div className="meta">{item.meta}</div>
          </Link>
        ))}
      </nav>

      <section className="section">
        <h2>Latest matches</h2>
        <div className="table-wrap">
          <table>
            <caption>Most recent matches in the database</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Round</th>
                <th scope="col">Match</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Venue</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td><Link href={matchPath(m.id)}>{formatDate(m.matchDate)}</Link></td>
                  <td>
                    <Link href={seasonPath(m.season)}>{m.season}</Link>{' '}
                    {formatRoundShort(m.roundType, m.roundNumber)}
                  </td>
                  <td className="wide">{m.homeName} v {m.awayName}</td>
                  <td className="num">{m.homeScore}–{m.awayScore}</td>
                  <td>{m.venueName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
