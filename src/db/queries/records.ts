import 'server-only';

import { sql } from '@/db/client';

/**
 * Record leaderboards.
 *
 * Every record carries an explicit definition, stated on the page. Where
 * a statistic was not collected for the whole history, the definition
 * says so: a "most disposals" list cannot be compared across eras when
 * disposals were not recorded before 1965.
 */

export type RecordCategory = {
  slug: string;
  title: string;
  definition: string;
  coverage?: string;
  unit: string;
};

export const RECORD_CATEGORIES: Record<string, RecordCategory> = {
  'most-games': {
    slug: 'most-games',
    title: 'Most Games',
    definition: 'Total VFL/AFL matches played, including finals, across all clubs.',
    unit: 'Games',
  },
  'most-goals': {
    slug: 'most-goals',
    title: 'Most Goals',
    definition: 'Total career goals in VFL/AFL matches, including finals.',
    coverage: 'Goals are recorded for every season from 1897, so this list is complete.',
    unit: 'Goals',
  },
  'most-finals': {
    slug: 'most-finals',
    title: 'Most Finals',
    definition: 'Matches played in an elimination, qualifying, semi, preliminary or grand final.',
    unit: 'Finals',
  },
  'most-premierships': {
    slug: 'most-premierships',
    title: 'Most Premierships',
    definition: 'Grand finals played in and won.',
    unit: 'Premierships',
  },
  'most-brownlow-votes': {
    slug: 'most-brownlow-votes',
    title: 'Most Brownlow Votes',
    definition: 'Career Brownlow Medal votes, summed from the official season counts.',
    coverage:
      'The Brownlow Medal was first awarded in 1924, so players who finished before then '
      + 'have no votes. Totals come from the official season counts rather than from '
      + 'per-game votes, which exist only for 1931–1934 and 1984–2025.',
    unit: 'Votes',
  },
  'most-goals-in-a-game': {
    slug: 'most-goals-in-a-game',
    title: 'Most Goals in a Match',
    definition: 'Highest goals scored by one player in a single VFL/AFL match.',
    coverage: 'Goals are recorded for every season from 1897.',
    unit: 'Goals',
  },
  'most-disposals-in-a-game': {
    slug: 'most-disposals-in-a-game',
    title: 'Most Disposals in a Match',
    definition: 'Highest disposals recorded for one player in a single match.',
    coverage:
      'Disposals were not recorded before 1965. Matches before then are absent from this '
      + 'list because the statistic was not collected, not because no disposals occurred.',
    unit: 'Disposals',
  },
  'most-goals-in-a-season': {
    slug: 'most-goals-in-a-season',
    title: 'Most Goals in a Season',
    definition: 'Highest goals by one player for one club in a single season, including finals.',
    unit: 'Goals',
  },
};

export type CareerRecordRow = {
  rank: number;
  playerId: number;
  slug: string;
  displayName: string;
  value: number;
  games: number;
  debutSeason: number | null;
  finalSeason: number | null;
  clubNames: string | null;
};

const CAREER_COLUMNS: Record<string, string> = {
  'most-games': 'c.games',
  'most-goals': 'c.goals',
  'most-finals': 'c.finals',
  'most-premierships': 'c.premierships',
  'most-brownlow-votes': 'c.brownlow_votes',
};

export async function getCareerRecord(
  category: string,
  limit = 100,
): Promise<CareerRecordRow[]> {
  // Column comes from a fixed map, never from the URL.
  const column = CAREER_COLUMNS[category];
  if (!column) return [];

  return sql<CareerRecordRow[]>`
    SELECT rank() OVER (ORDER BY ${sql.unsafe(column)} DESC)::int AS rank,
           p.id AS "playerId", p.slug, p.display_name AS "displayName",
           ${sql.unsafe(column)} AS value,
           c.games,
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
              FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
             WHERE pc.player_id = p.id) AS "clubNames"
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${sql.unsafe(column)} > 0
     ORDER BY ${sql.unsafe(column)} DESC, p.sort_name
     LIMIT ${limit}
  `;
}

export type MatchRecordRow = {
  rank: number;
  playerId: number;
  slug: string;
  displayName: string;
  value: number;
  matchId: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  matchDate: Date;
  clubName: string;
  opponentName: string;
};

export async function getMatchRecord(
  category: string,
  limit = 50,
): Promise<MatchRecordRow[]> {
  const column = category === 'most-goals-in-a-game' ? 's.goals'
    : category === 'most-disposals-in-a-game' ? 's.disposals'
    : null;
  if (!column) return [];

  return sql<MatchRecordRow[]>`
    SELECT rank() OVER (ORDER BY ${sql.unsafe(column)} DESC)::int AS rank,
           p.id AS "playerId", p.slug, p.display_name AS "displayName",
           ${sql.unsafe(column)} AS value,
           m.id AS "matchId", m.season,
           m.round_type AS "roundType", m.round_number AS "roundNumber",
           m.match_date AS "matchDate",
           cl.name AS "clubName", opp.name AS "opponentName"
      FROM player_match_stats s
      JOIN players p ON p.id = s.player_id
      JOIN matches m ON m.id = s.match_id
      JOIN clubs  cl ON cl.id = s.club_id
      JOIN clubs opp ON opp.id = CASE WHEN m.home_club_id = s.club_id
                                      THEN m.away_club_id ELSE m.home_club_id END
     WHERE ${sql.unsafe(column)} IS NOT NULL
     ORDER BY ${sql.unsafe(column)} DESC, m.match_date
     LIMIT ${limit}
  `;
}

export type SeasonRecordRow = {
  rank: number;
  playerId: number;
  slug: string;
  displayName: string;
  value: number;
  season: number;
  clubName: string;
  clubSlug: string;
  games: number;
};

export async function getSeasonRecord(limit = 50): Promise<SeasonRecordRow[]> {
  return sql<SeasonRecordRow[]>`
    SELECT rank() OVER (ORDER BY s.goals DESC)::int AS rank,
           p.id AS "playerId", p.slug, p.display_name AS "displayName",
           s.goals AS value, s.season,
           cl.name AS "clubName", cl.slug AS "clubSlug", s.games
      FROM player_season_stats s
      JOIN players p ON p.id = s.player_id
      JOIN clubs  cl ON cl.id = s.club_id
     WHERE s.goals IS NOT NULL
     ORDER BY s.goals DESC, s.season
     LIMIT ${limit}
  `;
}
