import 'server-only';

import { sql } from '@/db/client';
import { type NlAggregation, type NlMatchScope, type NlMatchType, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlTeamMatchRow } from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * Every match, twice -- once from each club's own perspective. `matches`
 * stores home/away, not for/against, so this CTE is what turns "Richmond
 * v Carlton, Richmond home, 90-70" into two rows: Richmond's (score_for
 * 90, score_against 70, won) and Carlton's (score_for 70, score_against
 * 90, lost) -- the same reframing getPlayerMatches (players.ts) and
 * getMatchRecord (records.ts) already do with a CASE expression, done
 * once here as a real row set so every metric can filter/rank over it
 * uniformly instead of repeating the CASE per metric.
 */
const SIDES = sql`
  SELECT m.id AS match_id, m.season, m.round_type, m.round_number, m.is_final,
         m.match_date, m.venue_id, m.attendance, m.winner_club_id,
         m.home_club_id AS club_id, m.away_club_id AS opponent_id,
         m.home_score AS score_for, m.away_score AS score_against,
         hq.points AS q3_score_for, aq.points AS q3_score_against
    FROM matches m
    LEFT JOIN match_period_scores hq ON hq.match_id = m.id AND hq.club_id = m.home_club_id AND hq.period = 3
    LEFT JOIN match_period_scores aq ON aq.match_id = m.id AND aq.club_id = m.away_club_id AND aq.period = 3
  UNION ALL
  SELECT m.id, m.season, m.round_type, m.round_number, m.is_final,
         m.match_date, m.venue_id, m.attendance, m.winner_club_id,
         m.away_club_id, m.home_club_id,
         m.away_score, m.home_score,
         aq.points, hq.points
    FROM matches m
    LEFT JOIN match_period_scores hq ON hq.match_id = m.id AND hq.club_id = m.home_club_id AND hq.period = 3
    LEFT JOIN match_period_scores aq ON aq.match_id = m.id AND aq.club_id = m.away_club_id AND aq.period = 3
`;

/**
 * The value a metric ranks on. win_margin/loss_margin are NULL (excluded
 * from ranking, the same NULL-means-not-eligible discipline every other
 * grain here uses) for a side that didn't actually win/lose that game --
 * "biggest win" must never rank a loss by how close it was, and a drawn
 * Grand Final (winner_club_id IS NULL) counts as neither, the same
 * exclusion grid-solver.ts's grand_finals_lost_min already applies.
 */
function metricValueExpr(metric: string): SqlFragment {
  switch (metric) {
    case 'win_margin':
      return sql`CASE WHEN t.winner_club_id = t.club_id THEN (t.score_for - t.score_against) END`;
    case 'loss_margin':
      return sql`CASE WHEN t.winner_club_id IS NOT NULL AND t.winner_club_id <> t.club_id
                       THEN (t.score_against - t.score_for) END`;
    case 'team_score':
      return sql`t.score_for`;
    case 'opponent_score':
      return sql`t.score_against`;
    case 'total_score':
      return sql`(t.score_for + t.score_against)`;
    case 'attendance':
      return sql`t.attendance`;
    case 'q3_deficit_overcome':
      return sql`CASE WHEN t.winner_club_id = t.club_id AND t.q3_score_against IS NOT NULL THEN (t.q3_score_against - t.q3_score_for) END`;
    default:
      throw new Error(`team_match metric "${metric}" is not recognised.`);
  }
}

/** 'finals' is a synthetic "any final" reading; every other NlMatchType is a literal round_type enum member, the same bound-and-cast pattern player-game.ts's matchTypeSql and search.ts's own round_type lookup already use. */
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

/**
 * Answers a team_match plan: "Richmond's biggest loss", "biggest win at
 * the MCG", "highest score in a Grand Final". Ties included past the
 * rank cutoff, the same discipline every other grain here applies.
 */
export async function answerTeamMatch(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const value = metricValueExpr(plan.metric!);
  const direction = plan.agg.kind === 'min' ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const n = rankCutoff(plan.agg);
  const where = foldAnd([...scopeClauses(plan.scope), sql`${value} IS NOT NULL`]);

  const rows = await sql<(NlTeamMatchRow & { total: string; rnk: number })[]>`
    WITH sides AS (${SIDES}),
    ranked AS (
      SELECT t.match_id AS "matchId", t.season, t.round_type AS "roundType", t.round_number AS "roundNumber",
             t.match_date AS "matchDate",
             cl.name AS "clubName", cl.slug AS "clubSlug",
             opp.name AS "opponentName", opp.slug AS "opponentSlug",
             ${value} AS value,
             t.score_for AS "clubScore", t.score_against AS "opponentScore",
             COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
             rank() OVER (ORDER BY ${value} ${direction})::int AS rnk
        FROM sides t
        JOIN matches m ON m.id = t.match_id
        JOIN clubs cl ON cl.id = t.club_id
        JOIN clubs opp ON opp.id = t.opponent_id
        LEFT JOIN venues v ON v.id = t.venue_id
       WHERE ${where}
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value ${direction}, r."matchDate"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _t, rnk: _r, ...rest }) => rest);
  return { kind: 'team_match', lead: clean[0] ?? null, rows: clean, total };
}
