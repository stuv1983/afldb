import Link from 'next/link';
import { Fragment } from 'react';

import { SearchBox } from '@/components/SearchBox';
import { sql } from '@/db/client';
import { getVaultMeetings } from '@/db/queries/matches';
import { RECORD_CATEGORIES, getCareerRecord } from '@/db/queries/records';
import { getSiteSettings } from '@/db/queries/site-settings';
import {
  formatDate, formatNumber, formatRoundShort, matchPath, playerPath, seasonPath,
} from '@/lib/format';
import {
  homeSection, homeSectionRows, visibleHomeSections, type HomeSectionId,
} from '@/lib/site-settings';

// Historical data changes only when an import runs. The one exception is
// "From the vault", which is deliberately random: this window is also how
// often it deals a different set of old meetings.
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

export default async function HomePage() {
  const settings = await getSiteSettings();
  const visible = visibleHomeSections(settings.homeLayout);
  const record = RECORD_CATEGORIES[settings.homeRecord];

  // Only the sections actually being rendered are queried: hiding a panel in
  // /admin/settings should cost the front page a round trip, not just a
  // <section>.
  const [overview, vault, leaders] = await Promise.all([
    getOverview(),
    visible.includes('vault') ? getVaultMeetings(6) : Promise.resolve([]),
    visible.includes('record')
      ? getCareerRecord(settings.homeRecord, 5)
      : Promise.resolve([]),
  ]);

  // Bars are drawn against the leader, so the top row always reads full.
  const top = leaders[0]?.value ?? 0;

  const sections: Record<HomeSectionId, React.ReactNode> = {
    stats: (
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
    ),

    vault: (
      <section>
        <div className="split-head">
          <h2>From the vault</h2>
          <Link className="more" href={seasonPath(overview.lastSeason)}>
            All {overview.lastSeason} →
          </Link>
        </div>
        <p className="lede">
          The clubs that met in the most recent round, each shown one earlier
          meeting drawn at random from the {overview.seasons} seasons behind it.
        </p>

        {vault.length === 0 ? (
          <p className="muted">No earlier meetings to draw from.</p>
        ) : vault.map((m) => (
          <div className="ledger-row" key={m.latestId}>
            <span>
              <Link className="fixture" href={matchPath(m.id)}>
                {m.homeName} v {m.awayName}
              </Link>
              <span className="ledger-note">
                {formatNumber(m.meetings)} meetings · last met {m.latestSeason}
              </span>
            </span>
            <span className="figures">
              <span className="score">{m.homeScore}–{m.awayScore}</span>
              <span className="when">
                {formatRoundShort(m.roundType, m.roundNumber)} · {formatDate(m.matchDate)}
              </span>
            </span>
          </div>
        ))}
      </section>
    ),

    record: (
      <section>
        <div className="split-head">
          <h2>Record of the week</h2>
          <Link className="more" href={`/records/${record.slug}`}>All →</Link>
        </div>
        <p className="lede">{record.definition}</p>

        {leaders.map((p) => (
          <div className="meter" key={p.playerId}>
            <div className="meter-head">
              <Link href={playerPath(p.slug, p.playerId)}>{p.displayName}</Link>
              <span className="meter-value">{formatNumber(p.value)}</span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{ width: top > 0 ? `${(p.value / top) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}

        {record.coverage && <p className="footnote">{record.coverage}</p>}
      </section>
    ),

    browse: (
      <section className="section">
        <h2>Browse the record</h2>
        <nav className="grid" aria-label="Browse">
          {[
            { href: '/players', title: 'Players', meta: 'Every player since 1897, filtered by career statistics' },
            { href: '/clubs', title: 'Clubs', meta: 'Current and historical clubs' },
            { href: '/seasons', title: 'Seasons', meta: 'Ladders, results and finals' },
            { href: '/records', title: 'Records', meta: 'Career, season and single-game' },
            { href: '/brownlow', title: 'Brownlow', meta: 'Vote counts by season' },
            { href: '/awards', title: 'Awards', meta: 'All-Australian, Rising Star, Hall of Fame' },
            { href: '/draft', title: 'Draft', meta: 'Every selection, by year and club' },
            { href: '/match-search', title: 'Match Search', meta: 'Find games by scoreline and margin' },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="card">
              <h3>{item.title}</h3>
              <div className="meta">{item.meta}</div>
            </Link>
          ))}
        </nav>
      </section>
    ),
  };

  return (
    <>
      <div className="almanac-hero">
        <h1>Every player. Every game. Since {overview.firstSeason}.</h1>
        <p className="tagline">
          One line of enquiry for {overview.seasons} seasons of the VFL and AFL.
          Type a name, a club, a ground, a season, a round or an award.
        </p>

        <div className="hero-search">
          <SearchBox
            autoFocus
            placeholder="Try “Ablett”, “round 5 1989”, “rising star” or “most goals”…"
          />

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

      {/* Order and visibility are the super admin's (see /admin/settings);
          the two narrow panels share one ruled row when they are adjacent. */}
      {homeSectionRows(visible).map((row) => {
        if (row.length > 1) {
          return (
            <div className="split" key={row.join()}>
              {row.map((id) => <div key={id}>{sections[id]}</div>)}
            </div>
          );
        }
        // A panel on its own has no .split to give it room, so it takes the
        // ordinary section spacing instead; stats and browse bring their own.
        const [id] = row;
        return homeSection(id)?.panel
          ? <div className="section" key={id}>{sections[id]}</div>
          : <Fragment key={id}>{sections[id]}</Fragment>;
      })}
    </>
  );
}
