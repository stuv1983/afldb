import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { TableFilters } from '@/components/TableFilters';
import {
  getAflwClubOptions,
  getAflwLadder,
  getAflwSeason,
  getAflwSeasonMatches,
  listAflwPlayers,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwMatchPath,
  aflwPlayerPath,
  aflwSeasonPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatRoundShort,
  formatScore,
} from '@/lib/format';
import { isFilteredView, notFoundMetadata, pageMetadata } from '@/lib/seo';
import { AFLW_MATCH_TYPES } from '@/search/aflw-filters';
import { type FilterField, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

const LEADER_LIMIT = 25;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const season = await getAflwSeason(decodeURIComponent(key));
  if (!season) return notFoundMetadata('AFLW season');
  return pageMetadata({
    // AFLW seasons are NAMED, not numbered — two of them fall in calendar
    // 2022 — so the label is the season's own and is never rewritten to a
    // year, which would make those two seasons indistinguishable.
    title: `${season.displayLabel} AFLW Season — Ladder, Results & Stats`,
    description:
      `The ${season.displayLabel} AFLW season: ladder, results and leading players `
      + `across ${season.playedCount} matches.`,
    path: aflwSeasonPath(season.seasonKey),
    noindex: isFilteredView(query),
  });
}

export default async function AflwSeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ key: rawKey }, query] = await Promise.all([params, searchParams]);
  const seasonKey = decodeURIComponent(rawKey);

  // Nothing in this wave depends on anything else in it: every query is
  // keyed by the season alone, and the club list only fills a dropdown.
  const [season, clubOptions, ladder, allMatches, leaders] = await Promise.all([
    getAflwSeason(seasonKey),
    getAflwClubOptions(),
    getAflwLadder(seasonKey),
    getAflwSeasonMatches(seasonKey),
    listAflwPlayers({
      sort: 'goals', limit: LEADER_LIMIT, offset: 0, seasonKey,
    }),
  ]);
  if (!season) notFound();

  const matchFields: FilterField[] = [
    {
      kind: 'select', key: 'club', label: 'Club', options: clubOptions,
      anyLabel: 'Any club',
      help: 'Matches involving this club, home or away.',
    },
    {
      kind: 'select', key: 'type', label: 'Match type', anyLabel: 'Any match',
      options: AFLW_MATCH_TYPES,
    },
    { kind: 'range', key: 'margin', label: 'Margin', min: 0, max: 300 },
    { kind: 'range', key: 'round', label: 'Round', min: 1, max: 30 },
  ];
  const matchValues = parseFilterValues(matchFields, query);

  // The season's match list is 108 rows at most and is already loaded for
  // the results table, so it is filtered here rather than in a second
  // query. The vocabulary is Match Search's own `AFLW_MATCH_TYPES`, and
  // each branch mirrors the condition `runAflwMatchSearch` builds, so the
  // same `type` value means the same thing on both pages.
  const club = matchValues.select.club;
  const type = matchValues.select.type;
  const margin = matchValues.range.margin;
  const round = matchValues.range.round;
  const matches = allMatches.filter((match) => {
    if (club && match.homeTeamCode !== club && match.awayTeamCode !== club) return false;
    if (type === 'finals' && !match.isFinal) return false;
    if (type === 'home_and_away' && match.isFinal) return false;
    if (type === 'grand_final' && match.roundType !== 'grand_final') return false;
    if (margin?.min !== undefined && match.margin < margin.min) return false;
    if (margin?.max !== undefined && match.margin > margin.max) return false;
    // A final has no round number, so it is outside every round range —
    // the same way a NULL fails both halves of a SQL BETWEEN. Sentinels
    // would drop finals from a minimum and keep them under a maximum.
    if (round && match.roundNumber === null) return false;
    if (round?.min !== undefined && match.roundNumber! < round.min) return false;
    if (round?.max !== undefined && match.roundNumber! > round.max) return false;
    return true;
  });

  const conferences = [...new Set(ladder.map((row) => row.conference))];

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  for (const conference of conferences) {
    const label = conference ? `Ladder — Conference ${conference}` : 'Ladder';
    sections.push({
      id: conference ? `ladder-${conference}` : 'ladder',
      label,
      node: (
        <section className="section">
          <CollapsibleTable
            title={label}
            note={`${ladder.filter((row) => row.conference === conference).length} clubs`}
          >
            <div className="table-wrap">
              <table>
                <caption>Home-and-away ladder at the end of the season.</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">#</th>
                    <th scope="col">Club</th>
                    <th scope="col" className="num">P</th>
                    <th scope="col" className="num">W</th>
                    <th scope="col" className="num">D</th>
                    <th scope="col" className="num">L</th>
                    <th scope="col" className="num">For</th>
                    <th scope="col" className="num">Against</th>
                    <th scope="col" className="num">%</th>
                    <th scope="col" className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder
                    .filter((row) => row.conference === conference)
                    .map((row) => (
                      <tr key={row.teamCode}>
                        <td className="num">{row.ladderRank}</td>
                        <td className="wide">
                          <Link href={aflwClubPath(row.teamCode)}>{row.clubName}</Link>
                          {season.premierCode === row.teamCode && <strong> · Premier</strong>}
                        </td>
                        <td className="num">{row.played}</td>
                        <td className="num">{row.wins}</td>
                        <td className="num">{row.draws}</td>
                        <td className="num">{row.losses}</td>
                        <td className="num">{formatNumber(row.pointsFor)}</td>
                        <td className="num">{formatNumber(row.pointsAgainst)}</td>
                        <td className="num">{formatPercentage(row.percentage)}</td>
                        <td className="num"><strong>{row.premiershipPoints}</strong></td>
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
    id: 'results',
    label: 'Results',
    node: (
      <section className="section">
        <CollapsibleTable
          id="results"
          title="Results"
          note={`${matches.length} of ${allMatches.length} matches`}
          filters={
            <TableFilters
              action={aflwSeasonPath(seasonKey)}
              anchor="results"
              fields={matchFields}
              values={matchValues}
              title="Filter results"
              submitLabel="Apply"
            />
          }
        >
          {matches.length === 0 ? (
            <div className="empty">
              <h2>No matches match those filters</h2>
              <p>Try clearing the club or widening the margin.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Round</th>
                    <th scope="col">Home</th>
                    <th scope="col" className="num">Score</th>
                    <th scope="col">Away</th>
                    <th scope="col" className="num">Margin</th>
                    <th scope="col">Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match) => (
                    <tr key={match.matchKey}>
                      <td className="nowrap">
                        <Link href={aflwMatchPath(match.matchKey)}>
                          {formatDate(match.matchDate)}
                        </Link>
                      </td>
                      <td className="nowrap">
                        {formatRoundShort(match.roundType, match.roundNumber, match.roundCode)}
                      </td>
                      <td className="wide">
                        <Link href={aflwClubPath(match.homeTeamCode)}>
                          {match.homeClubName}
                        </Link>
                      </td>
                      <td className="num nowrap">
                        {formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}–
                        {formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}
                      </td>
                      <td className="wide">
                        <Link href={aflwClubPath(match.awayTeamCode)}>
                          {match.awayClubName}
                        </Link>
                      </td>
                      <td className="num">
                        {match.result === 'draw' ? 'Draw' : `${match.margin} pts`}
                      </td>
                      <td>{match.venueName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'leading-goalkickers',
    label: 'Leading goalkickers',
    node: (
      <section className="section">
        <CollapsibleTable
          title="Leading goalkickers"
          note={`Career totals · top ${LEADER_LIMIT}`}
          defaultOpen={false}
        >
          <div className="table-wrap">
            <table>
              <caption>
                Players who appeared this season, ranked by career goals. Season-only
                totals are on each player’s own page.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Clubs</th>
                  <th scope="col" className="num">Career games</th>
                  <th scope="col" className="num">Career goals</th>
                </tr>
              </thead>
              <tbody>
                {leaders.rows.map((player) => (
                  <tr key={player.slug}>
                    <td className="wide">
                      <Link href={aflwPlayerPath(player.slug)}>{player.displayName}</Link>
                    </td>
                    <td className="wide">{player.clubNames ?? '—'}</td>
                    <td className="num">{formatNumber(player.games)}</td>
                    <td className="num">{formatNumber(player.goals)}</td>
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
        { label: 'AFLW', href: '/aflw' },
        { label: 'Seasons', href: '/aflw/seasons' },
        { label: season.displayLabel },
      ]} />

      <div className="page-header">
        <h1>{season.displayLabel} AFLW season</h1>
        <p className="subtitle">
          {formatDate(season.firstFixtureDate)} – {formatDate(season.lastFixtureDate)}
          {' · '}{formatNumber(season.playedCount)} matches
          {' · '}{formatNumber(season.clubCount)} clubs
        </p>
      </div>

      <FilterErrors errors={matchValues.errors} />

      {!season.hasGrandFinal && (
        <p className="notice">
          {season.status === 'in_progress'
            ? `This season is still being played: ${season.playedCount} of `
              + `${season.fixtureCount} fixtures have been completed and no premiership `
              + 'has been awarded.'
            : 'This season was abandoned before a Grand Final was played and awarded no '
              + 'premiership. A ladder leader is not a premier.'}
        </p>
      )}

      <ReorderableSections storageKey={aflwSeasonPath(seasonKey)} sections={sections} />
    </>
  );
}
