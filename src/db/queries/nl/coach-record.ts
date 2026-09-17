import 'server-only';

import { sql } from '@/db/client';
import { coachSlug } from '@/lib/slugs';
import { type NlAggregation, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlCoachRecordRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * The coach_record grain: a coaching record derived from the canonical
 * per-match assignment, `match_coaches` JOIN `matches`.
 *
 * This is a PARAMETERISED GENERALISATION of db/queries/coaches.ts, not a
 * second derivation: the aggregate expressions below are the ones
 * getClubCoachRecords and getCoachRecordsByWinPct already use, with bound
 * parameters for the coach, the club organization, the season range, the
 * ranked metric, its threshold and the limit. `coaches.source_games_coached`
 * is evidence only (migration 087) and is read nowhere here.
 *
 * Two details are load-bearing and were taken from those functions rather
 * than re-decided:
 *
 *  - Draws are `m.winner_club_id IS NULL`, valid because the FROM clause
 *    starts at `match_coaches` and every join is INNER. (The board queries
 *    that start FROM `coaches` need the extra `m.id IS NOT NULL` guard,
 *    because there a coach with no matches has a NULL winner too.)
 *  - Win percentage is `(W + D/2) / G * 100`, the site convention, never a
 *    plain `W / G`. George Angus is 41 W / 2 D / 60 g = 70.00, where W/G
 *    would print 68.33.
 *
 * Club scope folds the whole `organization_id` lineage, exactly as the
 * club page does: a coach of Footscray counts on Western Bulldogs, and
 * nothing of Fitzroy's ever reaches Brisbane Lions, because a merger is a
 * different organisation.
 */

/**
 * The metric's value, read off the aggregate CTE. Every key is looked up
 * here rather than spliced, the same discipline NL_CAREER_COLUMNS applies:
 * a metric name reaching SQL as text from a question is exactly what this
 * closed switch exists to prevent.
 */
function metricValueExpr(metric: string): SqlFragment {
  switch (metric) {
    case 'games': return sql`t.games::float8`;
    case 'wins': return sql`t.wins::float8`;
    case 'draws': return sql`t.draws::float8`;
    case 'losses': return sql`t.losses::float8`;
    case 'finals': return sql`t.finals::float8`;
    case 'grand_finals': return sql`t."grandFinals"::float8`;
    case 'premierships': return sql`t.premierships::float8`;
    case 'seasons': return sql`t.seasons::float8`;
    case 'organizations': return sql`t.organizations::float8`;
    case 'win_pct': return sql`t."winPctValue"`;
    default: throw new Error(`coach_record metric "${metric}" is not recognised.`);
  }
}

function compareExpr(value: SqlFragment, op: string, bound: number): SqlFragment {
  switch (op) {
    case 'gte': return sql`${value} >= ${bound}`;
    case 'gt': return sql`${value} > ${bound}`;
    case 'lte': return sql`${value} <= ${bound}`;
    case 'lt': return sql`${value} < ${bound}`;
    case 'eq': return sql`${value} = ${bound}`;
    default: throw new Error(`coach_record comparison "${op}" is not recognised.`);
  }
}

function foldAnd(clauses: SqlFragment[]): SqlFragment {
  if (clauses.length === 0) return sql`TRUE`;
  return clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`);
}

/**
 * Match-level scope. `match_coaches.club_id` is the RAW historical club
 * identity, so folding the lineage is this compiler's job and is never
 * assumed by the caller -- NlClubRef.organizationId is already the
 * lineage-level id, so no extra lookup is needed.
 */
function scopeClauses(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (plan.coach) clauses.push(sql`mc.coach_id = ${plan.coach.id}`);
  if (plan.scope.clubFor) {
    clauses.push(sql`mc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${plan.scope.clubFor.organizationId})`);
  }
  if (plan.scope.seasonMin !== undefined) clauses.push(sql`m.season >= ${plan.scope.seasonMin}`);
  if (plan.scope.seasonMax !== undefined) clauses.push(sql`m.season <= ${plan.scope.seasonMax}`);
  return clauses;
}

function totals(where: SqlFragment): SqlFragment {
  return sql`
    SELECT c.id AS "coachId", c.display_name AS "displayName",
           (c.player_id IS NULL) AS "coachOnly",
           c.player_id AS "playerId", p.slug AS "playerSlug",
           min(m.season)::int AS "firstSeason",
           max(m.season)::int AS "lastSeason",
           count(DISTINCT m.season)::int AS seasons,
           count(DISTINCT cl.organization_id)::int AS organizations,
           count(*)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (
             WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
           )::int AS losses,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
           count(*) FILTER (
             WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id
           )::int AS premierships,
           round((
             (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
               + count(*) FILTER (WHERE m.winner_club_id IS NULL) * 0.5)
             * 100.0 / count(*)
           )::numeric, 2) AS "winPct",
           (
             (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
               + count(*) FILTER (WHERE m.winner_club_id IS NULL) * 0.5)
             * 100.0 / count(*)
           )::float8 AS "winPctValue"
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN coaches c ON c.id = mc.coach_id
      JOIN clubs cl ON cl.id = mc.club_id
      LEFT JOIN players p ON p.id = c.player_id
     WHERE ${where}
     GROUP BY c.id, c.display_name, c.player_id, p.slug
  `;
}

const ROW_SELECT = sql`
  t."coachId", t."displayName", t."coachOnly", t."playerId", t."playerSlug",
  t."firstSeason", t."lastSeason", t.seasons, t.organizations,
  t.games, t.wins, t.draws, t.losses, t.finals, t."grandFinals", t.premierships,
  t."winPct"
`;

type RawRow = Omit<NlCoachRecordRow, 'slug'> & { total: string };

/** `coaches` stores no slug, so the URL-readable form is derived the same way every coach route derives it. */
function withSlug(rows: RawRow[]): NlCoachRecordRow[] {
  return rows.map(({ total: _total, ...rest }) => ({ ...rest, slug: coachSlug(rest.displayName) }));
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}

/**
 * The qualifying filters applied AFTER aggregation: the win-percentage
 * games qualifier, and the plan's own metric threshold. Both are bound
 * parameters against a metric looked up in the closed switch above.
 */
function havingClauses(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (plan.coachQualifier) clauses.push(sql`t.games >= ${plan.coachQualifier.minGames}`);
  if (plan.metricCondition && plan.metric) {
    clauses.push(compareExpr(metricValueExpr(plan.metric), plan.metricCondition.op, plan.metricCondition.value));
  }
  return clauses;
}

export async function answerCoachRecord(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const where = foldAnd(scopeClauses(plan));
  const having = foldAnd(havingClauses(plan));

  if (plan.agg.kind === 'count') return answerCount(where, having);
  if (plan.agg.kind === 'list' || plan.metric === null) return answerList(plan, where, having, limit);
  return answerRanked(plan, where, having, limit);
}

/** "How many coaches has Richmond had" -- the qualifying set's size, not a row list. */
async function answerCount(where: SqlFragment, having: SqlFragment): Promise<NlAnswerPayload> {
  const [row] = await sql<{ value: string }[]>`
    WITH t AS (${totals(where)})
    SELECT count(*) AS value FROM t WHERE ${having}
  `;
  return { kind: 'count', value: Number(row?.value ?? 0) };
}

/**
 * The unranked qualifying set. Ordered most-recently-in-charge first,
 * exactly as getClubCoachRecords orders the club page's own table, so the
 * same question asked two ways cannot come back in two different orders.
 */
async function answerList(
  plan: NlQueryPlan,
  where: SqlFragment,
  having: SqlFragment,
  limit: number,
): Promise<NlAnswerPayload> {
  const value = plan.metric ? metricValueExpr(plan.metric) : sql`NULL::float8`;
  const rows = await sql<RawRow[]>`
    WITH t AS (${totals(where)})
    SELECT ${ROW_SELECT}, ${value} AS value, count(*) OVER () AS total
      FROM t
     WHERE ${having}
     ORDER BY t."lastSeason" DESC, t."firstSeason" DESC, t."displayName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = withSlug(rows);
  return { kind: 'coach_record', lead: clean[0] ?? null, rows: clean, total };
}

/**
 * A ranked answer, with every row tied at the lead rank returned -- the
 * same `rank()` with no PARTITION BY every other grain uses, so a shared
 * coaching record is named as shared rather than silently reduced to
 * whichever holder sorted first.
 */
async function answerRanked(
  plan: NlQueryPlan,
  where: SqlFragment,
  having: SqlFragment,
  limit: number,
): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);

  const rows = await sql<(RawRow & { rnk: number })[]>`
    WITH t AS (${totals(where)}),
    ranked AS (
      SELECT ${ROW_SELECT}, ${value} AS value,
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM t
       WHERE ${having} AND ${value} IS NOT NULL
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r."displayName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = withSlug(rows.map(({ rnk: _rnk, ...rest }) => rest));
  return { kind: 'coach_record', lead: clean[0] ?? null, rows: clean, total };
}
