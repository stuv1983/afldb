import 'server-only';

import { sql } from '@/db/client';
import { type NlAggregation, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlFamilyRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * The `family` grain (AFLDB-ISSUE-153 Stage 6, decision D6): a sibling
 * family, grouped by `player_relationships.family_key`.
 *
 * This is a PARAMETERISED GENERALISATION of getFamilyRecords
 * (db/queries/family-records.ts), not a second derivation -- the same
 * sibling-only population, the same id-keyed member union, the same
 * COALESCE(family_name, family_key) fallback -- with two additions the
 * page board does not need: a HAVING floor that excludes the 46 size-1
 * families (a family of one is not a family, §4.6), and a bound ranked
 * metric/threshold instead of the page's fixed combined_games DESC order.
 *
 * `family_members` unions both relationship sides and keeps only the
 * LINKED one, so an unmatched relative -- a name in player_relationships
 * with no player_id -- can never surface as a member (the D6 fail-closed
 * rule). Identity is the player id throughout, never the display name:
 * `ablett-0004` holds two distinct ids (4700, 4701) both named "Gary
 * Ablett", and the UNION keys on person_a/b_player_id, never on a name.
 */
const FAMILIES_CTE = sql`
  WITH family_names AS (
    SELECT family_key,
           max(family_name) FILTER (WHERE family_name IS NOT NULL) AS family_name
      FROM player_relationships
     WHERE relationship = 'sibling' AND family_key IS NOT NULL
     GROUP BY family_key
  ),
  family_members AS (
    SELECT family_key, person_a_player_id AS player_id
      FROM player_relationships
     WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_a_player_id IS NOT NULL
     UNION
    SELECT family_key, person_b_player_id AS player_id
      FROM player_relationships
     WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_b_player_id IS NOT NULL
  ),
  member_stats AS (
    SELECT fm.family_key, fm.player_id, p.display_name, p.slug,
           COALESCE(pcs.games, 0)::int AS games
      FROM family_members fm
      JOIN players p ON p.id = fm.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = fm.player_id
  ),
  t AS (
    SELECT ms.family_key AS "familyKey",
           COALESCE(fn.family_name, ms.family_key) AS "familyName",
           count(*)::int AS "linkedMembers",
           sum(ms.games)::int AS "combinedGames",
           jsonb_agg(
             jsonb_build_object(
               'playerId', ms.player_id, 'name', ms.display_name,
               'slug', ms.slug, 'games', ms.games
             ) ORDER BY ms.games DESC, ms.display_name
           ) AS members
      FROM member_stats ms
      LEFT JOIN family_names fn ON fn.family_key = ms.family_key
     GROUP BY ms.family_key, fn.family_name
    HAVING count(*) >= 2
  )
`;

function metricValueExpr(metric: string): SqlFragment {
  switch (metric) {
    case 'combined_games': return sql`t."combinedGames"::float8`;
    case 'linked_members': return sql`t."linkedMembers"::float8`;
    default: throw new Error(`family metric "${metric}" is not recognised.`);
  }
}

function compareExpr(value: SqlFragment, op: string, bound: number): SqlFragment {
  switch (op) {
    case 'gte': return sql`${value} >= ${bound}`;
    case 'gt': return sql`${value} > ${bound}`;
    case 'lte': return sql`${value} <= ${bound}`;
    case 'lt': return sql`${value} < ${bound}`;
    case 'eq': return sql`${value} = ${bound}`;
    default: throw new Error(`family comparison "${op}" is not recognised.`);
  }
}

function rankCutoff(agg: NlAggregation): number {
  return agg.kind === 'top_n' ? agg.n : 1;
}

const ROW_SELECT = sql`t."familyKey", t."familyName", t."linkedMembers", t."combinedGames", t.members`;

type RawRow = NlFamilyRow & { total: string; rnk?: number };

function clean(rows: RawRow[]): NlFamilyRow[] {
  return rows.map(({ total: _total, rnk: _rnk, ...rest }) => rest);
}

export async function answerFamily(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  if (plan.metricCondition && plan.metric) {
    return answerList(plan, limit);
  }
  return answerRanked(plan, limit);
}

/** C5: "families with three AFL players" -- the qualifying set, never a rank-one leader. */
async function answerList(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const having = compareExpr(value, plan.metricCondition!.op, plan.metricCondition!.value);
  const rows = await sql<RawRow[]>`
    ${FAMILIES_CTE}
    SELECT ${ROW_SELECT}, ${value} AS value, count(*) OVER () AS total
      FROM t
     WHERE ${having}
     ORDER BY t."combinedGames" DESC, t."familyName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const rowsClean = clean(rows);
  return { kind: 'family', lead: rowsClean[0] ?? null, rows: rowsClean, total };
}

/**
 * C1: "biggest football family" (combined_games) or "which family has the
 * most AFL players" (linked_members) -- a ranked leader, with every family
 * tied at the lead value returned (rank() with no PARTITION BY, the same
 * tie machinery every other grain uses).
 */
async function answerRanked(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);

  const rows = await sql<RawRow[]>`
    ${FAMILIES_CTE},
    ranked AS (
      SELECT ${ROW_SELECT}, ${value} AS value,
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM t
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r."familyName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const rowsClean = clean(rows);
  return { kind: 'family', lead: rowsClean[0] ?? null, rows: rowsClean, total };
}
