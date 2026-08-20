import 'server-only';

import { sql } from '@/db/client';
import { NL_METRICS, type NlAggregation, type NlMatchScope, type NlMatchType, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerGameRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/** player_game NL_METRICS entries are all 'column' kind with the bare player_match_stats column name (goals, disposals, brownlow_votes, ...) as `.column` -- there is no grain branching here, unlike player_career: every one of the 21 GRID_STATS is a real column on player_match_stats. */
function metricColumn(metric: string): string {
  const def = NL_METRICS.player_game[metric];
  if (def.kind !== 'column') throw new Error(`player_game metric "${metric}" has no column.`);
  return def.column;
}

/**
 * 'finals' is a synthetic "any final" reading with no matching round_type
 * value; every other NlMatchType (including 'home_and_away') is a literal
 * enum member, bound and cast the same way search.ts's own round_type
 * lookup already does.
 */
function matchTypeSql(matchType: NlMatchType | undefined): SqlFragment {
  if (!matchType) return sql`TRUE`;
  if (matchType === 'finals') return sql`m.is_final`;
  return sql`m.round_type = ${matchType}::round_type`;
}

/** WHERE clauses shared by both modes -- club/opponent/venue/season/match-type scope, plus an optional player filter (mode 'single' always has one; mode 'sum' may or may not). */
function scopeClauses(scope: NlMatchScope, playerId: number | undefined): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (playerId) clauses.push(sql`s.player_id = ${playerId}`);
  // An ambiguous surname ranking across every plausible candidate rather
  // than declining -- see NlMatchScope.playerIdIn. validatePlan keeps
  // this and `playerId` mutually exclusive, so only one of the two ever
  // fires for a given plan.
  if (scope.playerIdIn) clauses.push(sql`s.player_id = ANY(${scope.playerIdIn})`);
  if (scope.clubFor) {
    clauses.push(sql`s.club_id IN (SELECT id FROM clubs WHERE organization_id = ${scope.clubFor.organizationId})`);
  }
  if (scope.clubAgainst) {
    // The other side of the match from the player's own club, the same
    // CASE getPlayerMatches (players.ts) and getMatchRecord (records.ts)
    // already use to find an opponent without a stored opponent column.
    clauses.push(sql`
      (CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END)
        IN (SELECT id FROM clubs WHERE organization_id = ${scope.clubAgainst.organizationId})
    `);
  }
  if (scope.venue) clauses.push(sql`m.venue_id = ${scope.venue.id}`);
  if (scope.seasonMin !== undefined) clauses.push(sql`m.season >= ${scope.seasonMin}`);
  if (scope.seasonMax !== undefined) clauses.push(sql`m.season <= ${scope.seasonMax}`);
  clauses.push(matchTypeSql(scope.matchType));
  return clauses;
}

