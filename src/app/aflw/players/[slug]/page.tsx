import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { ReorderableSections } from '@/components/ReorderableSections';
import { TableFilters } from '@/components/TableFilters';
import {
  getAflwPlayer,
  getAflwPlayerMatches,
  getAflwPlayerSeasons,
  getAflwSeasonOptions,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwMatchPath,
  aflwPlayerPath,
  aflwSeasonPath,
  formatAverage,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatSpanLabel,
} from '@/lib/format';
import { redirectPastEnd } from '@/lib/pagination';
import { firstValue, parsePage } from '@/lib/params';
import { isFilteredView, notFoundMetadata, pageMetadata } from '@/lib/seo';
import { filterQueryParams, parseFilterValues, type FilterField } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

const MATCHES_PER_PAGE = 25;

/**
 * AFLW pages carry AFLW in the title and canonicalise only to themselves.
 *
 * Several players share a name with a VFL/AFL player and a few have played
 * in both competitions; the competitions share no record, so an AFLW page
 * must never canonicalise to an AFL one and must be distinguishable from it
 * in a result list without opening either.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const player = await getAflwPlayer(decodeURIComponent(slug));
  if (!player) return notFoundMetadata('AFLW player');
  return pageMetadata({
    title: `${player.displayName} — AFLW Stats, Games & Career Record`,
    description:
      `${player.displayName}: ${player.games} AFLW games, ${player.goals} goals `
      + `and ${player.disposals} disposals for ${player.clubNames ?? 'the AFLW'}. `
      + 'Season-by-season statistics and full match log.',
    path: aflwPlayerPath(player.slug),
    ogType: 'profile',
    noindex: isFilteredView(query),
  });
}

export default async function AflwPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug: rawSlug }, query] = await Promise.all([params, searchParams]);
  const slug = decodeURIComponent(rawSlug);

  // All three are keyed by the slug alone, so they run together rather
  // than one waiting on the last.
  const [player, seasonOptions, seasons] = await Promise.all([
    getAflwPlayer(slug),
    getAflwSeasonOptions(),
    getAflwPlayerSeasons(slug),
  ]);
  if (!player) notFound();

  // Only the seasons this player actually appeared in are offered, so the
  // control cannot produce an empty match log.
  const playedKeys = new Set(seasons.map((season) => season.seasonKey));
  const matchFields: FilterField[] = [
    {
      kind: 'select',
      key: 'season',
      label: 'Season',
      anyLabel: 'Every season',
      options: seasonOptions
        .filter((season) => playedKeys.has(season.key))
        .map((season) => ({ value: season.key, label: season.label })),
    },
  ];
  const values = parseFilterValues(matchFields, query);
  const page = parsePage(firstValue(query.page));

  const matches = await getAflwPlayerMatches(slug, {
    limit: MATCHES_PER_PAGE,
    offset: (page - 1) * MATCHES_PER_PAGE,
    seasonKey: values.select.season,
  });

  redirectPastEnd({
    basePath: aflwPlayerPath(slug),
    params: filterQueryParams(matchFields, values),
    page,
    pageSize: MATCHES_PER_PAGE,
    total: matches.total,
  });

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'career-totals',
    label: 'Career totals',
    node: (
      <section className="section">
        <CollapsibleTable title="Career totals">
          <div className="table-wrap">
            <table>
              <caption>
                Every AFLW season records the same statistics, so nothing in this
                table is missing for reasons of era. Metres gained is signed: a
                single match can finish below zero.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Statistic</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Per game</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Kicks', player.kicks],
                  ['Handballs', player.handballs],
                  ['Disposals', player.disposals],
                  ['Contested possessions', player.contested],
                  ['Metres gained', player.metresGained],
                  ['Marks', player.marks],
                  ['Tackles', player.tackles],
                  ['Hitouts', player.hitouts],
                  ['Goals', player.goals],
                  ['Behinds', player.behinds],
                  ['Score points', player.scorePoints],
                  ['Fantasy points', player.fantasyPoints],
                ] as const).map(([label, value]) => (
                  <tr key={label}>
                    <td className="wide">{label}</td>
                    <td className="num">{formatNumber(value)}</td>
                    <td className="num">{formatAverage(value, player.games)}</td>
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
    id: 'playing-record',
    label: 'Playing record',
    node: (
      <section className="section">
        <CollapsibleTable
          title="Playing record"
          note={`${player.seasonsPlayed} seasons · ${player.clubsPlayed} clubs`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col" className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Debut</td><td className="num">{formatDate(player.debutDate)}</td></tr>
                <tr>
                  <td>Most recent match</td>
                  <td className="num">{formatDate(player.lastMatchDate)}</td>
                </tr>
                <tr>
                  <td>Win–draw–loss</td>
                  <td className="num">
                    {player.wins}–{player.draws}–{player.losses}
                  </td>
                </tr>
                <tr><td>Finals</td><td className="num">{formatNumber(player.finals)}</td></tr>
                <tr>
                  <td>Premierships</td>
                  <td className="num">{formatNumber(player.premierships)}</td>
                </tr>
                <tr>
                  <td>Most goals in a match</td>
                  <td className="num">{formatNumber(player.bestGoalsGame)}</td>
                </tr>
                <tr>
                  <td>Most disposals in a match</td>
                  <td className="num">{formatNumber(player.bestDisposalsGame)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'season-by-season',
    label: 'Season by season',
    node: (
      <section className="section">
        <CollapsibleTable title="Season by season" note={`${seasons.length} seasons`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Games</th>
                  <th scope="col" className="num">W–D–L</th>
                  <th scope="col" className="num">Goals</th>
                  <th scope="col" className="num">Disposals</th>
                  <th scope="col" className="num">Marks</th>
                  <th scope="col" className="num">Tackles</th>
                  <th scope="col" className="num">Finals</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.seasonKey}>
                    <td>
                      <Link href={aflwSeasonPath(season.seasonKey)}>{season.seasonLabel}</Link>
                    </td>
                    <td className="wide">
                      <Link href={aflwClubPath(season.teamCode)}>{season.clubName}</Link>
                    </td>
                    <td className="num">{season.games}</td>
                    <td className="num nowrap">
                      {season.wins}–{season.draws}–{season.losses}
                    </td>
                    <td className="num">{formatNumber(season.goals)}</td>
                    <td className="num">{formatNumber(season.disposals)}</td>
                    <td className="num">{formatNumber(season.marks)}</td>
                    <td className="num">{formatNumber(season.tackles)}</td>
                    <td className="num">{season.finals}</td>
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
    id: 'match-log',
    label: 'Match log',
    node: (
      <section className="section">
        <CollapsibleTable
          id="match-log"
          title="Match log"
          note={`${formatNumber(matches.total)} matches`}
          filters={
            <TableFilters
              action={aflwPlayerPath(slug)}
              anchor="match-log"
              fields={matchFields}
              values={values}
              title="Filter matches"
              submitLabel="Apply"
            />
          }
        >
          {matches.rows.length === 0 ? (
            <div className="empty">
              <h2>No matches in that season</h2>
              <p>Choose another season, or clear the filter.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Season</th>
                      <th scope="col">Round</th>
                      <th scope="col">Opponent</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="num">G</th>
                      <th scope="col" className="num">B</th>
                      <th scope="col" className="num">K</th>
                      <th scope="col" className="num">H</th>
                      <th scope="col" className="num">D</th>
                      <th scope="col" className="num">M</th>
                      <th scope="col" className="num">T</th>
                      <th scope="col" className="num">Metres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.rows.map((match) => (
                      <tr key={match.matchKey}>
                        <td className="nowrap">
                          <Link href={aflwMatchPath(match.matchKey)}>
                            {formatDate(match.matchDate)}
                          </Link>
                        </td>
                        <td className="nowrap">{match.seasonLabel}</td>
                        <td className="nowrap">
                          {formatRoundShort(match.roundType, match.roundNumber, match.roundCode)}
                        </td>
                        <td className="wide">
                          <Link href={aflwClubPath(match.opponentCode)}>
                            {match.opponentName}
                          </Link>
                        </td>
                        <td className="nowrap">
                          <span className={`result-${match.outcome}`}>{match.outcome}</span>
                          {' '}
                          <span className="muted">
                            {match.pointsFor}–{match.pointsAgainst}
                          </span>
                        </td>
                        <td className="num">{match.goals}</td>
                        <td className="num">{match.behinds}</td>
                        <td className="num">{match.kicks}</td>
                        <td className="num">{match.handballs}</td>
                        <td className="num">{match.disposals}</td>
                        <td className="num">{match.marks}</td>
                        <td className="num">{match.tackles}</td>
                        <td className="num">{formatNumber(match.metresGained)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                basePath={aflwPlayerPath(slug)}
                params={{ season: values.select.season }}
                page={page}
                pageSize={MATCHES_PER_PAGE}
                total={matches.total}
              />
            </>
          )}
        </CollapsibleTable>
      </section>
    ),
  });

  return (
    <>
      <Breadcrumbs items={[
        { label: 'AFLW', href: '/aflw' },
        { label: 'Players', href: '/aflw/players' },
        { label: player.displayName },
      ]} />

      <div className="page-header">
        <h1>{player.displayName}</h1>
        <p className="subtitle">
          {player.clubNames ?? 'AFLW'}
          {' · '}
          {formatSpanLabel(player.debutSeasonLabel, player.finalSeasonLabel)}
          {' · '}
          {formatNumber(player.games)} games
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(player.games)}</div>
          <div className="label">Games</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(player.goals)}</div>
          <div className="label">Goals</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(player.disposals)}</div>
          <div className="label">Disposals</div>
        </div>
        <div className="stat">
          <div className="value">{formatAverage(player.disposals, player.games)}</div>
          <div className="label">Disposals per game</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(player.premierships)}</div>
          <div className="label">Premierships</div>
        </div>
      </div>

      <ReorderableSections storageKey={aflwPlayerPath(slug)} sections={sections} />

      <p className="notice">
        The AFLW source identifies a player by a name-derived slug rather than a
        durable id, so two players who share a name and were never distinguished by
        the source would share this page. AFLW records are kept separate from the
        AFL side of the database and are not combined with it.
      </p>
    </>
  );
}
