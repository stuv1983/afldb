import type { Metadata } from 'next';
import Link from 'next/link';

import { sql } from '@/db/client';
import { formatNumber, playerPath } from '@/lib/format';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Brownlow Medal',
  description:
    'Brownlow Medal winners and vote counts from 1924, with career vote leaders.',
  alternates: { canonical: '/brownlow' },
};

async function getWinners() {
  return sql<{
    season: number; playerId: number; slug: string;
    displayName: string; votes: number;
  }[]>`
    SELECT b.season, p.id AS "playerId", p.slug,
           p.display_name AS "displayName", b.votes
      FROM brownlow_season_votes b
      JOIN players p ON p.id = b.player_id
     WHERE b.is_winner
     ORDER BY b.season DESC
  `;
}

async function getCareerLeaders() {
  return sql<{
    playerId: number; slug: string; displayName: string;
    votes: number; medals: number; games: number;
  }[]>`
    SELECT p.id AS "playerId", p.slug, p.display_name AS "displayName",
           c.brownlow_votes AS votes, c.brownlow_medals AS medals, c.games
      FROM player_career_stats c
      JOIN players p ON p.id = c.player_id
     WHERE c.brownlow_votes > 0
     ORDER BY c.brownlow_votes DESC, p.sort_name
     LIMIT 25
  `;
}

export default async function BrownlowPage() {
  const [winners, leaders] = await Promise.all([getWinners(), getCareerLeaders()]);

  return (
    <>
      <div className="page-header">
        <h1>Brownlow Medal</h1>
        <p className="subtitle">
          Awarded to the fairest and best player of the season, first presented in 1924.
        </p>
      </div>

      <p className="notice">
        Vote totals come from the official season counts. Round-by-round votes are
        available from 1984; per-game votes were also published for 1931–1934. For
        the seasons in between, only the season total is on record — an absent
        per-game vote means it was not published, not that no vote was polled.
      </p>

      <section className="section">
        <h2>Career vote leaders</h2>
        <div className="table-wrap">
          <table>
            <caption>Most career Brownlow votes</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">Votes</th>
                <th scope="col" className="num">Medals</th>
                <th scope="col" className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((row, i) => (
                <tr key={row.playerId}>
                  <td className="num">{i + 1}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="num"><strong>{formatNumber(row.votes)}</strong></td>
                  <td className="num">{row.medals > 0 ? row.medals : '—'}</td>
                  <td className="num">{formatNumber(row.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Winners by season</h2>
        <div className="table-wrap">
          <table>
            <caption>{winners.length} medals awarded</caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Winner</th>
                <th scope="col" className="num">Votes</th>
              </tr>
            </thead>
            <tbody>
              {winners.map((row) => (
                <tr key={`${row.season}-${row.playerId}`}>
                  <td><Link href={`/brownlow/${row.season}`}>{row.season}</Link></td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="num">{row.votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