function foldAnd(clauses: SqlFragment[]): SqlFragment {
  if (clauses.length === 0) return sql`TRUE`;
  return clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`);
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}

/**
 * Answers a player_game plan. Mode 'single' ranks individual match
 * performances (ties included, the same rank()-with-ties discipline as
 * every other grain here) -- "dusty's highest disposal game", "most goals
 * in a grand final at the MCG since 1980". Mode 'sum' ranks each player's
 * scoped career total instead -- "most goals against Carlton" -- since a
 * cumulative total across many games has no single match to point at.
 */
export async function answerPlayerGame(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  return plan.mode === 'sum' ? answerSum(plan, limit) : answerSingle(plan, limit);
}

async function answerSingle(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const value = sql`${sql.unsafe(`s.${metricColumn(plan.metric!)}`)}`;
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);
  const where = foldAnd([...scopeClauses(plan.scope, plan.player?.id), sql`${value} IS NOT NULL`]);

  let statsTarget = sql`player_match_stats s`;
  if (plan.periodSplit && plan.periodSplit !== 'FULL_MATCH') {
    let periodCondition = sql`period = 1`;
    if (plan.periodSplit === 'Q2') periodCondition = sql`period = 2`;
    else if (plan.periodSplit === 'Q3') periodCondition = sql`period = 3`;
    else if (plan.periodSplit === 'Q4') periodCondition = sql`period = 4`;
    else if (plan.periodSplit === 'H1') periodCondition = sql`period IN (1, 2)`;
    else if (plan.periodSplit === 'H2') periodCondition = sql`period IN (3, 4)`;
    const col = sql.unsafe(metricColumn(plan.metric!));
    statsTarget = sql`(SELECT player_id, match_id, club_id, sum(${col})::int AS ${col} FROM player_match_period_stats WHERE ${periodCondition} GROUP BY player_id, match_id, club_id) s`;
  }

  const rows = await sql<(NlPlayerGameRow & { total: string; rnk: number })[]>`
    WITH ranked AS (
      SELECT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "playerName",
             ${value} AS value,
             m.id AS "matchId", m.season, m.round_type AS "roundType", m.round_number AS "roundNumber",
             m.match_date AS "matchDate",
             cl.name AS "clubName", opp.name AS "opponentName",
             COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
             m.home_score AS "homeScore", m.away_score AS "awayScore",
             NULL::int AS games,
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM ${statsTarget}
        JOIN players p ON p.id = s.player_id
        JOIN matches m ON m.id = s.match_id
        JOIN clubs cl ON cl.id = s.club_id
        JOIN clubs opp ON opp.id = CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END
        LEFT JOIN venues v ON v.id = m.venue_id
       WHERE ${where}
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r."matchDate"
     LIMIT ${limit}
  `;
  return toPayload(rows);
}

async function answerSum(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const statColumn = sql.unsafe(metricColumn(plan.metric!));
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);
  const where = foldAnd(scopeClauses(plan.scope, plan.player?.id));

  let statsTarget = sql`player_match_stats s`;
  if (plan.periodSplit && plan.periodSplit !== 'FULL_MATCH') {
    let periodCondition = sql`period = 1`;
    if (plan.periodSplit === 'Q2') periodCondition = sql`period = 2`;
    else if (plan.periodSplit === 'Q3') periodCondition = sql`period = 3`;
    else if (plan.periodSplit === 'Q4') periodCondition = sql`period = 4`;
    else if (plan.periodSplit === 'H1') periodCondition = sql`period IN (1, 2)`;
    else if (plan.periodSplit === 'H2') periodCondition = sql`period IN (3, 4)`;
    statsTarget = sql`(SELECT player_id, match_id, club_id, ${statColumn} FROM player_match_period_stats WHERE ${periodCondition}) s`;
  }

  const rows = await sql<(NlPlayerGameRow & { total: string; rnk: number })[]>`
    WITH totals AS (
      SELECT s.player_id, sum(${statColumn})::int AS value, count(DISTINCT s.match_id)::int AS games
        FROM ${statsTarget}
        JOIN matches m ON m.id = s.match_id
       WHERE ${where} AND ${statColumn} IS NOT NULL
       GROUP BY s.player_id
    ),
    ranked AS (
      SELECT t.player_id, t.value, t.games,
             rank() OVER (ORDER BY t.value ${direction})::int AS rnk
        FROM totals t
    )
    SELECT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "playerName",
           r.value, r.games,
           NULL::int AS "matchId", NULL::int AS season,
           NULL::text AS "roundType", NULL::int AS "roundNumber", NULL::date AS "matchDate",
           NULL::text AS "clubName", NULL::text AS "opponentName", NULL::text AS "venueName",
           NULL::int AS "homeScore", NULL::int AS "awayScore",
           r.rnk, count(*) OVER () AS total
      FROM ranked r
      JOIN players p ON p.id = r.player_id
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, p.sort_name
     LIMIT ${limit}
  `;
  return toPayload(rows);
}

function toPayload(rows: (NlPlayerGameRow & { total: string; rnk: number })[]): NlAnswerPayload {
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'player_game', lead: clean[0] ?? null, rows: clean, total };
}
