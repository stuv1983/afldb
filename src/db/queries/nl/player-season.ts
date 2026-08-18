import 'server-only';

import { sql } from '@/db/client';
import { GRID_STATS } from '@/search/grid-solver-spec';
import { NL_METRICS, type NlAggregation, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerSeasonRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * The value expression for a player_season metric, grain-aware like
 * player-career.ts's metricValueExpr: player_season_stats precomputes a
 * real column for the 8 'always'/'era_limited' stats plus games/wins/
 * brownlow_votes, but the 13 'live_only' stats (migration 007 never
 * precomputed a season total for them) have no such column at all -- a
 * plain `sql.unsafe('s.clangers')` would reference a column that does not
 * exist. Those fall back to a correlated SUM over player_match_stats for
 * the same player and season, the same shape seasonStatAtLeast in
 * grid-solver.ts already proves out for the grid catalogue.
 */
function metricValueExpr(metric: string): SqlFragment {
  const def = NL_METRICS.player_season[metric];
  if (def.kind !== 'column') throw new Error(`player_season metric "${metric}" has no column.`);
  if (def.statKey && GRID_STATS[def.statKey].grain === 'live_only') {
    // sum() over a smallint column is bigint in Postgres, and postgres.js
    // hands a bigint back as text -- ::int keeps this a real number, the
    // same fix player-career.ts's metricValueExpr already needed.
    return sql`(SELECT sum(${sql.unsafe(def.statKey)})::int FROM player_match_stats pms
                  JOIN matches m2 ON m2.id = pms.match_id
                 WHERE pms.player_id = s.player_id AND m2.season = s.season)`;
  }
  return sql`${sql.unsafe(`s.${def.column}`)}`;
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}

/**
 * Answers a player_season plan: player_season_stats is true player+season
 * grain (migration 015) -- a season total belongs to the player, not to
 * one club, so a mid-season transfer is never split into two smaller
 * totals. A club scope ("goals by a Richmond player in 2017") therefore
 * narrows WHICH players are eligible via the club-grained sibling table
 * (player_club_season_stats: did they play at least one game for that
 * club that season) without changing which total they are ranked on.
 */
export async function answerPlayerSeason(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);

  const clauses: SqlFragment[] = [];
  if (plan.player) clauses.push(sql`s.player_id = ${plan.player.id}`);
  // An ambiguous surname ranking across every plausible candidate rather
  // than declining -- see NlMatchScope.playerIdIn. validatePlan keeps
  // this and `plan.player` mutually exclusive.
  if (plan.scope.playerIdIn) clauses.push(sql`s.player_id = ANY(${plan.scope.playerIdIn})`);
  if (plan.scope.seasonMin !== undefined) clauses.push(sql`s.season >= ${plan.scope.seasonMin}`);
  if (plan.scope.seasonMax !== undefined) clauses.push(sql`s.season <= ${plan.scope.seasonMax}`);
  if (plan.scope.clubFor) {
    clauses.push(sql`s.player_id IN (
      SELECT pcs.player_id FROM player_club_season_stats pcs
       WHERE pcs.season = s.season
         AND pcs.club_id IN (SELECT id FROM clubs WHERE organization_id = ${plan.scope.clubFor.organizationId})
    )`);
  }
  clauses.push(sql`${value} IS NOT NULL`);
  const where = clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`, sql`TRUE`);

  const rows = await sql<(NlPlayerSeasonRow & { total: string; rnk: number })[]>`
    WITH ranked AS (
      SELECT p.id AS "playerId", p.slug, p.display_name AS "displayName",
             ${value} AS value, s.season, s.games,
             cl.name AS "clubName", cl.slug AS "clubSlug",
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM player_season_stats s
        JOIN players p ON p.id = s.player_id
        LEFT JOIN clubs cl ON cl.id = s.primary_club_id
       WHERE ${where}
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r.season, r."displayName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'player_season', lead: clean[0] ?? null, rows: clean, total };
}
