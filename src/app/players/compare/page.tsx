import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { PlayerPicker } from '@/components/PlayerPicker';
import { getPlayerHonours } from '@/db/queries/awards';
import {
  getBestSingleGame,
  getHeadToHeadMatches,
  getPlayerOverlapSummary,
  type BestSingleGame,
  type HeadToHeadRelationship,
} from '@/db/queries/player-compare';
import { getPlayer, type PlayerProfile } from '@/db/queries/players';
import {
  clubPath,
  formatAverage,
  formatDate,
  formatNumber,
  formatSpan,
  formatStat,
  NOT_RECORDED,
  playerPath,
} from '@/lib/format';
import { firstValue, parseIntInRange } from '@/lib/params';
import { comparableStats, eraGaps, ERA_LIMITED_STATS, type EraLimitedStat } from '@/lib/player-compare';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Compare players',
  description: 'Compare two VFL/AFL players’ careers side by side, from any club or era, and see every match they shared.',
  alternates: { canonical: '/players/compare' },
};

type Basis = 'total' | 'per_game' | 'best';

const STAT_LABELS: Record<EraLimitedStat, string> = {
  behinds: 'Behinds',
  kicks: 'Kicks',
  handballs: 'Handballs',
  disposals: 'Disposals',
  marks: 'Marks',
  tackles: 'Tackles',
  hitouts: 'Hitouts',
};

function leader(x: number | null, y: number | null, aLabel: string, bLabel: string): string {
  if (x === null || y === null || x === y) return '—';
  return x > y ? aLabel : bLabel;
}

function perGame(total: number | null, games: number): number | null {
  return total === null || games === 0 ? null : total / games;
}

function compareHref(a: number, b: number, rel: HeadToHeadRelationship, basis: Basis): string {
  return `/players/compare?a=${a}&b=${b}&rel=${rel}&basis=${basis}`;
}

