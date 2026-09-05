import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { JsonLd } from '@/components/JsonLd';
import { hasFamilyContent, PlayerFamilyCard } from '@/components/PlayerFamilyCard';
import { PlayerCoachingCareer } from '@/components/PlayerCoachingCareer';
import { ReorderableSections } from '@/components/ReorderableSections';
import { SortableTable } from '@/components/SortableTable';
import { getPlayerHonours } from '@/db/queries/awards';
import { getPlayerCoachingCareer } from '@/db/queries/coaches';
import { getPlayerDraftHistory } from '@/db/queries/draft';
import {
  getPlayer,
  getPlayerBrownlow,
  getPlayerClubs,
  getPlayerFamily,
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
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { honourTeamSlug } from '@/lib/slugs';
import { playerSchema } from '@/lib/structured-data';

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
  if (!parsed) return notFoundMetadata('Player');

  const player = await getPlayer(parsed.id);
  if (!player) return notFoundMetadata('Player');

  const span = formatSpan(player.debutSeason, player.finalSeason);
  return pageMetadata({
    title: `${player.displayName} — ${leagueOf(player.finalSeason)} Stats, Games & Career Record`,
    description: careerSentence(player),
    path: playerPath(player.slug, player.id),
    ogType: 'profile',
  });
}

/**
 * Which competition to name for a career, by the season it ended.
 *
 * "AFL stats" is what people search for, but calling Roy Cazaly's record an
 * AFL one would be false — the competition was the VFL until 1990. The title
 * follows the career rather than the search volume, which is the same rule
 * the season pages already apply through `season.league`.
 */
function leagueOf(finalSeason: number | null): 'VFL' | 'AFL' {
  return finalSeason !== null && finalSeason < 1990 ? 'VFL' : 'AFL';
}

/**
 * One factual sentence about a career, from the career totals.
 *
 * Used for the meta description and, verbatim, as the page's opening line —
 * a table of numbers on its own gives a crawler nothing in prose to match a
 * query against, and gives a reader arriving cold no orientation either.
 */
