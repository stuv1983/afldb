import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { JsonLd } from '@/components/JsonLd';
import { SortableTable } from '@/components/SortableTable';
import { sql } from '@/db/client';
import { formatNumber, playerPath, seasonPath } from '@/lib/format';
import { parseSeason } from '@/lib/params';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { itemListSchema } from '@/lib/structured-data';

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
  if (!parsed) return notFoundMetadata('Brownlow count');

  // The winner is named in the description because it is what the query
  // "2024 Brownlow Medal" is asking for, and it is read from the same
  // official season count the page renders — not derived from per-game
  // votes, which exist only for 1931–1934 and 1984 onwards and would give a
  // different, wrong answer for most seasons.
  const rows = await getCount(parsed);
  const winners = rows.filter((r) => r.isWinner);
  const won = winners.length === 0
    ? ''
    : ` Won by ${winners.map((w) => w.displayName).join(' and ')}`
      + ` with ${winners[0].votes} votes.`;

  return pageMetadata({
    title: `${parsed} Brownlow Medal — Winner, Votes & Leaderboard`,
    description:
      `The full ${parsed} Brownlow Medal vote count: every player to poll, `
      + `their vote total and finishing position.${won}`,
    path: `/brownlow/${parsed}`,
  });
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

  // 2003 was shared by Buckley, Goodes and Ricciuto, and several earlier
  // counts were shared too. Taking the first winner named only one of them.
  const winners = rows.filter((r) => r.isWinner);

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Awards', href: '/awards' },
        { label: 'Brownlow Medal', href: '/brownlow' },
        { label: String(parsed) },
      ]} />

      {/* The count IS the ranking, so it is described as one. Taken from
          `brownlow_season_votes` — the official season count — which is the
          same authority the career totals use. Per-game votes exist for only
          part of the record and are never summed into a season here. */}
      <JsonLd data={itemListSchema({
        name: `${parsed} Brownlow Medal vote count`,
        path: `/brownlow/${parsed}`,
        description: `Every player to poll a Brownlow Medal vote in ${parsed}, by vote total.`,
        items: rows.map((r) => ({
          name: r.displayName,
          path: playerPath(r.slug, r.playerId),
        })),
      })} />

      <div className="page-header">
        <h1>{parsed} Brownlow Medal</h1>
        <p className="subtitle">
          {winners.length > 0 ? (
            <>
              {winners.length > 1 ? 'Shared by ' : 'Won by '}
              {winners.map((w, i) => (
                <span key={w.playerId}>
                  <Link href={playerPath(w.slug, w.playerId)}>{w.displayName}</Link>
                  {i < winners.length - 2 ? ', ' : i === winners.length - 2 ? ' and ' : ''}
                </span>
              ))}
              {' '}with {winners[0].votes} votes ·{' '}
            </>
          ) : null}
          <Link href={seasonPath(parsed)}>{parsed} season</Link>
        </p>
      </div>

      <CollapsibleTable title="Full vote count">
      <div className="table-wrap">
        <SortableTable
          defaultSort="rank"
          defaultDir="asc"
          caption={`${rows.length} players polled votes`}
          columns={[
            { key: 'rank', label: 'Rank', sortType: 'number', className: 'num' },
            { key: 'player', label: 'Player', sortType: 'text' },
            { key: 'votes', label: 'Votes', sortType: 'number', className: 'num' },
            { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
            { key: 'status', label: '', sortType: 'text' },
          ]}
          items={rows.map((row) => ({
            id: String(row.playerId),
            values: {
              rank: row.voteRank ?? 9999,
              player: row.displayName,
              votes: row.votes,
              games: row.games ?? 0,
              status: row.isWinner ? 'Winner' : row.isIneligible ? 'Ineligible' : '',
            },
            element: (
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
            ),
          }))}
        />
      </div>
      </CollapsibleTable>
    </>
  );
}
