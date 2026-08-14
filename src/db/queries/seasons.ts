import 'server-only';

import { sql } from '@/db/client';

export type SeasonSummary = {
  year: number;
  league: string;
  isComplete: boolean;
  firstMatchDate: Date | null;
  lastMatchDate: Date | null;
  matchCount: number | null;
  clubCount: number | null;
  premierName: string | null;
  premierSlug: string | null;
};

export async function listSeasons(): Promise<SeasonSummary[]> {
  return sql<SeasonSummary[]>`
    SELECT s.year, s.league, s.is_complete AS "isComplete",
           s.first_match_date AS "firstMatchDate",
           s.last_match_date  AS "lastMatchDate",
           s.match_count AS "matchCount", s.club_count AS "clubCount",
           c.name AS "premierName", c.slug AS "premierSlug"
      FROM seasons s
      LEFT JOIN matches gf
             ON gf.season = s.year AND gf.round_type = 'grand_final'
      LEFT JOIN clubs c ON c.id = gf.winner_club_id
     ORDER BY s.year DESC
  `;
}

export async function getSeason(year: number): Promise<SeasonSummary | null> {
  const [row] = await sql<SeasonSummary[]>`
    SELECT s.year, s.league, s.is_complete AS "isComplete",
           s.first_match_date AS "firstMatchDate",
           s.last_match_date  AS "lastMatchDate",
           s.match_count AS "matchCount", s.club_count AS "clubCount",
           c.name AS "premierName", c.slug AS "premierSlug"
      FROM seasons s
      LEFT JOIN matches gf
             ON gf.season = s.year AND gf.round_type = 'grand_final'
      LEFT JOIN clubs c ON c.id = gf.winner_club_id
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
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.name AS "clubName", c.slug AS "clubSlug",
           s.goals, s.games
      FROM player_season_stats s
      JOIN players p ON p.id = s.player_id
      JOIN clubs   c ON c.id = s.club_id
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
