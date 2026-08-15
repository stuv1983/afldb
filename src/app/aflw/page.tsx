import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { ReorderableSections } from '@/components/ReorderableSections';
import { SearchBox } from '@/components/SearchBox';
import {
  getAflwOverview,
  getAflwRecentMatches,
  listAflwClubs,
  listAflwSeasons,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwMatchPath,
  aflwSeasonPath,
  formatDate,
  formatNumber,
  formatScore,
} from '@/lib/format';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'AFLW',
  description:
    'AFLW statistics from the competition’s first season in 2017: every match, '
    + 'player, club and season, with ladders, scoring progressions and search.',
  alternates: { canonical: '/aflw' },
};

const SECTIONS = [
  { href: '/aflw/players', title: 'Players', meta: 'Career profiles, season totals and match logs' },
  { href: '/aflw/clubs', title: 'Clubs', meta: 'Records, premierships and season-by-season finishes' },
  { href: '/aflw/seasons', title: 'Seasons', meta: 'Ladders, fixtures, results and premiers' },
  { href: '/aflw/match-search', title: 'Match Search', meta: 'Every match by scoreline, club and season' },
];

export default async function AflwPage() {
  const [overview, seasons, clubs, recent] = await Promise.all([
    getAflwOverview(),
    listAflwSeasons(),
    listAflwClubs(),
    getAflwRecentMatches(6),
  ]);

  const current = seasons.find((season) => season.status === 'in_progress');

  // Counted rather than written down: a season that awarded no premiership
  // is not always the abandoned one — a season still being played has not
  // awarded one yet either, and next year there is one more of each.
  const decided = seasons.filter((season) => season.premierCode !== null).length;
  const undecided = seasons.length - decided;

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'most-recent-matches',
    label: 'Most recent matches',
    node: (
      <section className="section">
        <CollapsibleTable title="Most recent matches" note={`${recent.length} shown`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Season</th>
                  <th scope="col">Home</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col">Away</th>
                  <th scope="col">Venue</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((match) => (
                  <tr key={match.matchKey}>
                    <td className="nowrap">
                      <Link href={aflwMatchPath(match.matchKey)}>
                        {formatDate(match.matchDate)}
                      </Link>
                    </td>
                    <td>
                      <Link href={aflwSeasonPath(match.seasonKey)}>{match.seasonLabel}</Link>
                    </td>
                    <td className="wide">
                      <Link href={aflwClubPath(match.homeTeamCode)}>{match.homeClubName}</Link>
                    </td>
                    <td className="num nowrap">
                      {formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}–
                      {formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}
                    </td>
                    <td className="wide">
                      <Link href={aflwClubPath(match.awayTeamCode)}>{match.awayClubName}</Link>
                    </td>
                    <td>{match.venueName}</td>
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
    id: 'premierships',
    label: 'Premierships',
    node: (
      <section className="section">
        <CollapsibleTable
          title="Premierships"
          note={`${clubs.length} clubs`}
          defaultOpen={false}
        >
          <div className="table-wrap">
            <table>
              <caption>
                {decided} of {seasons.length} seasons have produced a premier
                {undecided > 0 && (
                  <>
                    {' '}— 2020 was abandoned at the semi-finals and awarded no
                    premiership, and a season still being played has yet to award one
                  </>
                )}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col" className="num">Matches</th>
                  <th scope="col" className="num">Won</th>
                  <th scope="col" className="num">Finals</th>
                  <th scope="col" className="num">Premierships</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((club) => (
                  <tr key={club.code}>
                    <td className="wide">
                      <Link href={aflwClubPath(club.code)}>{club.name}</Link>
                    </td>
                    <td className="num">{club.seasonsContested}</td>
                    <td className="num">{formatNumber(club.matches)}</td>
                    <td className="num">{formatNumber(club.wins)}</td>
                    <td className="num">{formatNumber(club.finals)}</td>
                    <td className="num">
                      {club.premierships > 0 ? <strong>{club.premierships}</strong> : '—'}
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
      <div className="page-header">
        <h1>AFLW</h1>
        <p className="subtitle">
          The women’s competition from its first match in {formatDate(overview.firstDate)},
          held separately from the AFL record because it is a separate competition —
          its own seasons, its own clubs and its own statistics.
        </p>
      </div>

      <div className="hero-search" style={{ margin: '0 0 1.5rem' }}>
        <SearchBox scope="aflw" placeholder="Search AFLW players and clubs…" />
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(overview.seasons)}</div>
          <div className="label">Seasons</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.clubs)}</div>
          <div className="label">Clubs</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.players)}</div>
          <div className="label">Players</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(overview.playerMatchRows)}</div>
          <div className="label">Player-match rows</div>
        </div>
      </div>

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

      <section className="section" aria-labelledby="aflw-sections">
        <h2 id="aflw-sections">Explore AFLW</h2>
        <div className="grid aflw-grid">
          {SECTIONS.map((section) => (
            <Link className="aflw-card" key={section.href} href={section.href}>
              <h3>{section.title}</h3>
              <p>{section.meta}</p>
              <span>Browse</span>
            </Link>
          ))}
        </div>
      </section>

      <ReorderableSections storageKey="/aflw" sections={sections} />
    </>
  );
}
