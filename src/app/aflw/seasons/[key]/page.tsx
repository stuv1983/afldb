import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { TableFilters } from '@/components/TableFilters';
import {
  getAflwLadder,
  getAflwSeason,
  getAflwSeasonMatches,
  listAflwClubs,
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
  formatScore,
} from '@/lib/format';
import { type FilterField, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

const LEADER_LIMIT = 25;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const season = await getAflwSeason(decodeURIComponent(key));
  if (!season) return { title: 'Season not found' };
  return {
    title: `${season.displayLabel} AFLW season`,
    description:
      `The ${season.displayLabel} AFLW season: ladder, results and leading players `
      + `across ${season.playedCount} matches.`,
    alternates: { canonical: aflwSeasonPath(season.seasonKey) },
  };
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

  const season = await getAflwSeason(seasonKey);
  if (!season) notFound();

  const clubs = await listAflwClubs();
  const clubOptions = clubs
    .map((club) => ({ value: club.code, label: club.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const matchFields: FilterField[] = [
    {
      kind: 'select', key: 'club', label: 'Club', options: clubOptions,
      anyLabel: 'Any club',
      help: 'Matches involving this club, home or away.',
    },
    {
      kind: 'select', key: 'type', label: 'Match type', anyLabel: 'Any match',
      options: [
        { value: 'home_and_away', label: 'Home and away' },
        { value: 'finals', label: 'Finals' },
      ],
    },
    { kind: 'range', key: 'margin', label: 'Margin', min: 0, max: 300 },
    { kind: 'range', key: 'round', label: 'Round', min: 1, max: 30 },
  ];
  const matchValues = parseFilterValues(matchFields, query);

  const [ladder, allMatches, leaders] = await Promise.all([
    getAflwLadder(seasonKey),
    getAflwSeasonMatches(seasonKey),
    listAflwPlayers({
      sort: 'goals', limit: LEADER_LIMIT, offset: 0, seasonKey,
    }),
  ]);

  // The season's match list is 108 rows at most, so it is filtered here
  // rather than in a second query: one round trip, and the filter reads
  // the same way as the SQL one it stands in for.
  const club = matchValues.select.club;
  const type = matchValues.select.type;
  const margin = matchValues.range.margin;
  const round = matchValues.range.round;
  const matches = allMatches.filter((match) => {
    if (club && match.homeTeamCode !== club && match.awayTeamCode !== club) return false;
    if (type === 'finals' && !match.isFinal) return false;
    if (type === 'home_and_away' && match.isFinal) return false;
    if (margin?.min !== undefined && match.margin < margin.min) return false;
    if (margin?.max !== undefined && match.margin > margin.max) return false;
    if (round?.min !== undefined && (match.roundNumber ?? 0) < round.min) return false;
    if (round?.max !== undefined && (match.roundNumber ?? 99) > round.max) return false;
    return true;
  });

  const conferences = [...new Set(ladder.map((row) => row.conference))];

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <Link href="/aflw/seasons">Seasons</Link>
        <span aria-hidden="true">/</span>
        <span>{season.displayLabel}</span>
      </nav>

      <div className="page-header">
        <h1>{season.displayLabel} AFLW season</h1>
        <p className="subtitle">
          {formatDate(season.firstFixtureDate)} – {formatDate(season.lastFixtureDate)}
          {' · '}{formatNumber(season.playedCount)} matches
          {' · '}{formatNumber(season.clubCount)} clubs
        </p>
      </div>

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

      {conferences.map((conference) => (
        <section className="section" key={conference || 'single'}>
          <CollapsibleTable
            title={conference ? `Ladder — Conference ${conference}` : 'Ladder'}
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
      ))}

      <section className="section">
        <CollapsibleTable
          title="Results"
          note={`${matches.length} of ${allMatches.length} matches`}
          filters={
            <TableFilters
              action={aflwSeasonPath(seasonKey)}
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
                        {match.roundType === 'home_and_away'
                          ? `R${match.roundNumber}`
                          : match.roundCode}
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
    </>
  );
}
