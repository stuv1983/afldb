import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  getAflwMatch,
  getAflwMatchPlayers,
  getAflwMatchScoring,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwMatchPath,
  aflwPlayerPath,
  aflwSeasonPath,
  formatDateLong,
  formatNumber,
  formatRound,
  formatScore,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const match = await getAflwMatch(decodeURIComponent(key));
  if (!match) return { title: 'Match not found' };
  return {
    title: `${match.homeClubName} v ${match.awayClubName}, ${match.seasonLabel} — AFLW`,
    description:
      `AFLW: ${match.homeClubName} ${match.homeScore} v ${match.awayClubName} `
      + `${match.awayScore} at ${match.venueName}.`,
    alternates: { canonical: aflwMatchPath(match.matchKey) },
  };
}

const PERIOD_LABELS = ['First quarter', 'Second quarter', 'Third quarter', 'Fourth quarter'];

export default async function AflwMatchPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: rawKey } = await params;
  const matchKey = decodeURIComponent(rawKey);

  // The team sheet and the scoring events are keyed by the match key, not
  // by anything on the match row, so all three run together.
  const [match, players, scoring] = await Promise.all([
    getAflwMatch(matchKey),
    getAflwMatchPlayers(matchKey),
    getAflwMatchScoring(matchKey),
  ]);
  if (!match) notFound();

  const teams = [
    { code: match.homeTeamCode, name: match.homeClubName, score: match.homeScore },
    { code: match.awayTeamCode, name: match.awayClubName, score: match.awayScore },
  ];
  const periods = [...new Set(scoring.map((event) => event.period))].sort();
  // The source names its scorers only up to 2021; from Season Six it
  // names the club alone. Saying which of the two this match is beats
  // rendering a column of blanks.
  const namesScorers = scoring.some((event) => event.playerName !== '');

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <Link href={aflwSeasonPath(match.seasonKey)}>{match.seasonLabel}</Link>
        <span aria-hidden="true">/</span>
        <span>{match.homeClubName} v {match.awayClubName}</span>
      </nav>

      <div className="page-header">
        <h1>{match.homeClubName} v {match.awayClubName}</h1>
        <p className="subtitle">
          {formatDateLong(match.matchDate)}
          {match.matchTime ? ` · ${match.matchTime}` : ''}
          {' · '}
          {formatRound(match.roundType, match.roundNumber, match.roundCode)}
          {' · '}{match.venueName}
          {match.weatherRaw ? ` · ${match.weatherRaw}` : ''}
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">
            {formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}
          </div>
          <div className="label">
            <Link href={aflwClubPath(match.homeTeamCode)}>{match.homeClubName}</Link>
          </div>
        </div>
        <div className="stat">
          <div className="value">
            {formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}
          </div>
          <div className="label">
            <Link href={aflwClubPath(match.awayTeamCode)}>{match.awayClubName}</Link>
          </div>
        </div>
        <div className="stat">
          <div className="value">
            {match.result === 'draw' ? 'Draw' : `${match.margin}`}
          </div>
          <div className="label">
            {match.result === 'draw' ? 'Result' : 'Margin (points)'}
          </div>
        </div>
      </div>

      <p className="notice">
        Attendance and umpires are not published by this source, so they are absent
        rather than recorded as zero.
      </p>

      {teams.map((team) => (
        <section className="section" key={team.code}>
          <CollapsibleTable
            title={`${team.name} — team sheet`}
            note={`${players.filter((p) => p.teamCode === team.code).length} players`}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="num">#</th>
                    <th scope="col">Player</th>
                    <th scope="col">Pos</th>
                    <th scope="col" className="num">G</th>
                    <th scope="col" className="num">B</th>
                    <th scope="col" className="num">K</th>
                    <th scope="col" className="num">H</th>
                    <th scope="col" className="num">D</th>
                    <th scope="col" className="num">CP</th>
                    <th scope="col" className="num">M</th>
                    <th scope="col" className="num">T</th>
                    <th scope="col" className="num">HO</th>
                    <th scope="col" className="num">Metres</th>
                    <th scope="col" className="num">FP</th>
                  </tr>
                </thead>
                <tbody>
                  {players
                    .filter((player) => player.teamCode === team.code)
                    .map((player) => (
                      <tr key={player.playerSlug}>
                        <td className="num">{player.jumperNumber}</td>
                        <td className="wide">
                          <Link href={aflwPlayerPath(player.playerSlug)}>
                            {player.playerName}
                          </Link>
                        </td>
                        <td className="muted">{player.position}</td>
                        <td className="num">{player.goals}</td>
                        <td className="num">{player.behinds}</td>
                        <td className="num">{player.kicks}</td>
                        <td className="num">{player.handballs}</td>
                        <td className="num">{player.disposals}</td>
                        <td className="num">{player.contested}</td>
                        <td className="num">{player.marks}</td>
                        <td className="num">{player.tackles}</td>
                        <td className="num">{player.hitouts}</td>
                        <td className="num">{formatNumber(player.metresGained)}</td>
                        <td className="num">{player.fantasyPoints}</td>
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
          title="Scoring progression"
          note={`${scoring.length} scores`}
          defaultOpen={false}
        >
          <div className="table-wrap">
            <table>
              <caption>
                {namesScorers
                  ? 'Every score in order, as published.'
                  : 'Every score in order. This source stops naming its scorers after '
                    + '2021 and names only the club, so the scorer column is empty by '
                    + 'omission rather than unrecorded.'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Qtr</th>
                  <th scope="col" className="num">Clock</th>
                  <th scope="col">Club</th>
                  <th scope="col">Score</th>
                  {namesScorers && <th scope="col">Scorer</th>}
                  <th scope="col" className="num">Progressive</th>
                </tr>
              </thead>
              <tbody>
                {scoring.map((event) => (
                  <tr key={event.eventSeq}>
                    <td className="nowrap">
                      {PERIOD_LABELS[event.period - 1] ?? `Period ${event.period}`}
                    </td>
                    <td className="num nowrap">{event.clock}</td>
                    <td className="wide">
                      <Link href={aflwClubPath(event.teamCode)}>{event.clubName}</Link>
                    </td>
                    <td className="nowrap">{event.eventType}</td>
                    {namesScorers && (
                      <td className="wide">
                        {event.playerName || <span className="not-recorded">—</span>}
                      </td>
                    )}
                    <td className="num nowrap">
                      {event.homeGoals}.{event.homeBehinds} –{' '}
                      {event.awayGoals}.{event.awayBehinds}
                    </td>
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
