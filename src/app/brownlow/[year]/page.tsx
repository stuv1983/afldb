import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { sql } from '@/db/client';
import { formatNumber, playerPath, seasonPath } from '@/lib/format';
import { parseSeason } from '@/lib/params';

export const revalidate = 3600;

/** One page per season that recorded votes (1924 onwards). */
export async function generateStaticParams() {
  const rows = await sql<{ season: number }[]>`
    SELECT DISTINCT season FROM brownlow_season_votes ORDER BY season
  `;
  return rows.map((r) => ({ year: String(r.season) }));
}

async function getCount(year: number) {
  return sql<{
    playerId: number; slug: string; displayName: string;
    votes: number; voteRank: number | null; isWinner: boolean;
    isIneligible: boolean; games: number | null;
  }[]>`
    SELECT p.id AS "playerId", p.slug, p.display_name AS "displayName",
           b.votes, b.vote_rank AS "voteRank", b.is_winner AS "isWinner",
           b.is_ineligible AS "isIneligible", b.games
      FROM brownlow_season_votes b
      JOIN players p ON p.id = b.player_id
     WHERE b.season = ${year} AND b.votes > 0
     ORDER BY b.votes DESC, p.sort_name
  `;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  const parsed = parseSeason(year);
  if (!parsed) return { title: 'Brownlow count not found' };
  return {
    title: `${parsed} Brownlow Medal`,
    description: `Full ${parsed} Brownlow Medal vote count.`,
    alternates: { canonical: `/brownlow/${parsed}` },
  };
}

export default async function BrownlowYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const parsed = parseSeason(year);
  if (!parsed) notFound();

  const rows = await getCount(parsed);
  if (rows.length === 0) notFound();

  const winner = rows.find((r) => r.isWinner);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/brownlow">Brownlow</Link>
        <span aria-hidden="true">/</span>
        <span>{parsed}</span>
      </nav>

      <div className="page-header">
        <h1>{parsed} Brownlow Medal</h1>
        <p className="subtitle">
          {winner ? (
            <>
              Won by{' '}
              <Link href={playerPath(winner.slug, winner.playerId)}>{winner.displayName}</Link>
              {' '}with {winner.votes} votes ·{' '}
            </>
          ) : null}
          <Link href={seasonPath(parsed)}>{parsed} season</Link>
        </p>
      </div>

      <div className="table-wrap">
        <table>
          <caption>{rows.length} players polled votes</caption>
          <thead>
            <tr>
              <th scope="col" className="num">Rank</th>
              <th scope="col">Player</th>
              <th scope="col" className="num">Votes</th>
              <th scope="col" className="num">Games</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId}>
                <td className="num">{row.voteRank ?? '—'}</td>
                <td className="wide">
                  <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                </td>
                <td className="num"><strong>{row.votes}</strong></td>
                <td className="num">{formatNumber(row.games)}</td>
                <td>
                  {row.isWinner && <strong>Winner</strong>}
                  {row.isIneligible && <span className="badge badge-warn">Ineligible</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
