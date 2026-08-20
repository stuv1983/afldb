import 'server-only';

import { sql } from '@/db/client';
import { type NlAggregation, type NlMatchScope, type NlMatchType, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlTeamStreakRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

const SIDES = sql`
  SELECT m.id AS match_id, m.season, m.round_type, m.is_final,
         m.match_date, m.venue_id, m.winner_club_id,
         m.home_club_id AS club_id, m.away_club_id AS opponent_id
    FROM matches m
  UNION ALL
  SELECT m.id, m.season, m.round_type, m.is_final,
         m.match_date, m.venue_id, m.winner_club_id,
         m.away_club_id, m.home_club_id
    FROM matches m
`;

function matchTypeSql(matchType: NlMatchType | undefined): SqlFragment {
  if (!matchType) return sql`TRUE`;
  if (matchType === 'finals') return sql`t.is_final`;
  return sql`t.round_type = ${matchType}::round_type`;
}

function scopeClauses(scope: NlMatchScope): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (scope.clubFor) {
    clauses.push(sql`t.club_id IN (SELECT id FROM clubs WHERE organization_id = ${scope.clubFor.organizationId})`);
  }
  if (scope.clubAgainst) {
    clauses.push(sql`t.opponent_id IN (SELECT id FROM clubs WHERE organization_id = ${scope.clubAgainst.organizationId})`);
  }
  if (scope.venue) clauses.push(sql`t.venue_id = ${scope.venue.id}`);
  if (scope.seasonMin !== undefined) clauses.push(sql`t.season >= ${scope.seasonMin}`);
  if (scope.seasonMax !== undefined) clauses.push(sql`t.season <= ${scope.seasonMax}`);
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

export async function answerTeamStreak(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const n = rankCutoff(plan.agg);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const where = foldAnd(scopeClauses(plan.scope));

  // streak target logic
  let targetSql: SqlFragment;
  if (plan.streak === 'win') targetSql = sql`t.winner_club_id = t.club_id`;
  else if (plan.streak === 'loss') targetSql = sql`t.winner_club_id IS NOT NULL AND t.winner_club_id <> t.club_id`;
  else if (plan.streak === 'unbeaten') targetSql = sql`t.winner_club_id = t.club_id OR t.winner_club_id IS NULL`;
  else throw new Error('Unknown streak type');

  const rows = await sql<(NlTeamStreakRow & { total: string; rnk: number })[]>`
    WITH sides AS (${SIDES}),
    filtered AS (
      SELECT t.*, (${targetSql}) AS is_target
        FROM sides t
       WHERE ${where}
    ),
    islands AS (
      SELECT f.*,
             ROW_NUMBER() OVER (PARTITION BY f.club_id ORDER BY f.match_date) -
             ROW_NUMBER() OVER (PARTITION BY f.club_id, f.is_target ORDER BY f.match_date) AS grp
        FROM filtered f
    ),
    grouped AS (
      SELECT club_id,
             COUNT(*) AS streak_length,
             MIN(match_date) AS start_date,
             MAX(match_date) AS end_date
        FROM islands
       WHERE is_target = TRUE
       GROUP BY club_id, grp
    ),
    ranked AS (
      SELECT g.club_id AS "clubId",
             cl.name AS "clubName", cl.slug AS "clubSlug",
             g.streak_length::int AS "streakLength",
             g.start_date AS "startDate", g.end_date AS "endDate",
             rank() OVER (ORDER BY g.streak_length ${direction})::int AS rnk
        FROM grouped g
        JOIN clubs cl ON cl.id = g.club_id
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r."streakLength" ${direction}, r."startDate"
     LIMIT ${limit}
  `;

  // Attach opponent context if scoped
  if (plan.scope.clubAgainst) {
    const oppName = plan.scope.clubAgainst.names[0].name;
    const oppSlug = plan.scope.clubAgainst.slug;
    for (const row of rows) {
      row.opponentName = oppName;
      row.opponentSlug = oppSlug;
    }
  }

  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'team_streak', lead: clean[0] ?? null, rows: clean, total };
}