export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const aId = parseIntInRange(firstValue(params.a), 1, 2_147_483_647);
  const bId = parseIntInRange(firstValue(params.b), 1, 2_147_483_647);
  const relParam = firstValue(params.rel);
  const rel: HeadToHeadRelationship = relParam === 'teammates' || relParam === 'opponents' ? relParam : 'all';
  const basisParam = firstValue(params.basis);
  const basis: Basis = basisParam === 'per_game' || basisParam === 'best' ? basisParam : 'total';

  const [aPlayer, bPlayer] = await Promise.all([
    aId ? getPlayer(aId) : Promise.resolve(null),
    bId ? getPlayer(bId) : Promise.resolve(null),
  ]);

  const form = (
    <form action="/players/compare" method="get" className="compare-form" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
        <PlayerPicker
          name="a"
          label="First player"
          initialSelected={aPlayer ? { id: aPlayer.id, label: aPlayer.displayName } : null}
        />
        <span className="muted" aria-hidden="true">vs</span>
        <PlayerPicker
          name="b"
          label="Second player"
          initialSelected={bPlayer ? { id: bPlayer.id, label: bPlayer.displayName } : null}
        />
      </div>
      <input type="hidden" name="rel" value={rel} />
      <input type="hidden" name="basis" value={basis} />
      <button type="submit" className="btn btn-primary">Compare</button>
    </form>
  );

  const header = (
    <div className="page-header">
      <h1>Compare players</h1>
      <p className="subtitle">
        Pick two players from any club or era to compare their careers and see every match
        they shared, as teammates or opponents.
      </p>
    </div>
  );

  if (!aPlayer || !bPlayer) {
    return (
      <>
        {header}
        {form}
        <p className="muted">Pick a player on each side to compare them.</p>
      </>
    );
  }

  if (aPlayer.id === bPlayer.id) {
    return (
      <>
        {header}
        {form}
        <p className="notice">Pick two different players.</p>
      </>
    );
  }

  const [bestA, bestB, overlap, honoursA, honoursB, headToHead] = await Promise.all([
    getBestSingleGame(aPlayer.id),
    getBestSingleGame(bPlayer.id),
    getPlayerOverlapSummary(aPlayer.id, bPlayer.id),
    getPlayerHonours(aPlayer.id),
    getPlayerHonours(bPlayer.id),
    getHeadToHeadMatches(aPlayer.id, bPlayer.id, rel),
  ]);

  const shared = comparableStats(aPlayer, bPlayer);
  const gaps = eraGaps(aPlayer, bPlayer);
  const best: Record<'a' | 'b', BestSingleGame> = { a: bestA, b: bestB };

  function statRow(stat: EraLimitedStat) {
    if (basis === 'total') {
      return { x: aPlayer![stat], y: bPlayer![stat], fmtX: formatStat(aPlayer![stat]), fmtY: formatStat(bPlayer![stat]) };
    }
    if (basis === 'per_game') {
      const x = perGame(aPlayer![stat], aPlayer!.games);
      const y = perGame(bPlayer![stat], bPlayer!.games);
      return { x, y, fmtX: formatAverage(aPlayer![stat], aPlayer!.games), fmtY: formatAverage(bPlayer![stat], bPlayer!.games) };
    }
    return { x: best.a[stat], y: best.b[stat], fmtX: formatStat(best.a[stat]), fmtY: formatStat(best.b[stat]) };
  }

  const careerShape: { label: string; x: number; y: number }[] = [
    { label: 'Games', x: aPlayer.games, y: bPlayer.games },
    { label: 'Goals', x: aPlayer.goals, y: bPlayer.goals },
    { label: 'Finals', x: aPlayer.finals, y: bPlayer.finals },
    { label: 'Premierships', x: aPlayer.premierships, y: bPlayer.premierships },
    { label: 'Brownlow votes', x: aPlayer.brownlowVotes, y: bPlayer.brownlowVotes },
    { label: 'Seasons', x: aPlayer.seasonsPlayed, y: bPlayer.seasonsPlayed },
    { label: 'Clubs', x: aPlayer.clubsPlayed, y: bPlayer.clubsPlayed },
  ];

  const totalShared = overlap.together + overlap.against;

  return (
    <>
      {header}
      {form}

      <div className="stat-strip">
        {[aPlayer, bPlayer].map((p) => (
          <div className="stat" key={p.id}>
            <div className="value">
              <Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link>
            </div>
            <div className="label">{formatSpan(p.debutSeason, p.finalSeason)}</div>
            <div className="note">
              {formatNumber(p.games)} games · {formatNumber(p.goals)} goals
            </div>
          </div>
        ))}
      </div>

      <section className="section">
        <h2>Career</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="num">{aPlayer.displayName}</th>
                <th scope="col" className="num">{bPlayer.displayName}</th>
                <th scope="col">Leader</th>
              </tr>
            </thead>
            <tbody>
              {careerShape.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{formatNumber(row.x)}</td>
                  <td className="num">{formatNumber(row.y)}</td>
                  <td className="muted">{leader(row.x, row.y, aPlayer.displayName, bPlayer.displayName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {shared.length > 0 && (
        <section className="section">
          <div className="split-head">
            <h2>Statistics</h2>
          </div>
          <nav aria-label="Comparison basis" style={{ marginBottom: '0.75rem' }}>
            {([['total', 'Career total'], ['per_game', 'Per game'], ['best', 'Best single game']] as const).map(
              ([value, label]) => (
                <Link
                  key={value}
                  href={compareHref(aPlayer.id, bPlayer.id, rel, value)}
                  className="badge"
                  style={{
                    marginRight: '0.3rem',
                    background: basis === value ? 'var(--accent)' : undefined,
                    color: basis === value ? 'var(--text-invert)' : undefined,
                  }}
                  aria-current={basis === value ? 'true' : undefined}
                >
                  {label}
                </Link>
              ),
            )}
          </nav>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Statistic</th>
                  <th scope="col" className="num">{aPlayer.displayName}</th>
                  <th scope="col" className="num">{bPlayer.displayName}</th>
                  <th scope="col">Leader</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((stat) => {
                  const row = statRow(stat);
                  return (
                    <tr key={stat}>
                      <td>{STAT_LABELS[stat]}</td>
                      <td className="num">{row.fmtX}</td>
                      <td className="num">{row.fmtY}</td>
                      <td className="muted">{leader(row.x, row.y, aPlayer.displayName, bPlayer.displayName)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {gaps.length > 0 && (
        <details style={{ marginBottom: '1.5rem' }}>
          <summary>{gaps.length} statistic{gaps.length === 1 ? '' : 's'} not comparable across these eras</summary>
          <ul>
            {gaps.map((g) => {
              const have = g.have === 'a' ? aPlayer : bPlayer;
              const lack = g.have === 'a' ? bPlayer : aPlayer;
              return (
                <li key={g.stat}>
                  {STAT_LABELS[g.stat]}: recorded for {have.displayName} but not for {lack.displayName}
                  ({formatSpan(lack.debutSeason, lack.finalSeason)}) — not comparable.
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <section className="section">
        <h2>Honours</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {[{ player: aPlayer, honours: honoursA }, { player: bPlayer, honours: honoursB }].map(({ player, honours }) => (
            <div key={player.id}>
              <strong>{player.displayName}</strong>
              {honours.total === 0 ? (
                <p className="muted">No linked award or selection rows.</p>
              ) : (
                <ul>
                  {honours.hallOfFame && (
                    <li>Australian Football Hall of Fame{honours.hallOfFame.inductedYear ? ` (${honours.hallOfFame.inductedYear})` : ''}</li>
                  )}
                  {honours.awards.map((a) => (
                    <li key={a.slug}>{a.name}{a.wins > 1 ? ` ×${a.wins}` : ''} — {a.seasons}</li>
                  ))}
                  {honours.allAustralian.length > 0 && (
                    <li>All-Australian ×{honours.allAustralian.length}</li>
                  )}
                  {honours.captaincies.length > 0 && (
                    <li>
                      Captain: {honours.captaincies.map((c) => c.clubName).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                    </li>
                  )}
                  {honours.honourTeams.map((t) => (
                    <li key={t.teamName}>{t.teamName}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Shared matches</h2>
        {totalShared === 0 ? (
          <p className="muted">These two never played in the same match.</p>
        ) : (
          <>
            <div className="stat-strip">
              <div className="stat">
                <div className="value">{formatNumber(overlap.together)}</div>
                <div className="label">As teammates</div>
                {overlap.together > 0 && (
                  <div className="note">{formatSpan(overlap.togetherFrom, overlap.togetherTo)}</div>
                )}
              </div>
              <div className="stat">
                <div className="value">{formatNumber(overlap.against)}</div>
                <div className="label">As opponents</div>
                {overlap.against > 0 && (
                  <div className="note">{formatSpan(overlap.againstFrom, overlap.againstTo)}</div>
                )}
              </div>
            </div>

            <nav aria-label="Relationship" style={{ margin: '0.75rem 0' }}>
              {([['all', 'All'], ['teammates', 'Teammates'], ['opponents', 'Opponents']] as const).map(([value, label]) => (
                <Link
                  key={value}
                  href={compareHref(aPlayer.id, bPlayer.id, value, basis)}
                  className="badge"
                  style={{
                    marginRight: '0.3rem',
                    background: rel === value ? 'var(--accent)' : undefined,
                    color: rel === value ? 'var(--text-invert)' : undefined,
                  }}
                  aria-current={rel === value ? 'true' : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>

            <CollapsibleTable
              title="Match by match"
              note={headToHead.length >= 500 ? 'showing the most recent 500' : `${formatNumber(headToHead.length)} matches`}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Season</th>
                      <th scope="col">Venue</th>
                      <th scope="col">Relationship</th>
                      <th scope="col">{aPlayer.displayName}</th>
                      <th scope="col" className="num">G</th>
                      <th scope="col" className="num">D</th>
                      <th scope="col">{bPlayer.displayName}</th>
                      <th scope="col" className="num">G</th>
                      <th scope="col" className="num">D</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headToHead.map((m) => (
                      <tr key={m.matchId}>
                        <td className="nowrap">
                          <Link href={`/matches/${m.matchId}`}>{formatDate(m.matchDate)}</Link>
                        </td>
                        <td>{m.season}</td>
                        <td className="wide">{m.venueName}</td>
                        <td className={m.relationship === 'teammates' ? 'result-W' : 'muted'}>
                          {m.relationship === 'teammates' ? 'Teammates' : 'Opponents'}
                        </td>
                        <td><Link href={clubPath(m.aClubSlug)}>{m.aClubName}</Link></td>
                        <td className="num">{formatStat(m.aGoals)}</td>
                        <td className="num">{formatStat(m.aDisposals)}</td>
                        <td><Link href={clubPath(m.bClubSlug)}>{m.bClubName}</Link></td>
                        <td className="num">{formatStat(m.bGoals)}</td>
                        <td className="num">{formatStat(m.bDisposals)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleTable>
          </>
        )}
      </section>
    </>
  );
}
