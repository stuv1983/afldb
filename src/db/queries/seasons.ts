import 'server-only';

import { cache } from 'react';

import { sql } from '@/db/client';
import { allOf, rangeConditions } from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

export type SeasonSummary = {
  year: number;
  league: string;
  isComplete: boolean;
  /** 'in_progress' | 'complete'. Authoritative; isComplete derives from it. */
  status: string;
  /** Last match date actually loaded — the honest "as at" for a live season. */
  dataThroughDate: Date | null;
  lastLoadedRound: string | null;
  firstMatchDate: Date | null;
  lastMatchDate: Date | null;
  matchCount: number | null;
  clubCount: number | null;
  premierName: string | null;
  premierSlug: string | null;
};

/**
 * The premier join must pick the DECISIVE Grand Final.
 *
 * 1948, 1977 and 2010 each have two Grand Final rows — a draw and its
 * replay. Joining on round_type alone returns both, which duplicates the
 * season and leaves one copy with a null premier. Only the replay decided
 * anything, so the drawn match is excluded.
 */
const PREMIER_JOIN = `
      LEFT JOIN LATERAL (
          SELECT gf.winner_club_id
            FROM matches gf
           WHERE gf.season = s.year
             AND gf.round_type = 'grand_final'
             AND gf.result <> 'draw'
           ORDER BY gf.match_date DESC
           LIMIT 1
      ) gf ON true
      LEFT JOIN clubs c ON c.id = gf.winner_club_id`;

/** Season columns the index may be filtered on. */
export const SEASON_FILTER_COLUMNS: Record<string, string> = {
  year: 's.year',
  matches: 's.match_count',
  clubs: 's.club_count',
};

export type SeasonFilters = {
  league?: string;
  status?: string;
  /** Club slug of the season's premier. */
  premier?: string;
  ranges?: FilterValues;
};

export async function listSeasons(filters: SeasonFilters = {}): Promise<SeasonSummary[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, SEASON_FILTER_COLUMNS)
    : [];
  if (filters.league) conditions.push(sql`s.league = ${filters.league}`);
  if (filters.status) conditions.push(sql`s.status = ${filters.status}`);
  // Premier is read from the decided Grand Final joined below, and only
  // for a completed season — the same rule the projection applies, so the
  // filter can never select a season whose premier column reads "—".
  if (filters.premier) {
    conditions.push(sql`s.status = 'complete' AND c.slug = ${filters.premier}`);
  }
  const where = allOf(conditions);

  return sql<SeasonSummary[]>`
    SELECT s.year, s.league, s.is_complete AS "isComplete",
           s.status, s.data_through_date AS "dataThroughDate",
           s.last_loaded_round AS "lastLoadedRound",
           s.first_match_date AS "firstMatchDate",
           s.last_match_date  AS "lastMatchDate",
           s.match_count AS "matchCount", s.club_count AS "clubCount",
           -- A season still under way has no premier, even if the source
           -- ladder already shows a leader.
           CASE WHEN s.status = 'complete' THEN c.name END AS "premierName",
           CASE WHEN s.status = 'complete' THEN c.slug END AS "premierSlug"
      FROM seasons s
      ${sql.unsafe(PREMIER_JOIN)}
     WHERE ${where}
     ORDER BY s.year DESC
  `;
}

export async function getSeasonLeagues(): Promise<string[]> {
  const rows = await sql<{ league: string }[]>`
    SELECT DISTINCT league FROM seasons ORDER BY league
  `;
  return rows.map((r) => r.league);
}

async function fetchSeason(year: number): Promise<SeasonSummary | null> {
  const [row] = await sql<SeasonSummary[]>`
    SELECT s.year, s.league, s.is_complete AS "isComplete",
           s.status, s.data_through_date AS "dataThroughDate",
           s.last_loaded_round AS "lastLoadedRound",
           s.first_match_date AS "firstMatchDate",
           s.last_match_date  AS "lastMatchDate",
           s.match_count AS "matchCount", s.club_count AS "clubCount",
           CASE WHEN s.status = 'complete' THEN c.name END AS "premierName",
           CASE WHEN s.status = 'complete' THEN c.slug END AS "premierSlug"
      FROM seasons s
      ${sql.unsafe(PREMIER_JOIN)}
     WHERE s.year = ${year}
  `;
  return row ?? null;
}

export type LadderRow = {
  clubId: number;
  clubName: string;
  clubSlug: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  percentage: string | null;
  premiershipPoints: number | null;
  ladderRank: number | null;
  isPremier: boolean;
};

export async function getSeasonLadder(year: number): Promise<LadderRow[]> {
  return sql<LadderRow[]>`
    SELECT cs.club_id AS "clubId", c.name AS "clubName", c.slug AS "clubSlug",
           cs.played, cs.wins, cs.draws, cs.losses,
           cs.points_for AS "pointsFor", cs.points_against AS "pointsAgainst",
           cs.percentage, cs.premiership_points AS "premiershipPoints",
           cs.ladder_rank AS "ladderRank", cs.is_premier AS "isPremier"
      FROM club_seasons cs
      JOIN clubs c ON c.id = cs.club_id
     WHERE cs.season = ${year}
     ORDER BY cs.ladder_rank NULLS LAST, cs.premiership_points DESC
  `;
}

/** Leading goalkickers for a season. */
export async function getSeasonGoalkickers(year: number, limit = 10) {
  return sql<{
    id: number; slug: string; displayName: string;
    clubName: string; clubSlug: string; goals: number; games: number;
  }[]>`
    -- The season's leading goalkickers are ranked on each player's whole
    -- season, so a mid-season transfer is one entry, not two part-seasons.
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.name AS "clubName", c.slug AS "clubSlug",
           s.goals, s.games
      FROM player_season_stats s
      JOIN players p ON p.id = s.player_id
      LEFT JOIN clubs c ON c.id = s.primary_club_id
     WHERE s.season = ${year} AND s.goals IS NOT NULL
     ORDER BY s.goals DESC, s.games
     LIMIT ${limit}
  `;
}

/** Brownlow leaders for a season, from the authoritative source. */
export async function getSeasonBrownlow(year: number, limit = 10) {
  return sql<{
    id: number; slug: string; displayName: string;
    votes: number; isWinner: boolean; isIneligible: boolean;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           b.votes, b.is_winner AS "isWinner", b.is_ineligible AS "isIneligible"
      FROM brownlow_season_votes b
      JOIN players p ON p.id = b.player_id
     WHERE b.season = ${year}
     ORDER BY b.votes DESC, p.sort_name
     LIMIT ${limit}
  `;
}

export async function getSeasonBounds(): Promise<{ min: number; max: number }> {
  const [row] = await sql<{ min: number; max: number }[]>`
    SELECT min(year)::int AS min, max(year)::int AS max FROM seasons
  `;
  return row ?? { min: 1897, max: 1897 };
}

/**
 * Deduplicated per request.
 *
 * generateMetadata and the page body both need this row, and neither can
 * hand it to the other — Next calls them separately. Without React's
 * cache() that is two identical queries for every render of an entity
 * page, doubling the cost of the pages a crawler spends most of its time
 * on. Outside a request scope cache() calls straight through, so the
 * import tools and the test suite are unaffected.
 */
export const getSeason = cache(fetchSeason);
