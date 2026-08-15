import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { getPlayerHonours } from '@/db/queries/awards';
import {
  getPlayer,
  getPlayerBrownlow,
  getPlayerClubs,
  getPlayerMatches,
  getPlayerSeasons,
  listMostViewedPlayers,
} from '@/db/queries/players';
import {
  NOT_RECORDED,
  awardPath,
  awardSeasonPath,
  brownlowStatusNote,
  clubPath,
  formatBrownlow,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatSpan,
  formatStat,
  honourTeamPath,
  matchPath,
  parseEntitySlug,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { honourTeamSlug } from '@/lib/slugs';

// Player careers are historical and change only when an import runs.
// This page deliberately reads no searchParams: doing so would force
// dynamic rendering and cost roughly 2s per request under load.
export const revalidate = 3600;

const MATCH_PAGE_SIZE = 50;

/**
 * Seed the route with the most-viewed players.
 *
 * A dynamic segment with no generateStaticParams at all is treated as
 * fully dynamic and is never cached, which costs ~1.5s per request under
 * load. Declaring even a subset puts the route in the incremental cache,
 * so the remaining ~12,900 players are rendered once on demand and
 * served from cache thereafter.
 *
 * Prerendering all 13,361 would add roughly 20 minutes to every build
 * for pages that are rarely requested.
 */
export async function generateStaticParams() {
  const players = await listMostViewedPlayers(500);
  return players.map((p) => ({ slug: `${p.slug}-${p.id}` }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEntitySlug(slug);
  if (!parsed) return { title: 'Player not found' };

  const player = await getPlayer(parsed.id);
  if (!player) return { title: 'Player not found' };

  const span = formatSpan(player.debutSeason, player.finalSeason);
  return {
    title: `${player.displayName} AFL Statistics`,
    description:
      `${player.displayName} played ${player.games} VFL/AFL games (${span}), `
      + `kicking ${player.goals} goals with ${player.brownlowVotes} Brownlow votes.`,
    alternates: { canonical: playerPath(player.slug, player.id) },
    openGraph: {
      title: `${player.displayName} — AFL Statistics | AFLDB`,
      type: 'profile',
    },
  };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const parsed = parseEntitySlug(slug);
  if (!parsed) notFound();

  const player = await getPlayer(parsed.id);
  if (!player) notFound();

  // One canonical URL per player: a stale slug redirects to the current one.
  if (parsed.slug !== player.slug) {
    permanentRedirect(playerPath(player.slug, player.id));
  }

  const [clubs, seasons, brownlow, matches, honours] = await Promise.all([
    getPlayerClubs(player.id),
    getPlayerSeasons(player.id),
    getPlayerBrownlow(player.id),
    // Most recent matches only. The full paged log lives at
    // /players/[slug]/matches, which keeps this page free of
    // searchParams and therefore cacheable.
    getPlayerMatches(player.id, { limit: MATCH_PAGE_SIZE, offset: 0 }),
    getPlayerHonours(player.id),
  ]);

  const risingStarNominations = honours.nominations;
  const risingStarWin = risingStarNominations.find((n) => n.isWinner);

  // A player can captain more than one club — Barry Round captained South
  // Melbourne and then Sydney — so captaincies are grouped rather than
  // collapsed onto the first club found.
  const captaincyByClub = honours.captaincies.reduce((acc, c) => {
    const entry = acc.get(c.clubSlug) ?? { name: c.clubName, seasons: [] as number[] };
    entry.seasons.push(c.season);
    acc.set(c.clubSlug, entry);
    return acc;
  }, new Map<string, { name: string; seasons: number[] }>());

  const stillPlaying = player.finalSeason !== null && seasons.at(-1)?.season === player.finalSeason
    && player.finalSeason >= new Date().getUTCFullYear();

  // Disposals were not recorded before 1965, so the career figure is only
  // meaningful alongside the number of games in which it was recorded.
  const partialDisposals =
    player.disposals !== null && player.disposalsRecordedGames < player.games;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/players">Players</Link>
        <span aria-hidden="true">/</span>
        <span>{player.displayName}</span>
      </nav>

      <div className="page-header">
        <h1>{player.displayName}</h1>
        <p className="subtitle">
          {clubs.map((c, i) => (
            <span key={c.clubId}>
              {i > 0 && ' · '}
              <Link href={clubPath(c.clubSlug)}>{c.clubName}</Link>
            </span>
          ))}
          {' · '}
          {formatSpan(player.debutSeason, player.finalSeason, stillPlaying)}
        </p>
        <p className="section-note">
          <Link href={`/players/compare?a=${player.id}`}>Compare with another player →</Link>
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
          <div className="value">{formatNumber(player.brownlowVotes)}</div>
          <div className="label">Brownlow votes</div>
          {player.brownlowMedals > 0 && (
            <div className="note">{player.brownlowMedals}× medallist</div>
          )}
        </div>
        <div className="stat">
          <div className="value">{formatNumber(player.finals)}</div>
          <div className="label">Finals</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(player.premierships)}</div>
          <div className="label">Premierships</div>
        </div>
        <div className="stat">
          <div className="value">{formatStat(player.disposals)}</div>
          <div className="label">Disposals</div>
          {partialDisposals && (
            <div className="note">in {formatNumber(player.disposalsRecordedGames)} recorded games</div>
          )}
        </div>
      </div>

      {partialDisposals && (
        <p className="notice">
          Detailed statistics such as disposals were not recorded for the whole of this
          player’s career. Totals cover only the games in which each statistic was
          collected; “—” means the statistic was not recorded, not zero.
        </p>
      )}

      {/* Career summary --------------------------------------------------- */}
      <section className="section">
        <CollapsibleTable title="Career">
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Debut</th>
                <td>{formatDate(player.debutDate)}</td>
                <th scope="row">Last match</th>
                <td>{formatDate(player.lastMatchDate)}</td>
              </tr>
              <tr>
                <th scope="row">Record</th>
                <td>{player.wins}W – {player.losses}L – {player.draws}D</td>
                <th scope="row">Seasons</th>
                <td>{player.seasonsPlayed}</td>
              </tr>
              <tr>
                <th scope="row">Clubs</th>
                <td>{player.clubsPlayed}</td>
                <th scope="row">Best game (goals)</th>
                <td>{formatStat(player.bestGoalsGame)}</td>
              </tr>
              <tr>
                <th scope="row">Date of birth</th>
                <td>
                  {player.dob
                    ? formatDate(player.dob)
                    : <span className="not-recorded">Not recorded</span>}
                  {/* Sources disagree. The date shown is the one AFLDB
                      already held; the conflict is recorded rather than
                      resolved by picking a winner. */}
                  {player.dobDisputed && (
                    <span
                      className="badge badge-warn"
                      style={{ marginLeft: '0.4rem' }}
                      title="Sources disagree on this date. The existing value is shown pending review."
                    >
                      Disputed
                    </span>
                  )}
                </td>
                <th scope="row">Best game (disposals)</th>
                <td>{formatStat(player.bestDisposalsGame)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>

      {/* Honours ----------------------------------------------------------
          Only honours AFLDB could tie to this player with confidence are
          shown. An award whose source name was ambiguous is held against
          the award, not asserted against a player who may not be him. */}
      {honours.total > 0 && (
        <section className="section">
          <h2>Honours</h2>
          <ul className="honours">
            {honours.hallOfFame && (
              <li>
                <strong>Australian Football Hall of Fame</strong>
                {honours.hallOfFame.inductedYear ? ` — inducted ${honours.hallOfFame.inductedYear}` : ''}
                {honours.hallOfFame.isLegend && (
                  <>
                    {'. '}
                    <strong>Legend</strong>
                    {honours.hallOfFame.legendYear ? ` (${honours.hallOfFame.legendYear})` : ''}
                  </>
                )}
                {' · '}
                <Link href="/hall-of-fame">Hall of Fame</Link>
              </li>
            )}

            {honours.allAustralian.length > 0 && (
              <li>
                <strong>
                  All-Australian ×{honours.allAustralian.length}
                </strong>
                {' — '}
                {honours.allAustralian.map((a, i) => (
                  <span key={a.season}>
                    <Link href={awardSeasonPath('all-australian', a.season)}>{a.season}</Link>
                    {a.isCaptain && ' (c)'}
                    {i < honours.allAustralian.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </li>
            )}

            {honours.awards.map((a) => (
              <li key={a.slug}>
                <strong>
                  <Link href={awardPath(a.slug)}>{a.name}</Link>
                  {a.wins > 1 ? ` ×${a.wins}` : ''}
                </strong>
                {a.competition ? ` (${a.competition})` : ''} — {a.seasons}
              </li>
            ))}

            {risingStarNominations.length > 0 && (
              <li>
                <strong>
                  <Link href={awardPath('rising-star')}>Rising Star</Link>
                  {risingStarWin ? ' winner' : ' nominee'}
                </strong>
                {' — '}
                {risingStarNominations.map((n, i) => (
                  <span key={`${n.season}-${n.roundNumber}`}>
                    <Link href={awardSeasonPath('rising-star', n.season)}>
                      {n.season}
                      {n.roundNumber ? ` R${n.roundNumber}` : ''}
                    </Link>
                    {i < risingStarNominations.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </li>
            )}

            {honours.honourTeams.map((t) => (
              <li key={t.teamName}>
                <strong>
                  <Link href={honourTeamPath(honourTeamSlug(t.teamName))}>{t.teamName}</Link>
                </strong>
                {t.position ? ` — ${t.position}` : ''}
              </li>
            ))}

            {[...captaincyByClub.entries()].map(([slug, entry]) => (
              <li key={slug}>
                <strong>
                  Captain, <Link href={clubPath(slug)}>{entry.name}</Link>
                </strong>
                {' — '}
                {formatSpan(entry.seasons[0], entry.seasons.at(-1)!)}
                {` (${entry.seasons.length} ${entry.seasons.length === 1 ? 'season' : 'seasons'})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Clubs ------------------------------------------------------------ */}
      {clubs.length > 1 && (
        <section className="section">
          <CollapsibleTable title="Clubs">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col" className="num">Games</th>
                  <th scope="col" className="num">Goals</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((c) => (
                  <tr key={c.clubId}>
                    <td><Link href={clubPath(c.clubSlug)}>{c.clubName}</Link></td>
                    <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
                    <td className="num">{formatNumber(c.games)}</td>
                    <td className="num">{formatNumber(c.goals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {/* Season by season -------------------------------------------------- */}
      <section className="section">
        <CollapsibleTable title="Season by season">
        <div className="table-wrap">
          <table>
            <caption>“—” means the statistic was not recorded in that era.</caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Club</th>
                <th scope="col" className="num">GM</th>
                <th scope="col" className="num">W–L–D</th>
                <th scope="col" className="num">G</th>
                <th scope="col" className="num">B</th>
                <th scope="col" className="num">D</th>
                <th scope="col" className="num">M</th>
                <th scope="col" className="num">T</th>
                <th scope="col" className="num">HO</th>
                <th scope="col" className="num">BV</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.season}>
                  <td>
                    <Link href={seasonPath(s.season)}>{s.season}</Link>
                    {s.isPremier && <span className="badge" style={{ marginLeft: '0.3rem' }}>P</span>}
                    {s.seasonStatus === 'in_progress' && (
                      <span className="badge badge-warn" style={{ marginLeft: '0.3rem' }}>
                        In progress
                      </span>
                    )}
                  </td>
                  <td>
                    {s.clubSlug
                      ? <Link href={clubPath(s.clubSlug)}>{s.clubName}</Link>
                      : NOT_RECORDED}
                    {/* A season split across clubs is one row; the club
                        column names the club of most games. */}
                    {s.clubCount > 1 && (
                      <span className="muted"> +{s.clubCount - 1}</span>
                    )}
                  </td>
                  <td className="num">{s.games}</td>
                  <td className="num nowrap">{s.wins}–{s.losses}–{s.draws}</td>
                  <td className="num">{formatStat(s.goals)}</td>
                  <td className="num">{formatStat(s.behinds)}</td>
                  <td className="num">{formatStat(s.disposals)}</td>
                  <td className="num">{formatStat(s.marks)}</td>
                  <td className="num">{formatStat(s.tackles)}</td>
                  <td className="num">{formatStat(s.hitouts)}</td>
                  <td className="num" title={brownlowStatusNote(s.brownlowStatus) ?? undefined}>
                    {formatBrownlow(s.brownlowVotes, s.brownlowStatus)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>

      {/* Brownlow --------------------------------------------------------- */}
      {brownlow.length > 0 && (
        <section className="section">
          <p className="section-note">
            Season vote totals from the official count, available from 1924.
          </p>
          <CollapsibleTable title="Brownlow Medal">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="num">Votes</th>
                  <th scope="col" className="num">Rank</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {brownlow.map((b) => (
                  <tr key={b.season}>
                    <td><Link href={`/brownlow/${b.season}`}>{b.season}</Link></td>
                    <td className="num">{b.votes}</td>
                    <td className="num">{b.voteRank ?? '—'}</td>
                    <td>
                      {b.isWinner && <strong>Winner</strong>}
                      {b.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        </section>
      )}

      {/* Match log -------------------------------------------------------- */}
      <section className="section">
        <CollapsibleTable title="Match log">
        <div className="table-wrap">
          <table>
            <caption>
              {matches.total > MATCH_PAGE_SIZE
                ? `Most recent ${MATCH_PAGE_SIZE} of ${formatNumber(matches.total)} matches`
                : `${formatNumber(matches.total)} matches`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Rd</th>
                <th scope="col">Opponent</th>
                <th scope="col">Res</th>
                <th scope="col" className="num">Score</th>
                <th scope="col" className="num">G</th>
                <th scope="col" className="num">B</th>
                <th scope="col" className="num">K</th>
                <th scope="col" className="num">HB</th>
                <th scope="col" className="num">D</th>
                <th scope="col" className="num">M</th>
                <th scope="col" className="num">T</th>
                <th scope="col" className="num">BV</th>
              </tr>
            </thead>
            <tbody>
              {matches.rows.map((m) => (
                <tr key={m.matchId}>
                  <td className="nowrap">
                    <Link href={matchPath(m.matchId)}>{formatDate(m.matchDate)}</Link>
                  </td>
                  <td className="nowrap">
                    {m.season} {formatRoundShort(m.roundType, m.roundNumber)}
                  </td>
                  <td className="wide">
                    <Link href={clubPath(m.opponentSlug)}>{m.opponentName}</Link>
                  </td>
                  <td className={`result-${m.outcome}`}>{m.outcome}</td>
                  <td className="num nowrap">{m.pointsFor}–{m.pointsAgainst}</td>
                  <td className="num">{formatStat(m.goals)}</td>
                  <td className="num">{formatStat(m.behinds)}</td>
                  <td className="num">{formatStat(m.kicks)}</td>
                  <td className="num">{formatStat(m.handballs)}</td>
                  <td className="num">{formatStat(m.disposals)}</td>
                  <td className="num">{formatStat(m.marks)}</td>
                  <td className="num">{formatStat(m.tackles)}</td>
                  <td className="num">{formatStat(m.brownlowVotes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>

        {matches.total > MATCH_PAGE_SIZE && (
          <p style={{ marginTop: '0.75rem' }}>
            <Link className="btn btn-secondary"
                  href={`${playerPath(player.slug, player.id)}/matches`}>
              View all {formatNumber(matches.total)} matches →
            </Link>
          </p>
        )}
      </section>
    </>
  );
}
