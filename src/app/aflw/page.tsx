import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';

import { SearchBox } from '@/components/SearchBox';
import {
  getAflwLeaders,
  getAflwOverview,
  getAflwVaultMeetings,
  listAflwSeasons,
} from '@/db/queries/aflw';
import { getSiteSettings } from '@/db/queries/site-settings';
import {
  aflwMatchPath,
  aflwPlayerPath,
  aflwSeasonPath,
  formatDate,
  formatNumber,
} from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import {
  aflwLeaderCategory,
  homeSection,
  homeSectionRows,
  visibleHomeSections,
  type HomeSectionId,
} from '@/lib/site-settings';

export const revalidate = 3600;

/**
 * A separate competition, titled as one. AFLW pages never borrow an AFL
 * title, never canonicalise to an AFL equivalent, and say "AFLW" in the
 * first two words so a result for a player who appears in both competitions
 * is unambiguous at a glance.
 */
export const metadata: Metadata = pageMetadata({
  title: 'AFLW Statistics — Players, Clubs, Seasons & Matches',
  description:
    'AFLW statistics from the competition’s first season in 2017: every match, '
    + 'player, club and season, with ladders, scoring progressions and search.',
  path: '/aflw',
});

/**
 * The AFLW front page, laid out exactly as the AFL one: same hero, same
 * statistics strip, the same two ruled panels, the same card grid — and the
 * same super-admin section order and visibility (see /admin/settings), since
 * "the two home pages match" is only true if one setting drives both.
 *
 * What differs is what the panels can say. AFLW has no /records section to
 * lead with, so the right-hand panel ranks career totals off
 * `aflw.player_careers` instead; and because every AFLW statistic is recorded
 * for every AFLW season, none of them carries the coverage caveat its AFL
 * counterpart needs.
 */
export default async function AflwPage() {
  const settings = await getSiteSettings();
  const visible = visibleHomeSections(settings.homeLayout);
  const leaderCategory = aflwLeaderCategory(settings.aflwLeaders);

  const [overview, seasons, vault, leaders] = await Promise.all([
    getAflwOverview(),
    listAflwSeasons(),
    visible.includes('vault') ? getAflwVaultMeetings(6) : Promise.resolve([]),
    visible.includes('record')
      ? getAflwLeaders(settings.aflwLeaders, 5)
      : Promise.resolve([]),
  ]);

  const current = seasons.find((season) => season.status === 'in_progress');
  // listAflwSeasons orders by ordinal DESC, so the newest season is first.
  const latest = seasons[0];
  const firstYear = overview.firstDate?.getFullYear() ?? 2017;
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
          <div className="value">{formatNumber(overview.playerMatchRows)}</div>
          <div className="label">Player games</div>
        </div>
      </div>
    ),

    vault: (
      <section>
        <div className="split-head">
          <h2>From the vault</h2>
          {latest && (
            <Link className="more" href={aflwSeasonPath(latest.seasonKey)}>
              All {latest.displayLabel} →
            </Link>
          )}
        </div>
        <p className="lede">
          The clubs that met in the most recent round, each shown one earlier
          meeting drawn at random from the {overview.seasons} seasons behind it.
        </p>

        {vault.length === 0 ? (
          <p className="muted">No earlier meetings to draw from.</p>
        ) : vault.map((m) => (
          <div className="ledger-row" key={m.latestKey}>
            <span>
              <Link className="fixture" href={aflwMatchPath(m.matchKey)}>
                {m.homeClubName} v {m.awayClubName}
              </Link>
              <span className="ledger-note">
                {formatNumber(m.meetings)} meetings · {m.seasonLabel}
              </span>
            </span>
            <span className="figures">
              <span className="score">{m.homeScore}–{m.awayScore}</span>
              <span className="when">
                {m.roundCode} · {formatDate(m.matchDate)}
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
          <Link className="more" href={`/aflw/players?sort=${leaderCategory.value}`}>All →</Link>
        </div>
        <p className="lede">
          {leaderCategory.label}, every AFLW season from {firstYear}.
        </p>

        {leaders.map((p) => (
          <div className="meter" key={p.slug}>
            <div className="meter-head">
              <Link href={aflwPlayerPath(p.slug)}>{p.displayName}</Link>
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
      </section>
    ),

    browse: (
      <section className="section">
        <h2>Browse the record</h2>
        <nav className="grid" aria-label="Browse">
          {[
            { href: '/aflw/players', title: 'Players', meta: 'Career profiles, season totals and match logs' },
            { href: '/aflw/clubs', title: 'Clubs', meta: 'Records, premierships and season-by-season finishes' },
            { href: '/aflw/seasons', title: 'Seasons', meta: 'Ladders, fixtures, results and premiers' },
            { href: '/aflw/venues', title: 'Venues', meta: 'Every ground the competition has used' },
            { href: '/aflw/match-search', title: 'Match Search', meta: 'Every match by scoreline, club and season' },
            { href: '/', title: 'AFL', meta: 'The men’s record, from 1897' },
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
        <h1>Every player. Every game. Since {firstYear}.</h1>
        <p className="tagline">
          The women’s competition, held separately from the AFL record because it is a
          separate competition — its own seasons, its own clubs and its own statistics.
        </p>

        <div className="hero-search">
          <SearchBox scope="aflw" placeholder="Search AFLW players and clubs…" />

          <div className="try-chips">
            <span className="try-label">Try</span>
            <Link className="chip" href="/aflw/players?sort=goals">Leading goalkickers</Link>
            {latest && (
              <Link className="chip" href={aflwSeasonPath(latest.seasonKey)}>
                {latest.displayLabel}
              </Link>
            )}
            <Link className="chip" href="/aflw/players?sort=disposals">Most disposals</Link>
            <Link className="chip" href="/aflw/clubs">Every club</Link>
          </div>
        </div>
      </div>

      {homeSectionRows(visible).map((row) => {
        if (row.length > 1) {
          return (
            <div className="split" key={row.join()}>
              {row.map((id) => <div key={id}>{sections[id]}</div>)}
            </div>
          );
        }
        const [id] = row;
        return homeSection(id)?.panel
          ? <div className="section" key={id}>{sections[id]}</div>
          : <Fragment key={id}>{sections[id]}</Fragment>;
      })}

      <p className="notice">
        Two seasons were played in calendar 2022 — Season Six from January to April
        and Season Seven from August to November — so a season here is identified by
        name rather than by year. Disposals, tackles, contested possessions and
        metres gained are recorded for every AFLW season, which is not true of the
        AFL record before the 1960s.
        {current && (
          <>
            {' '}The {current.displayLabel} season is still being played:{' '}
            {formatNumber(current.playedCount)} of {formatNumber(current.fixtureCount)}{' '}
            fixtures have been completed.
          </>
        )}
      </p>
    </>
  );
}
