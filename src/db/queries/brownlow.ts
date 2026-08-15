import 'server-only';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

/**
 * Brownlow Medal queries.
 *
 * Totals come from `brownlow_season_votes`, the authoritative season
 * count, never from summing per-game votes — those exist only for
 * 1931-1934 and 1984 onward, so a sum would understate most careers.
 */

export type BrownlowWinnerRow = {
  season: number;
  playerId: number;
  slug: string;
  displayName: string;
  votes: number;
  clubName: string | null;
  clubSlug: string | null;
};

export const BROWNLOW_WINNER_FILTER_COLUMNS: Record<string, string> = {
  season: 'b.season',
  votes: 'b.votes',
};

/**
 * Winners, with the club each represented that season.
 *
 * The club is read from `player_season_stats`, not from
 * `brownlow_season_votes.club_id`: that column exists but is unpopulated
 * for all 112 winners, so joining it would render every club as an em
 * dash and make a club filter match nothing. The player-season grain is
 * also the right one — a Brownlow is won across a season, and for a
 * player who transferred mid-year `primary_club_id` names the club of
 * most games rather than picking one arbitrarily.
 */
export async function getBrownlowWinners(filters: {
  q?: string;
  club?: string;
  ranges?: FilterValues;
} = {}): Promise<BrownlowWinnerRow[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, BROWNLOW_WINNER_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`p.display_name ILIKE ${containsPattern(filters.q)}`);
  if (filters.club) conditions.push(sql`cl.slug = ${filters.club}`);
  const where = allOf(conditions);

  return sql<BrownlowWinnerRow[]>`
    SELECT b.season, p.id AS "playerId", p.slug,
           p.display_name AS "displayName", b.votes,
           cl.name AS "clubName", cl.slug AS "clubSlug"
      FROM brownlow_season_votes b
      JOIN players p ON p.id = b.player_id
      LEFT JOIN player_season_stats ps
        ON ps.player_id = b.player_id AND ps.season = b.season
      LEFT JOIN clubs cl ON cl.id = COALESCE(b.club_id, ps.primary_club_id)
     WHERE b.is_winner AND ${where}
     ORDER BY b.season DESC, p.sort_name
  `;
}

export type BrownlowLeaderRow = {
  rank: number;
  playerId: number;
  slug: string;
  displayName: string;
  votes: number;
  medals: number;
  games: number;
};

export const BROWNLOW_LEADER_FILTER_COLUMNS: Record<string, string> = {
  lvotes: 'r.votes',
  lmedals: 'r.medals',
  lgames: 'r.games',
};

/**
 * Career vote leaders.
 *
 * The filter keys are prefixed `l` because this table and the winners
 * table share one URL: unprefixed `votes` belongs to the winners panel,
 * and two panels writing the same parameter would move each other's
 * controls.
 *
 * Rank is computed over every player with a vote and the filters applied
 * outside that subquery, for the reason the record boards state: a
 * narrowed leaderboard must show real positions rather than renumbering
 * whoever survives the filter into an all-time lead they do not hold.
 */
export async function getBrownlowCareerLeaders(filters: {
  q?: string;
  ranges?: FilterValues;
  limit: number;
} = { limit: 25 }): Promise<{ rows: BrownlowLeaderRow[]; total: number }> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, BROWNLOW_LEADER_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`r."displayName" ILIKE ${containsPattern(filters.q)}`);
  const where = allOf(conditions);

  const rows = await sql<(BrownlowLeaderRow & { total: string })[]>`
    WITH ranked AS (
      SELECT rank() OVER (ORDER BY c.brownlow_votes DESC)::int AS rank,
             p.id AS "playerId", p.slug, p.display_name AS "displayName",
             p.sort_name AS "sortName",
             c.brownlow_votes AS votes, c.brownlow_medals AS medals, c.games
        FROM player_career_stats c
        JOIN players p ON p.id = c.player_id
       WHERE c.brownlow_votes > 0
    )
    SELECT r.rank, r."playerId", r.slug, r."displayName",
           r.votes, r.medals, r.games,
           count(*) OVER () AS total
      FROM ranked r
     WHERE ${where}
     ORDER BY r.votes DESC, r."sortName"
     LIMIT ${filters.limit}
  `;

  return { rows, total: rows.length > 0 ? Number(rows[0].total) : 0 };
}
