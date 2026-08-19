import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { ReorderableSections } from '@/components/ReorderableSections';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import {
  getAward,
  getAwardSeason,
  getHallOfFameInductees,
  getNominationsBySeason,
  getSeasonBestAndFairest,
} from '@/db/queries/awards';
import { getSeasonMatches } from '@/db/queries/matches';
import { getSeasonRoundLadder, getSeasonRoundVotes } from '@/db/queries/rounds';
import type { RoundLadderRow, RoundVoteRow } from '@/db/queries/rounds';
import {
  getSeason,
  getSeasonBounds,
  getSeasonBrownlow,
  getSeasonGoalkickers,
  getSeasonLadder,
  listSeasons,
} from '@/db/queries/seasons';
import {
  aflwPlayerPath,
  clubPath,
  formatDate,
  formatNumber,
  formatPercentage,
  formatRound,
  isLinked,
  isNonPlayerHallOfFameCategory,
  matchPath,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { parseSeason } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';

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
  if (!season) return notFoundMetadata('Season');

  // `season.league` is the competition's name IN THAT YEAR — VFL through
  // 1989, AFL after — so a season title never anachronises itself.
  const premier = season.premierName ? ` Premiers: ${season.premierName}.` : '';
  return pageMetadata({
    title: `${season.year} ${season.league} Season — Ladder, Results & Finals`,
    description:
      `The ${season.year} ${season.league} season in full: final ladder, `
      + `${season.matchCount === null ? 'every match' : `all ${season.matchCount} matches`}, `
      + `finals series, leading goalkickers and Brownlow Medal votes.${premier}`,
    path: seasonPath(season.year),
  });
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

  const [
    ladder, matches, goalkickers, brownlow, bounds,
    roundLadder, roundVotes,
    allAustralianAward, risingStarAward,
    bestAndFairest, hallOfFame,
  ] = await Promise.all([
    getSeasonLadder(parsed),
    getSeasonMatches(parsed),
    getSeasonGoalkickers(parsed),
    getSeasonBrownlow(parsed),
    getSeasonBounds(),
    getSeasonRoundLadder(parsed),
    getSeasonRoundVotes(parsed),
    getAward('all-australian'),
    getAward('rising-star'),
    getSeasonBestAndFairest(parsed),
    getHallOfFameInductees(parsed),
  ]);

  const [allAustralianTeam, risingStarNominations] = await Promise.all([
    allAustralianAward ? getAwardSeason(allAustralianAward.id, parsed) : Promise.resolve([]),
    risingStarAward ? getNominationsBySeason(risingStarAward.id, parsed) : Promise.resolve([]),
  ]);
  const risingStarWinner = risingStarNominations.find((n) => n.isWinner) ?? null;

  const prev = parsed > bounds.min ? parsed - 1 : null;
  const next = parsed < bounds.max ? parsed + 1 : null;

  // Group matches by round, preserving chronological order.
  const rounds = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = formatRound(match.roundType, match.roundNumber);
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key)!.push(match);
  }

  // Round-grain ladder and Brownlow votes, keyed by round number so each
  // round's block below can look up its own slice.
  const roundLadderByRound = new Map<number, RoundLadderRow[]>();
  for (const row of roundLadder) {
    if (!roundLadderByRound.has(row.roundNumber)) roundLadderByRound.set(row.roundNumber, []);
    roundLadderByRound.get(row.roundNumber)!.push(row);
  }
  const roundVotesByRound = new Map<number, RoundVoteRow[]>();
  for (const row of roundVotes) {
    if (!roundVotesByRound.has(row.roundNumber)) roundVotesByRound.set(row.roundNumber, []);
    roundVotesByRound.get(row.roundNumber)!.push(row);
  }

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'ladder',
    label: 'Ladder',
    node: (
      <section className="section">
        <CollapsibleTable title="Ladder">
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
                    {row.isPremier && <span className="badge">Premiers</span>}
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
        </CollapsibleTable>
      </section>
    ),
  });

  sections.push({
    id: 'goalkickers-and-brownlow',
    label: 'Leading goalkickers and Brownlow Medal',
    node: (
      <div className="grid grid-panels">
        <section className="section">
          <CollapsibleTable title="Leading goalkickers">
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
                    <td>
                      {p.clubSlug ? (
                        <Link href={clubPath(p.clubSlug)}>{p.clubName}</Link>
                      ) : (
                        <span className="not-recorded">—</span>
                      )}
                    </td>
                    <td className="num">{formatNumber(p.goals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>

        <section className="section">
          {brownlow.length === 0 ? (
            <>
              <h2>Brownlow Medal</h2>
              <div className="empty">
                <h3>No votes recorded for {season.year}</h3>
                <p>
                  {season.year < 1924
                    ? 'The medal was first awarded in 1924.'
                    : 'The season count for this year is not in AFLDB.'}
                </p>
              </div>
            </>
          ) : (
            <CollapsibleTable title="Brownlow Medal">
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
            </CollapsibleTable>
          )}
        </section>
      </div>
    ),
  });

  const hasSeasonAwards = allAustralianTeam.length > 0 || bestAndFairest.length > 0
    || risingStarWinner !== null || hallOfFame.length > 0;

  if (hasSeasonAwards) {
    sections.push({
      id: 'season-awards',
      label: 'Awards and honours',
      node: (
        <div className="grid grid-panels">
          {allAustralianTeam.length > 0 && (
            <section className="section">
              <CollapsibleTable title="All-Australian team">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Position</th>
                      <th scope="col">Player</th>
                      <th scope="col">Club</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAustralianTeam.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{m.position ?? <span className="muted">—</span>}</td>
                        <td className="wide">
                          {m.playerId && isLinked(m.linkStatus) ? (
                            <Link href={playerPath(m.playerSlug!, m.playerId)}>{m.playerName}</Link>
                          ) : (
                            m.playerName
                          )}
                          {m.isCaptain && <strong> (c)</strong>}
                          {m.isViceCaptain && <span> (vc)</span>}
                          {!isLinked(m.linkStatus) && (
                            <UnmatchedPlayer targetTable="award_winners" targetId={m.id} />
                          )}
                        </td>
                        <td>
                          {m.clubSlug
                            ? <Link href={clubPath(m.clubSlug)}>{m.clubName}</Link>
                            : <span className="muted">{m.clubNameRaw ?? '—'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </CollapsibleTable>
            </section>
          )}

          {bestAndFairest.length > 0 && (
            <section className="section">
              <CollapsibleTable title="Club best and fairest">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Club</th>
                      <th scope="col">Award</th>
                      <th scope="col">Player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bestAndFairest.map((w, i) => (
                      <tr key={`${w.awardSlug}-${i}`}>
                        <td>
                          {w.clubSlug
                            ? <Link href={clubPath(w.clubSlug)}>{w.clubName}</Link>
                            : <span className="muted">—</span>}
                        </td>
                        <td className="wide">{w.awardName}</td>
                        <td>
                          {w.playerId && isLinked(w.linkStatus) ? (
                            <Link href={playerPath(w.playerSlug!, w.playerId)}>{w.playerName}</Link>
                          ) : (
                            w.playerName
                          )}
                          {!isLinked(w.linkStatus) && (
                            <UnmatchedPlayer targetTable="award_winners" targetId={w.id} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </CollapsibleTable>
            </section>
          )}

          {risingStarWinner && (
            <section className="section">
              <CollapsibleTable title="Rising Star">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Club</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="wide">
                        {risingStarWinner.playerId && isLinked(risingStarWinner.linkStatus) ? (
                          <Link href={playerPath(risingStarWinner.playerSlug!, risingStarWinner.playerId)}>
                            {risingStarWinner.playerName}
                          </Link>
                        ) : (
                          risingStarWinner.playerName
                        )}
                        {!isLinked(risingStarWinner.linkStatus) && (
                          <UnmatchedPlayer targetTable="award_nominations" targetId={risingStarWinner.id} />
                        )}
                      </td>
                      <td>
                        {risingStarWinner.clubSlug
                          ? <Link href={clubPath(risingStarWinner.clubSlug)}>{risingStarWinner.clubName}</Link>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              </CollapsibleTable>
            </section>
          )}

          {hallOfFame.length > 0 && (
            <section className="section">
              <CollapsibleTable title="Hall of Fame inductees">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hallOfFame.map((h) => {
                      const nonPlayer = isNonPlayerHallOfFameCategory(h.category);
                      return (
                        <tr key={h.id}>
                          <td className="wide">
                            {h.playerId && isLinked(h.linkStatus) ? (
                              <Link href={playerPath(h.playerSlug!, h.playerId)}>{h.name}</Link>
                            ) : h.aflwPlayerSlug ? (
                              <Link href={aflwPlayerPath(h.aflwPlayerSlug)}>{h.name}</Link>
                            ) : (
                              h.name
                            )}
                            {h.isLegend && <strong> (Legend)</strong>}
                            {!nonPlayer && !h.aflwPlayerSlug && !isLinked(h.linkStatus) && (
                              <UnmatchedPlayer targetTable="hall_of_fame" targetId={h.id} />
                            )}
                          </td>
                          <td>{h.category ?? <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </CollapsibleTable>
            </section>
          )}
        </div>
      ),
    });
  }

  sections.push({
    id: 'matches',
    label: 'Matches',
    node: (
      <section className="section">
        <h2>Matches</h2>
        {[...rounds.entries()].map(([roundName, roundMatches]) => {
          const roundNumber = roundMatches[0].roundType === 'home_and_away'
            ? roundMatches[0].roundNumber
            : null;
          const thisRoundLadder = roundNumber !== null ? roundLadderByRound.get(roundNumber) : undefined;
          const thisRoundVotes = roundNumber !== null ? roundVotesByRound.get(roundNumber) : undefined;

          return (
            <div
              key={roundName}
              // Anchor target for /seasons/1989#round-5 links from search.
              id={roundName.toLowerCase().replace(/\s+/g, '-')}
              className="anchor"
              style={{ marginBottom: '1.25rem' }}
            >
              <CollapsibleTable title={roundName}>
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
              </CollapsibleTable>

              {thisRoundLadder && thisRoundLadder.length > 0 && (
                <CollapsibleTable title={`Ladder after ${roundName}`} defaultOpen={false}>
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
                      {thisRoundLadder.map((row) => (
                        <tr key={row.clubId}>
                          <td className="num">{row.ladderRank}</td>
                          <td className="wide"><Link href={clubPath(row.clubSlug)}>{row.clubName}</Link></td>
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
                </CollapsibleTable>
              )}

              {thisRoundVotes && thisRoundVotes.length > 0 && (
                <CollapsibleTable title="Brownlow votes" defaultOpen={false}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Club</th>
                        <th scope="col" className="num">Votes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {thisRoundVotes.map((v) => (
                        <tr key={v.id}>
                          <td className="wide"><Link href={playerPath(v.slug, v.id)}>{v.displayName}</Link></td>
                          <td>
                            {v.clubSlug
                              ? <Link href={clubPath(v.clubSlug)}>{v.clubName}</Link>
                              : <span className="not-recorded">—</span>}
                          </td>
                          <td className="num">{v.votes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </CollapsibleTable>
              )}
            </div>
          );
        })}
      </section>
    ),
  });

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Seasons', href: '/seasons' },
        { label: `${season.year} ${season.league}` },
      ]} />

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

      {/* Adjacent seasons, not pages of one list — so it states the end of
          the record rather than leaving a gap where a control would be. */}
      <nav className="season-nav" aria-label="Adjacent seasons">
        {prev ? (
          <Link className="btn btn-secondary" href={seasonPath(prev)} rel="prev">← {prev}</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Earliest season</span>
        )}
        {next ? (
          <Link className="btn btn-secondary" href={seasonPath(next)} rel="next">{next} →</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Latest season</span>
        )}
      </nav>

      <ReorderableSections storageKey={`/seasons/${season.year}`} sections={sections} />
    </>
  );
}
