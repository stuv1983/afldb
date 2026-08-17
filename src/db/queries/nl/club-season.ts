import 'server-only';

import { sql } from '@/db/client';
import { type NlAggregation, type NlClubSeasonCondition, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlClubSeasonRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * percentage is numeric(9,4) in Postgres, and postgres.js hands a numeric
 * back as text (arbitrary precision, same reason bigint does) unless cast
 * -- ::float8 keeps this a real JS number the same way ::int already does
 * for the bigint sums elsewhere in db/queries/nl. wins/losses/draws are
 * plain smallint and need no cast.
 */
function metricValueExpr(metric: string): SqlFragment {
  switch (metric) {
    case 'wins': return sql`cs.wins`;
    case 'losses': return sql`cs.losses`;
    case 'draws': return sql`cs.draws`;
    case 'percentage': return sql`cs.percentage::float8`;
    default: throw new Error(`club_season metric "${metric}" is not recognised.`);
  }
}

/** Each condition reads one already-computed club_seasons column. "Made/missed finals" reads finals_played, which is NULL for a genuinely unrecorded season -- NULL satisfies neither > 0 nor = 0, the same "never treat absent as zero" rule the rest of this codebase applies. */
function conditionSql(cond: NlClubSeasonCondition): SqlFragment {
  switch (cond.kind) {
    case 'premier': return sql`cs.is_premier`;
    case 'wooden_spoon': return sql`cs.wooden_spoon`;
    case 'made_finals': return sql`cs.finals_played > 0`;
    case 'missed_finals': return sql`cs.finals_played = 0`;
  }
}

function scopeClauses(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (plan.scope.clubFor) {
    clauses.push(sql`cs.club_id IN (SELECT id FROM clubs WHERE organization_id = ${plan.scope.clubFor.organizationId})`);
  }
  if (plan.scope.seasonMin !== undefined) clauses.push(sql`cs.season >= ${plan.scope.seasonMin}`);
  if (plan.scope.seasonMax !== undefined) clauses.push(sql`cs.season <= ${plan.scope.seasonMax}`);
  for (const cond of plan.clubSeasonConditions) clauses.push(conditionSql(cond));
  return clauses;
}

function foldAnd(clauses: SqlFragment[]): SqlFragment {
  if (clauses.length === 0) return sql`TRUE`;
  return clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`);
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}

const ROW_SELECT = sql`
  c.id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
  cs.season, cs.played, cs.wins, cs.draws, cs.losses,
  cs.ladder_rank AS "ladderRank"
`;

/**
 * Answers a club_season plan: a plain list when there is no ranking
 * metric ("teams that won the wooden spoon"), or a ranked, tie-aware
 * answer when there is ("fewest wins by a premier") -- the same
 * list-vs-ranked split player-career.ts's answerPlayerCareer already
 * uses for the same reason (a conditions-only question has no metric to
 * rank by at all).
 */
export async function answerClubSeason(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const where = foldAnd(scopeClauses(plan));
  if (!plan.metric) return answerList(where, limit);
  return answerRanked(plan, where, limit);
}

async function answerList(where: SqlFragment, limit: number): Promise<NlAnswerPayload> {
  const rows = await sql<(NlClubSeasonRow & { total: string })[]>`
    SELECT ${ROW_SELECT}, NULL::float8 AS value, count(*) OVER () AS total
      FROM club_seasons cs JOIN clubs c ON c.id = cs.club_id
     WHERE ${where}
     ORDER BY cs.season DESC, c.name
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, ...rest }) => rest);
  return { kind: 'club_season', lead: clean[0] ?? null, rows: clean, total };
}

async function answerRanked(plan: NlQueryPlan, where: SqlFragment, limit: number): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);

  const rows = await sql<(NlClubSeasonRow & { total: string; rnk: number })[]>`
    WITH ranked AS (
      SELECT ${ROW_SELECT}, ${value} AS value,
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM club_seasons cs JOIN clubs c ON c.id = cs.club_id
       WHERE ${where} AND ${value} IS NOT NULL
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r.season DESC
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'club_season', lead: clean[0] ?? null, rows: clean, total };
}
