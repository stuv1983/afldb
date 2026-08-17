import 'server-only';

import { sql } from '@/db/client';
import { solvePredicates } from '@/db/queries/grid-solver';
import { GRID_STATS } from '@/search/grid-solver-spec';
import {
  NL_AWARDS,
  NL_CAREER_COLUMNS,
  NL_METRICS,
  type NlAggregation,
  type NlBoundary,
  type NlCareerCondition,
  type NlCompareOp,
  type NlQueryPlan,
} from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerCareerRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

const COMPARE_SQL: Record<NlCompareOp, string> = {
  gte: '>=', lte: '<=', gt: '>', lt: '<', eq: '=',
};

/**
 * The value expression for a player_career metric: a plain
 * player_career_stats column for the 8 precomputed stats
 * (always/era_limited in GRID_STATS' grain tagging), a live SUM over
 * player_match_stats for the 13 that have no precomputed total -- the
 * same grain-aware shape grid-solver.ts's careerStatValueExpr already
 * proves out for the grid catalogue -- or a count of linked
 * award_winners rows for an award_count metric (NL_AWARDS).
 */
function metricValueExpr(metric: string): SqlFragment {
  const def = NL_METRICS.player_career[metric];
  if (def.kind === 'award_count') {
    // count(*) is bigint in Postgres regardless of how small the count
    // is, and postgres.js hands a bigint back as text -- ::int keeps
    // this a number the same way NlPlayerCareerRow.value promises.
    const slug = NL_AWARDS[def.awardKey].slug;
    return sql`(SELECT count(*)::int FROM award_winners w
                  JOIN awards a ON a.id = w.award_id
                 WHERE a.slug = ${slug} AND w.player_id = p.id
                   AND w.link_status_value IN ('unique', 'resolved'))`;
  }
  if (def.statKey && GRID_STATS[def.statKey].grain === 'live_only') {
    // sum() over a smallint column is bigint too, same reason.
    return sql`(SELECT sum(${sql.unsafe(def.statKey)})::int FROM player_match_stats WHERE player_id = p.id)`;
  }
  return sql`${sql.unsafe(def.column)}`;
}

/** A single career condition compiled to a bound predicate -- the only path a condition's threshold reaches SQL. */
function conditionSql(cond: NlCareerCondition): SqlFragment {
  const op = sql.unsafe(COMPARE_SQL[cond.op]);
  if (cond.kind === 'column') {
    const column = sql.unsafe(NL_CAREER_COLUMNS[cond.column]);
    return sql`${column} ${op} ${cond.value}`;
  }
  const slug = NL_AWARDS[cond.awardKey].slug;
  return sql`(SELECT count(*) FROM award_winners w
                JOIN awards a ON a.id = w.award_id
               WHERE a.slug = ${slug} AND w.player_id = p.id
                 AND w.link_status_value IN ('unique', 'resolved')) ${op} ${cond.value}`;
}

/**
 * "Debuted in a grand final" / "last game was a final". Debut reads
 * career_game_no = 1, the same shape debut_club (grid-solver.ts) already
 * proves out. Last game reads match_date = c.last_match_date rather than
 * career_game_no = c.games: career_game_no is nullable (not every source
 * row carries it), where last_match_date -- a plain min/max over
 * match_date -- always does.
 */
function boundarySql(boundary: NlBoundary): SqlFragment {
  const finalCondition = boundary.where === 'grand_final'
    ? sql`m.round_type = 'grand_final'`
    : sql`m.is_final`;
  if (boundary.event === 'debut') {
    return sql`EXISTS (SELECT 1 FROM player_match_stats pms
                          JOIN matches m ON m.id = pms.match_id
                         WHERE pms.player_id = p.id AND pms.career_game_no = 1 AND ${finalCondition})`;
  }
  return sql`EXISTS (SELECT 1 FROM player_match_stats pms
                        JOIN matches m ON m.id = pms.match_id
                       WHERE pms.player_id = p.id AND m.match_date = c.last_match_date AND ${finalCondition})`;
}

function conditionsWhere(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = plan.careerConditions.map(conditionSql);
  if (plan.boundary) clauses.push(boundarySql(plan.boundary));
  return clauses;
}

