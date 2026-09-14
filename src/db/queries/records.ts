import 'server-only';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
export {
  RECORD_CATEGORIES,
  getRecordCategory,
  type RecordCategory,
} from '@/lib/home-records';
import type { FilterValues } from '@/search/table-filters';

/**
 * Record leaderboards.
 *
 * Every record carries an explicit definition, stated on the page. Where
 * a statistic was not collected for the whole history, the definition
 * says so: a "most disposals" list cannot be compared across eras when
 * disposals were not recorded before 1965.
 *
 * Filtering a record board does not renumber it. Rank is computed over
 * the whole population in a subquery and the filters are applied outside
 * it, so narrowing to one club shows that club's players at their real
 * positions — 1, 4, 17 — rather than relabelling them 1, 2, 3 and
 * inventing a record nobody holds.
 */

export type RecordFilters = {
  q?: string;
  club?: string;
  ranges?: FilterValues;
};

/** Columns a record board may be narrowed on, by grain. */
export const CAREER_RECORD_FILTER_COLUMNS: Record<string, string> = {
  value: 'r.value',
  games: 'r.games',
  debut: 'r."debutSeason"',
  final: 'r."finalSeason"',
};

export const MATCH_RECORD_FILTER_COLUMNS: Record<string, string> = {
  value: 'r.value',
  season: 'm.season',
};

export const SEASON_RECORD_FILTER_COLUMNS: Record<string, string> = {
  value: 'r.value',
  season: 'r.season',
  games: 'r.games',
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
  filters: RecordFilters = {},
): Promise<CareerRecordRow[]> {
  // Column comes from a fixed map, never from the URL.
  if (!Object.hasOwn(CAREER_COLUMNS, category)) return [];
  const column = CAREER_COLUMNS[category];

  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, CAREER_RECORD_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`r."displayName" ILIKE ${containsPattern(filters.q)}`);
  if (filters.club) {
    conditions.push(sql`
      EXISTS (SELECT 1 FROM player_clubs pc
                JOIN clubs cl ON cl.id = pc.club_id
               WHERE pc.player_id = r."playerId" AND cl.slug = ${filters.club})
    `);
  }
  const where = allOf(conditions);

  // The club list is aggregated after the LIMIT, not inside `ranked`:
  // ranking spans every player with a nonzero total, and gathering club
  // names for all of them would run thousands of aggregations to print a
  // hundred.
  return sql<CareerRecordRow[]>`
    WITH ranked AS (
      SELECT rank() OVER (ORDER BY ${sql.unsafe(column)} DESC)::int AS rank,
             p.id AS "playerId", p.slug, p.display_name AS "displayName",
             p.sort_name AS "sortName",
             ${sql.unsafe(column)} AS value,
             c.games,
             c.debut_season AS "debutSeason", c.final_season AS "finalSeason"
        FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
       WHERE ${sql.unsafe(column)} > 0
    ),
    page AS (
      SELECT r.rank, r."playerId", r.slug, r."displayName", r.value, r.games,
             r."debutSeason", r."finalSeason", r."sortName"
        FROM ranked r
       WHERE ${where}
       ORDER BY r.value DESC, r."sortName"
       LIMIT ${limit}
    )
    SELECT p.rank, p."playerId", p.slug, p."displayName", p.value, p.games,
           p."debutSeason", p."finalSeason",
           (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
              FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
             WHERE pc.player_id = p."playerId") AS "clubNames"
      FROM page p
     ORDER BY p.value DESC, p."sortName"
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
  filters: RecordFilters = {},
): Promise<MatchRecordRow[]> {
  const column = category === 'most-goals-in-a-game' ? 's.goals'
    : category === 'most-disposals-in-a-game' ? 's.disposals'
    : null;
  if (!column) return [];

  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, MATCH_RECORD_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`p.display_name ILIKE ${containsPattern(filters.q)}`);
  if (filters.club) conditions.push(sql`cl.slug = ${filters.club}`);
  const where = allOf(conditions);

  // `ranked` carries only the keys and the value it ranks on. Ranking has
  // to span every recorded performance — a filtered board still shows real
  // positions — but sorting 694,000 rows is far cheaper before the four
  // joins that turn a row into something displayable than after.
  return sql<MatchRecordRow[]>`
    WITH ranked AS (
      SELECT rank() OVER (ORDER BY ${sql.unsafe(column)} DESC)::int AS rank,
             s.player_id, s.match_id, s.club_id,
             ${sql.unsafe(column)} AS value
        FROM player_match_stats s
       WHERE ${sql.unsafe(column)} IS NOT NULL
    )
    SELECT r.rank, p.id AS "playerId", p.slug, p.display_name AS "displayName",
           r.value, m.id AS "matchId", m.season,
           m.round_type AS "roundType", m.round_number AS "roundNumber",
           m.match_date AS "matchDate",
           cl.name AS "clubName", opp.name AS "opponentName"
      FROM ranked r
      JOIN players p ON p.id = r.player_id
      JOIN matches m ON m.id = r.match_id
      JOIN clubs  cl ON cl.id = r.club_id
      JOIN clubs opp ON opp.id = CASE WHEN m.home_club_id = r.club_id
                                      THEN m.away_club_id ELSE m.home_club_id END
     WHERE ${where}
     ORDER BY r.value DESC, m.match_date
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
  /** LEFT JOIN on the nullable primary_club_id: null when no club is named. */
  clubName: string | null;
  clubSlug: string | null;
  games: number;
};

export async function getSeasonRecord(
  limit = 50,
  filters: RecordFilters = {},
): Promise<SeasonRecordRow[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, SEASON_RECORD_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`r."displayName" ILIKE ${containsPattern(filters.q)}`);
  if (filters.club) conditions.push(sql`r."clubSlug" = ${filters.club}`);
  const where = allOf(conditions);

  return sql<SeasonRecordRow[]>`
    WITH ranked AS (
      -- Player-season grain: a season total is the player's, not a club's.
      -- Reading the club-grained table here would split a transfer season
      -- into two smaller totals and rank both below the real figure.
      SELECT rank() OVER (ORDER BY s.goals DESC)::int AS rank,
             p.id AS "playerId", p.slug, p.display_name AS "displayName",
             s.goals AS value, s.season,
             cl.name AS "clubName", cl.slug AS "clubSlug", s.games
        FROM player_season_stats s
        JOIN players p ON p.id = s.player_id
        LEFT JOIN clubs cl ON cl.id = s.primary_club_id
       WHERE s.goals IS NOT NULL
    )
    SELECT r.rank, r."playerId", r.slug, r."displayName", r.value, r.season,
           r."clubName", r."clubSlug", r.games
      FROM ranked r
     WHERE ${where}
     ORDER BY r.value DESC, r.season
     LIMIT ${limit}
  `;
}
