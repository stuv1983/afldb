import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { ReorderableSections } from '@/components/ReorderableSections';
import {
  getMatch,
  getMatchPeriods,
  getMatchPlayers,
  listNotableMatchIds,
} from '@/db/queries/matches';
import {
  clubPath,
  formatAttendance,
  formatDateLong,
  formatRound,
  formatScore,
  formatStat,
  matchPath,
  playerPath,
  seasonPath,
  venuePath,
} from '@/lib/format';

export const revalidate = 3600;

/**
 * Seed the route so it is cached at all (see the note on the player
 * route). Grand finals and recent matches are the ones actually linked
 * to; the other ~16,000 are cached on first request.
 */
export async function generateStaticParams() {
  const matches = await listNotableMatchIds(500);
  return matches.map((m) => ({ id: String(m.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isSafeInteger(matchId)) return { title: 'Match not found' };

  const match = await getMatch(matchId);
  if (!match) return { title: 'Match not found' };

  const round = formatRound(match.roundType, match.roundNumber);
  // Home team first, so the verb has to follow the result rather than
  // being fixed: "defeated by" read backwards on every home win.
  const outcome = match.result === 'draw'
    ? `${match.homeName} ${match.homeScore} drew with ${match.awayName} ${match.awayScore}`
    : match.result === 'home_win'
      ? `${match.homeName} ${match.homeScore} defeated ${match.awayName} ${match.awayScore}`
      : `${match.homeName} ${match.homeScore} defeated by ${match.awayName} ${match.awayScore}`;
  return {
    title: `${match.homeName} v ${match.awayName}, ${round} ${match.season}`,
    description: `${outcome} — ${round}, ${match.season} at ${match.venueName}.`,
    alternates: { canonical: matchPath(match.id) },
  };
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isSafeInteger(matchId) || matchId <= 0) notFound();

  const match = await getMatch(matchId);
  if (!match) notFound();

  const [periods, players] = await Promise.all([
    getMatchPeriods(matchId),
    getMatchPlayers(matchId),
  ]);

  const round = formatRound(match.roundType, match.roundNumber);
  const sides = [
    { clubId: match.homeClubId, name: match.homeName, slug: match.homeSlug,
      goals: match.homeGoals, behinds: match.homeBehinds, score: match.homeScore },
    { clubId: match.awayClubId, name: match.awayName, slug: match.awaySlug,
      goals: match.awayGoals, behinds: match.awayBehinds, score: match.awayScore },
  ];

  // Brownlow votes are only present for 1931-1934 and 1984-2025.
  const hasBrownlow = players.some((p) => p.brownlowVotes !== null);

  // The schema allows periods 1-8 so extra time can be recorded. Render the
  // periods this match actually has: hard-coding four quarters silently drops
  // any period beyond them.
  const lastPeriod = periods.reduce((max, p) => Math.max(max, p.period), 4);
  const periodNumbers = Array.from({ length: lastPeriod }, (_, i) => i + 1);
  const periodLabel = (period: number) =>
    period === lastPeriod ? 'Final' : period <= 4 ? `Q${period}` : `ET${period - 4}`;

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'quarter-by-quarter',
    label: 'Quarter by quarter',
    node: (
      <section className="section">
        <CollapsibleTable title="Quarter by quarter">
        <div className="table-wrap">
          <table>
            <caption>
              Cumulative score at each break, as published.
              {lastPeriod > 4 && ' ET periods are extra time.'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Club</th>
                {periodNumbers.map((period) => (
                  <th key={period} scope="col" className="num">{periodLabel(period)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sides.map((side) => {
                const own = periods.filter((p) => p.clubId === side.clubId);
                return (
                  <tr key={side.clubId}>
                    <td className="wide">
                      <Link href={clubPath(side.slug)}>{side.name}</Link>
                    </td>
                    {periodNumbers.map((q) => {
                      const period = own.find((p) => p.period === q);
                      return (
                        <td key={q} className="num nowrap">
                          {period && period.points !== null
                            ? formatScore(period.goals, period.behinds, period.points)
                            : <span className="not-recorded">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    ),
  });

  for (const side of sides) {
    const squad = players.filter((p) => p.clubId === side.clubId);
    if (squad.length === 0) continue;
    sections.push({
      id: `squad-${side.slug}`,
      label: side.name,
      node: (
        <section className="section">
          <p className="section-note">
            <Link href={clubPath(side.slug)}>{side.name}</Link>
          </p>
          <CollapsibleTable title={side.name}>
          <div className="table-wrap">
            <table>
              <caption>{squad.length} players</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">G</th>
                  <th scope="col" className="num">B</th>
                  <th scope="col" className="num">K</th>
                  <th scope="col" className="num">HB</th>
                  <th scope="col" className="num">D</th>
                  <th scope="col" className="num">M</th>
                  <th scope="col" className="num">T</th>
                  <th scope="col" className="num">HO</th>
                  {hasBrownlow && <th scope="col" className="num">BV</th>}
                </tr>
              </thead>
              <tbody>
                {squad.map((p) => (
                  <tr key={p.playerId}>
                    <td className="wide">
                      <Link href={playerPath(p.slug, p.playerId)}>{p.displayName}</Link>
                    </td>
                    <td className="num">{formatStat(p.goals)}</td>
                    <td className="num">{formatStat(p.behinds)}</td>
                    <td className="num">{formatStat(p.kicks)}</td>
                    <td className="num">{formatStat(p.handballs)}</td>
                    <td className="num">{formatStat(p.disposals)}</td>
                    <td className="num">{formatStat(p.marks)}</td>
                    <td className="num">{formatStat(p.tackles)}</td>
                    <td className="num">{formatStat(p.hitouts)}</td>
                    {hasBrownlow && <td className="num">{formatStat(p.brownlowVotes)}</td>}
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

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/seasons">Seasons</Link>
        <span aria-hidden="true">/</span>
        <Link href={seasonPath(match.season)}>{match.season}</Link>
        <span aria-hidden="true">/</span>
        <span>{round}</span>
      </nav>

      <div className="page-header">
        <div className="eyebrow">{round} · {match.season}</div>
        <h1>{match.homeName} v {match.awayName}</h1>
        <p className="subtitle">
          {formatDateLong(match.matchDate)} ·{' '}
          {match.venueSlug
            ? <Link href={venuePath(match.venueSlug)}>{match.venueName}</Link>
            : match.venueName}
          {match.matchEvent && <> · {match.matchEvent}</>}
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}</div>
          <div className="label">{match.homeName}</div>
        </div>
        <div className="stat">
          <div className="value">{formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}</div>
          <div className="label">{match.awayName}</div>
        </div>
        <div className="stat">
          <div className="value">
            {match.result === 'draw' ? 'Draw' : `${match.margin}`}
          </div>
          <div className="label">
            {match.result === 'draw' ? 'Result' : `${match.winnerName} by`}
          </div>
        </div>
        <div className="stat">
          <div className="value">{formatAttendance(match.attendance)}</div>
          <div className="label">Crowd</div>
        </div>
      </div>

      <ReorderableSections storageKey={`/matches/${match.id}`} sections={sections} />
    </>
  );
}