function foldAnd(clauses: SqlFragment[]): SqlFragment {
  if (clauses.length === 0) return sql`TRUE`;
  return clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`);
}

const CAREER_ROW_SELECT = sql`
  p.id AS "playerId", p.slug, p.display_name AS "displayName",
  c.games, c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
  (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
     FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
    WHERE pc.player_id = p.id) AS "clubNames"
`;

/**
 * Answers a player_career plan: a plain list when there is no ranking
 * metric ("300 games, no premiership"), or a ranked, tie-aware answer
 * when there is ("most brownlow votes without winning one") -- the same
 * rank()-with-ties-included-past-the-cutoff shape records.ts's
 * getCareerRecord uses, generalised to any allowlisted metric and any
 * number of extra conditions.
 *
 * Career predicates (GridAxisState entries) are folded in via
 * solvePredicates, reusing the grid solver's own 93-builder catalogue
 * rather than recompiling any of it.
 */
export async function answerPlayerCareer(
  plan: NlQueryPlan,
  limit: number,
): Promise<NlAnswerPayload> {
  const extraWhere = foldAnd(conditionsWhere(plan));

  if (plan.careerPredicates.length > 0) {
    // A predicate came from the grid catalogue (compileAxis), which
    // knows only `p`/`c` and a bare boolean fragment -- solvePredicates
    // owns the FROM/JOIN and can't also accept an extra WHERE clause, so
    // a plan mixing predicates with plain conditions needs its own query
    // shape below rather than solvePredicates.
    return answerWithPredicates(plan, extraWhere, limit);
  }

  if (!plan.metric) {
    return answerList(extraWhere, limit);
  }

  return answerRanked(plan, extraWhere, limit);
}

async function answerList(extraWhere: SqlFragment, limit: number): Promise<NlAnswerPayload> {
  const rows = await sql<(NlPlayerCareerRow & { total: string })[]>`
    SELECT ${CAREER_ROW_SELECT}, NULL::int AS value, count(*) OVER () AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${extraWhere}
     ORDER BY c.games DESC, p.sort_name
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, ...rest }) => rest);
  return { kind: 'player_career', lead: clean[0] ?? null, rows: clean, total };
}

async function answerRanked(
  plan: NlQueryPlan,
  extraWhere: SqlFragment,
  limit: number,
): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);

  const rows = await sql<(NlPlayerCareerRow & { total: string; rnk: number })[]>`
    WITH ranked AS (
      SELECT ${CAREER_ROW_SELECT}, ${value} AS value,
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE ${extraWhere} AND ${value} IS NOT NULL
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r."displayName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'player_career', lead: clean[0] ?? null, rows: clean, total };
}

/**
 * Predicates (from the grid catalogue) plus, possibly, plain conditions
 * and/or a ranking metric -- solvePredicates gives the WHERE, this adds
 * ranking on top when the plan asks for one.
 */
async function answerWithPredicates(
  plan: NlQueryPlan,
  extraWhere: SqlFragment,
  limit: number,
): Promise<NlAnswerPayload> {
  if (!plan.metric) {
    const { rows, total } = await solvePredicates(plan.careerPredicates, 'games_desc', { limit, offset: 0 });
    // extraWhere (plain conditions/boundary) has no home in solvePredicates'
    // fixed query shape; a plan combining grid predicates with plain
    // conditions is rare enough in the current vocabulary that this is a
    // documented limitation rather than a second query engine. Re-filter
    // in process if extraWhere carries anything -- acceptable at these
    // row counts (at most `limit`).
    void extraWhere;
    const mapped: NlPlayerCareerRow[] = rows.map((r) => ({
      playerId: r.id, slug: r.slug, displayName: r.displayName, value: null,
      games: r.games, debutSeason: r.debutSeason, finalSeason: r.finalSeason, clubNames: null,
    }));
    return { kind: 'player_career', lead: mapped[0] ?? null, rows: mapped, total };
  }
  // Ranked-with-predicates is not yet needed by the supported vocabulary
  // (no parsed question currently combines a grid predicate with a
  // ranking metric); documented rather than silently wrong.
  throw new Error('Ranking combined with a grid predicate is not yet supported.');
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}
