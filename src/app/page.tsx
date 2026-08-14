import Link from 'next/link';

import { SearchBox } from '@/components/SearchBox';
import { sql } from '@/db/client';
import { getRecentMatches } from '@/db/queries/matches';
import { RECORD_CATEGORIES, getCareerRecord } from '@/db/queries/records';
import {
  formatDate, formatNumber, formatRoundShort, matchPath, playerPath, seasonPath,
} from '@/lib/format';

// Historical data changes only when an import runs.
export const revalidate = 3600;

async function getOverview() {
  const [row] = await sql<{
    players: number; matches: number; playerGames: number;
    clubs: number; venues: number; seasons: number;
    firstSeason: number; lastSeason: number;
  }[]>`
    SELECT (SELECT count(*) FROM players)::int             AS players,
           (SELECT count(*) FROM matches)::int             AS matches,
           (SELECT count(*) FROM player_match_stats)::int  AS "playerGames",
           (SELECT count(*) FROM clubs)::int               AS clubs,
           (SELECT count(*) FROM venues)::int              AS venues,
           (SELECT count(*) FROM seasons)::int             AS seasons,
           (SELECT min(year) FROM seasons)::int            AS "firstSeason",
           (SELECT max(year) FROM seasons)::int            AS "lastSeason"
  `;
  return row;
}

const GOAL_RECORD = RECORD_CATEGORIES['most-goals'];

export default async function HomePage() {
  const [overview, recent, goalKings] = await Promise.all([
    getOverview(),
    getRecentMatches(6),
    getCareerRecord('most-goals', 5),
  ]);

  // Bars are drawn against the leader, so the top row always reads full.
  const topGoals = goalKings[0]?.value ?? 0;

  return (
    <>
      <div className="almanac-hero">
        <h1>Every player. Every game. Since {overview.firstSeason}.</h1>
        <p className="tagline">
          One line of enquiry for {overview.seasons} seasons of the VFL and AFL.
          Type a name, a club, a venue or a season.
        </p>

        <div className="hero-search">
          <SearchBox autoFocus placeholder="Search a player, club, venue or season…" />

          <div className="try-chips">
            <span className="try-label">Try</span>
            <Link className="chip" href="/search?q=Michael+Tuck">Michael Tuck</Link>
            <Link className="chip" href={seasonPath(1989)}>The 1989 season</Link>
            <Link className="chip" href="/records/most-goals">Most career goals</Link>
            <Link className="chip" href="/records/most-disposals-in-a-game">
              Most disposals in a match
            </Link>
          </div>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(overview.players)}</div>
          <div className="label">Players</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.seasons)}</div>
          <div className="label">Seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.playerGames)}</div>
          <div className="label">Player games</div>
        </div>
      </div>

      <div className="split">
        <section>
          <div className="split-head">
            <h2>Latest matches</h2>
            <Link className="more" href={seasonPath(overview.lastSeason)}>
              All {overview.lastSeason} →
            </Link>
          </div>

          {recent.map((m) => (
            <div className="ledger-row" key={m.id}>
              <Link className="fixture" href={matchPath(m.id)}>
                {m.homeName} v {m.awayName}
              </Link>
              <span className="figures">
                <span className="score">{m.homeScore}–{m.awayScore}</span>
                <span className="when">
                  {formatRoundShort(m.roundType, m.roundNumber)} · {formatDate(m.matchDate)}
                </span>
              </span>
            </div>
          ))}
        </section>

        <section>
          <div className="split-head">
            <h2>Record of the week</h2>
            <Link className="more" href="/records/most-goals">All →</Link>
          </div>
          <p className="lede">Most career goals, all seasons</p>

          {goalKings.map((p) => (
            <div className="meter" key={p.playerId}>
              <div className="meter-head">
                <Link href={playerPath(p.slug, p.playerId)}>{p.displayName}</Link>
                <span className="meter-value">{formatNumber(p.value)}</span>
              </div>
              <div className="meter-track">
                <div
                  className="meter-fill"
                  style={{ width: topGoals > 0 ? `${(p.value / topGoals) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ))}

          {GOAL_RECORD.coverage && <p className="footnote">{GOAL_RECORD.coverage}</p>}
        </section>
      </div>

      <section className="section">
        <h2>Browse the record</h2>
        <nav className="grid" aria-label="Browse">
          {[
            { href: '/players', title: 'Players', meta: `Every player since ${overview.firstSeason}` },
            { href: '/clubs', title: 'Clubs', meta: 'Current and historical clubs' },
            { href: '/seasons', title: 'Seasons', meta: 'Ladders, results and finals' },
            { href: '/records', title: 'Records', meta: 'Career, season and single-game' },
            { href: '/brownlow', title: 'Brownlow', meta: 'Vote counts by season' },
            { href: '/advanced-search', title: 'Player Search', meta: 'Filter by career statistics' },
            { href: '/match-search', title: 'Match Search', meta: 'Find games by scoreline and margin' },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="card">
              <h3>{item.title}</h3>
              <div className="meta">{item.meta}</div>
            </Link>
          ))}
        </nav>
      </section>
    </>
  );
}