function careerSentence(player: {
  displayName: string;
  games: number;
  goals: number;
  brownlowVotes: number;
  premierships: number;
  debutSeason: number | null;
  finalSeason: number | null;
}): string {
  if (player.games === 0) {
    return `${player.displayName} has not yet appeared in a senior VFL/AFL match. Biography and draft history.`;
  }
  const span = formatSpan(player.debutSeason, player.finalSeason);
  const league = leagueOf(player.finalSeason);

  const clauses = [`kicking ${formatNumber(player.goals)} goals`];
  if (player.premierships > 0) {
    clauses.push(
      `winning ${player.premierships} `
      + `${player.premierships === 1 ? 'premiership' : 'premierships'}`,
    );
  }
  if (player.brownlowVotes > 0) {
    clauses.push(`polling ${formatNumber(player.brownlowVotes)} Brownlow votes`);
  }

  return (
    `${player.displayName} played ${formatNumber(player.games)} ${league} games `
    + `(${span}), ${clauses.join(', ')}. Full season-by-season statistics, `
    + 'match log, honours and Brownlow record.'
  );
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

  const [clubs, seasons, brownlow, matches, honours, draftHistory, family, coachingCareer] =
    await Promise.all([
      getPlayerClubs(player.id),
      getPlayerSeasons(player.id),
      getPlayerBrownlow(player.id),
      // Most recent matches only. The full paged log lives at
      // /players/[slug]/matches, which keeps this page free of
      // searchParams and therefore cacheable.
      getPlayerMatches(player.id, { limit: MATCH_PAGE_SIZE, offset: 0 }),
      getPlayerHonours(player.id),
      getPlayerDraftHistory(player.id),
      getPlayerFamily(player.id),
      getPlayerCoachingCareer(player.id),
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

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'career',
    label: 'Career',
    node: (
      <section className="section">
        {player.games === 0 && (
          <p className="muted" style={{ margin: '0 0 1rem', padding: '0.6rem 0.75rem', background: 'var(--bg-subtle)', borderRadius: '6px' }}>
            This player is currently listed or drafted and has yet to make their senior VFL/AFL match debut.
          </p>
        )}
        <CollapsibleTable title="Career & Biography">
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
                    ? <span>{formatDate(player.dob)}</span>
                    : <span className="not-recorded">Not recorded</span>}
                  {/* Sources disagree. The date shown is the one AFLDB
                      already held; the conflict is recorded rather than
                      resolved by picking a winner. */}
                  {player.dobDisputed && (
                    <span
                      className="badge badge-warn"
                      title="Sources disagree on this date. The existing value is shown pending review."
                    >
                      Disputed
                    </span>
                  )}
                </td>
                <th scope="row">Best game (disposals)</th>
                <td>{formatStat(player.bestDisposalsGame)}</td>
              </tr>
              {(player.heightCm || player.weightKg) && (
                <tr>
                  <th scope="row">Height</th>
                  <td>{player.heightCm ? `${player.heightCm} cm` : <span className="not-recorded">Not recorded</span>}</td>
                  <th scope="row">Weight</th>
                  <td>{player.weightKg ? `${player.weightKg} kg` : <span className="not-recorded">Not recorded</span>}</td>
                </tr>
              )}
              {player.notes && (
                <tr>
                  <th scope="row">Notes</th>
                  <td colSpan={3} className="wide">{player.notes}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  if (hasFamilyContent(family)) {
    sections.push({
      id: 'family',
      label: 'Family',
      node: <PlayerFamilyCard playerId={player.id} family={family} />,
    });
  }

  if (draftHistory.length > 0) {
    sections.push({
      id: 'draft',
      label: 'Draft & recruitment',
      node: (
        <section className="section">
          <CollapsibleTable title="Draft & recruitment">
            <div className="table-wrap">
              <SortableTable
                defaultSort="year"
                defaultDir="desc"
                columns={[
                  { key: 'year', label: 'Year', sortType: 'number', className: 'num' },
                  { key: 'pick', label: 'Pick', sortType: 'number', className: 'num' },
                  { key: 'type', label: 'Draft type', sortType: 'text', className: 'nowrap' },
                  { key: 'drafted_to', label: 'Drafted to', sortType: 'text' },
                  { key: 'from', label: 'Recruited from', sortType: 'text' },
                  { key: 'age', label: 'Draft age', sortType: 'number', className: 'num' },
                  { key: 'notes', label: 'Notes / Details', sortType: 'text' },
                ]}
                items={draftHistory.map((d) => ({
                  id: String(d.id),
                  values: {
                    year: d.draftYear,
                    pick: d.pickNumber ?? 9999,
                    type: d.draftType,
                    drafted_to: d.clubName ?? '',
                    from: d.originClub ?? '',
                    age: d.draftAge ?? -1,
                    notes: d.detail || d.pickNote || '',
                  },
                  element: (
                    <tr key={d.id}>
                      <td className="num">{d.draftYear}</td>
                      <td className="num">{d.pickNumber ?? '—'}</td>
                      <td className="nowrap">{d.draftType}</td>
                      <td>
                        {d.clubSlug ? (
                          <Link href={clubPath(d.clubSlug)}>{d.clubName}</Link>
                        ) : (
                          d.clubName ?? '—'
                        )}
                      </td>
                      <td className="muted">{d.originClub ?? '—'}</td>
                      <td className="num">{d.draftAge ?? '—'}</td>
                      <td className="wide muted">{d.detail || d.pickNote || '—'}</td>
                    </tr>
                  ),
                }))}
              />
            </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  if (honours.total > 0) {
    sections.push({
      id: 'honours',
      label: 'Honours',
      node: (
        <section className="section">
          <h2>Honours</h2>
          <ul className="ruled-list">
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

            {honours.firstKickGoal && (
              <li>
                <strong>
                  <Link href="/records/first-kick-goal">
                    {honours.firstKickGoal.consecutiveGoalKicks > 1
                      ? `Goal with each of their first ${honours.firstKickGoal.consecutiveGoalKicks} VFL/AFL kicks`
                      : 'Goal with their first VFL/AFL kick'}
                  </Link>
                </strong>
                {' — '}
                {honours.firstKickGoal.roundRaw ? `Round ${honours.firstKickGoal.roundRaw}, ` : ''}
                {honours.firstKickGoal.season}
                {honours.firstKickGoal.clubSlug && honours.firstKickGoal.clubName && (
                  <>
                    {' · '}
                    <Link href={clubPath(honours.firstKickGoal.clubSlug)}>{honours.firstKickGoal.clubName}</Link>
                  </>
                )}
                {honours.firstKickGoal.opponentSlug && honours.firstKickGoal.opponentName && (
                  <>
                    {' v '}
                    <Link href={clubPath(honours.firstKickGoal.opponentSlug)}>{honours.firstKickGoal.opponentName}</Link>
                  </>
                )}
                {/* Both are striking enough to be the point of the entry
                    rather than a footnote, and both are checked against
                    player_career_stats at import rather than taken on the
                    source's word. */}
                {honours.firstKickGoal.noFurtherCareerKicks
                  ? '. The only kick of their career.'
                  : honours.firstKickGoal.noFurtherCareerGoals
                    ? '. The only goal of their career.'
                    : ''}
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
      ),
    });
  }

  if (coachingCareer) {
    sections.push({
      id: 'coaching-career',
      label: 'Coaching Career',
      node: <PlayerCoachingCareer career={coachingCareer} />,
    });
  }

  if (clubs.length > 1) {
    sections.push({
      id: 'clubs',
      label: 'Clubs',
      node: (
        <section className="section">
          <CollapsibleTable title="Clubs">
          <div className="table-wrap">
            <SortableTable
              defaultSort="seasons"
              defaultDir="desc"
              columns={[
                { key: 'club', label: 'Club', sortType: 'text' },
                { key: 'seasons', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
                { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                { key: 'goals', label: 'Goals', sortType: 'number', className: 'num' },
              ]}
              items={clubs.map((c) => ({
                id: String(c.clubId),
                values: {
                  club: c.clubName,
                  seasons: c.firstSeason, // sort by start year
                  games: c.games,
                  goals: c.goals,
                },
                element: (
                  <tr key={c.clubId}>
                    <td><Link href={clubPath(c.clubSlug)}>{c.clubName}</Link></td>
                    <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
                    <td className="num">{formatNumber(c.games)}</td>
                    <td className="num">{formatNumber(c.goals)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  sections.push({
    id: 'season-by-season',
    label: 'Season by season',
    node: (
      <section className="section">
        <CollapsibleTable title="Season by season">
        <div className="table-wrap">
          <SortableTable
            defaultSort="season"
            defaultDir="desc"
            caption="“—” means the statistic was not recorded in that era."
            columns={[
              { key: 'season', label: 'Season', sortType: 'number' },
              { key: 'club', label: 'Club', sortType: 'text' },
              { key: 'gm', label: 'GM', sortType: 'number', className: 'num' },
              { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
              { key: 'g', label: 'G', sortType: 'number', className: 'num' },
              { key: 'b', label: 'B', sortType: 'number', className: 'num' },
              { key: 'd', label: 'D', sortType: 'number', className: 'num' },
              { key: 'm', label: 'M', sortType: 'number', className: 'num' },
              { key: 't', label: 'T', sortType: 'number', className: 'num' },
              { key: 'ho', label: 'HO', sortType: 'number', className: 'num' },
              { key: 'bv', label: 'BV', sortType: 'number', className: 'num' },
            ]}
            items={seasons.map((s) => ({
              id: String(s.season),
              values: {
                season: s.season,
                club: s.clubName ?? '',
                gm: s.games,
                wld: s.wins, // Sort W-L-D by wins
                g: s.goals ?? -1,
                b: s.behinds ?? -1,
                d: s.disposals ?? -1,
                m: s.marks ?? -1,
                t: s.tackles ?? -1,
                ho: s.hitouts ?? -1,
                bv: s.brownlowVotes ?? -1,
              },
              element: (
                <tr key={s.season}>
                  <td>
                    <Link href={seasonPath(s.season)}>{s.season}</Link>
                    {s.isPremier && <span className="badge">P</span>}
                    {s.seasonStatus === 'in_progress' && (
                      <span className="badge badge-warn">In progress</span>
                    )}
                  </td>
                  <td>
                    {s.clubSlug
                      ? <Link href={clubPath(s.clubSlug)}>{s.clubName}</Link>
                      : NOT_RECORDED}
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
              ),
            }))}
          />
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  if (brownlow.length > 0) {
    sections.push({
      id: 'brownlow-medal',
      label: 'Brownlow Medal',
      node: (
        <section className="section">
          <p className="section-note">
            Season vote totals from the official count, available from 1924.
          </p>
          <CollapsibleTable title="Brownlow Medal">
          <div className="table-wrap">
            <SortableTable
              defaultSort="season"
              defaultDir="desc"
              columns={[
                { key: 'season', label: 'Season', sortType: 'number' },
                { key: 'votes', label: 'Votes', sortType: 'number', className: 'num' },
                { key: 'rank', label: 'Rank', sortType: 'number', className: 'num' },
                { key: 'result', label: 'Result', sortType: 'text' },
              ]}
              items={brownlow.map((b) => ({
                id: String(b.season),
                values: {
                  season: b.season,
                  votes: b.votes,
                  rank: b.voteRank ?? 999,
                  result: b.isWinner ? 'Winner' : (b.isIneligible ? 'Ineligible' : ''),
                },
                element: (
                  <tr key={b.season}>
                    <td><Link href={`/brownlow/${b.season}`}>{b.season}</Link></td>
                    <td className="num">{b.votes}</td>
                    <td className="num">{b.voteRank ?? '—'}</td>
                    <td>
                      {b.isWinner && <strong>Winner</strong>}
                      {b.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                    </td>
                  </tr>
                ),
              }))}
            />
          </div>
          </CollapsibleTable>
        </section>
      ),
    });
  }

  sections.push({
    id: 'match-log',
    label: 'Match log',
    node: (
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
    ),
  });

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Players', href: '/players' },
        { label: player.displayName },
      ]} />

      <JsonLd data={playerSchema({
        name: player.displayName,
        path: playerPath(player.slug, player.id),
        dob: player.dob,
        dobDisputed: player.dobDisputed,
        debutSeason: player.debutSeason,
        finalSeason: player.finalSeason,
        clubs: clubs.map((c) => ({ name: c.clubName, slug: c.clubSlug })),
        description: careerSentence(player),
      })} />

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
        {/* The same sentence the meta description carries. A page whose
            entire body is figures gives a query nothing in prose to match,
            and gives a reader arriving from one nothing to read first. */}
        <p className="lede">{careerSentence(player)}</p>
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

      <ReorderableSections
        storageKey={playerPath(player.slug, player.id)}
        sections={sections}
      />
    </>
  );
}
