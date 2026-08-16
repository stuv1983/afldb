import 'server-only';

import { sql } from '@/db/client';
import {
  MATCH_FIELDS,
  MATCH_SORTS,
  type MatchSearchQuery,
} from '@/search/match-spec';

export type MatchSearchResultRow = {
  id: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  matchDate: Date;
  homeName: string;
  homeSlug: string;
  awayName: string;
  awaySlug: string;
  homeGoals: number | null;
  homeBehinds: number | null;
  homeScore: number;
  awayGoals: number | null;
  awayBehinds: number | null;
  awayScore: number;
  lowScore: number;
  highScore: number;
  totalScore: number;
  result: 'home_win' | 'away_win' | 'draw';
  margin: number;
  venueName: string;
};

/**
 * One row as the `totals LEFT JOIN page` shape below actually returns it.
 *
 * Every match column is nullable here because a page beyond the last result
 * produces exactly one row carrying the total and nothing else. The filter
 * further down relies on that; typing the columns non-null made the very
 * check that keeps the empty row out of the results look impossible.
 */
type RawMatchSearchRow =
  { [K in keyof MatchSearchResultRow]: MatchSearchResultRow[K] | null }
  & { total: number };

/**
 * Execute a validated Match Search specification.
 *
 * The filtered result, page and total are produced by one SQL statement. That
 * gives the count and rows one MVCC snapshot even while an import is running,
 * and the totals CTE preserves the true count when a hand-edited page number
 * is beyond the last result page.
 */
export async function runMatchSearch(
  query: MatchSearchQuery,
): Promise<{ rows: MatchSearchResultRow[]; total: number }> {
  const conditions: ReturnType<typeof sql>[] = [];

  for (const filter of query.filters) {
    const definition = MATCH_FIELDS[filter.field];
    if (!definition) continue;
    const column = sql.unsafe(definition.column);

    if (filter.min !== undefined) {
      conditions.push(sql`${column} >= ${filter.min}`);
    }
    if (filter.max !== undefined) {
      conditions.push(sql`${column} <= ${filter.max}`);
    }
  }

  if (query.clubSlugs.length > 0) {
    conditions.push(sql`
      (h.slug = ANY(${query.clubSlugs}) OR a.slug = ANY(${query.clubSlugs}))
    `);
  }

  if (query.outcome === 'draw') {
    conditions.push(sql`m.result = 'draw'`);
  } else if (query.outcome === 'decided') {
    conditions.push(sql`m.result <> 'draw'`);
  }

  if (query.matchType === 'finals') {
    conditions.push(sql`m.is_final`);
  } else if (query.matchType === 'home_and_away') {
    conditions.push(sql`NOT m.is_final`);
  }

  const where = conditions.length
    ? conditions.reduce((combined, condition) => sql`${combined} AND ${condition}`)
    : sql`TRUE`;
  const orderBy = sql.unsafe(
    MATCH_SORTS[query.sort]?.sql ?? MATCH_SORTS.date_desc.sql,
  );
  const offset = (query.page - 1) * query.pageSize;

  const rawRows = await sql<RawMatchSearchRow[]>`
    WITH filtered AS MATERIALIZED (
      SELECT m.id, m.season, m.round_type AS "roundType",
             m.round_number AS "roundNumber", m.match_date AS "matchDate",
             h.name AS "homeName", h.slug AS "homeSlug",
             a.name AS "awayName", a.slug AS "awaySlug",
             m.home_goals AS "homeGoals", m.home_behinds AS "homeBehinds",
             m.home_score AS "homeScore",
             m.away_goals AS "awayGoals", m.away_behinds AS "awayBehinds",
             m.away_score AS "awayScore",
             LEAST(m.home_score, m.away_score) AS "lowScore",
             GREATEST(m.home_score, m.away_score) AS "highScore",
             (m.home_score + m.away_score) AS "totalScore",
             m.result::text, m.margin,
             COALESCE(v.canonical_name, m.venue_raw) AS "venueName"
        FROM matches m
        JOIN clubs h ON h.id = m.home_club_id
        JOIN clubs a ON a.id = m.away_club_id
        LEFT JOIN venues v ON v.id = m.venue_id
       WHERE ${where}
    ),
    page AS (
      SELECT * FROM filtered
       ORDER BY ${orderBy}
       LIMIT ${query.pageSize} OFFSET ${offset}
    ),
    totals AS (
      SELECT count(*)::int AS total FROM filtered
    )
    SELECT page.*, totals.total
      FROM totals
      LEFT JOIN page ON TRUE
     ORDER BY ${orderBy}
  `;

  const total = rawRows[0]?.total ?? 0;
  const rows = rawRows
    .filter((row): row is MatchSearchResultRow & { total: number } => row.id !== null)
    .map(({ total: _total, ...row }) => row);

  return { rows, total };
}
