import 'server-only';

import { sql } from '@/db/client';
import type { NlAnswerPayload, NlHeadToHeadRow } from '@/search/nl/answer-types';
import type { NlMatchType, NlQueryPlan } from '@/search/nl/plan';

type SqlFragment = ReturnType<typeof sql>;

function matchTypeSql(matchType: NlMatchType | undefined): SqlFragment {
  if (!matchType) return sql`TRUE`;
  // 'finals' means the finals series, so is_finals_series, not is_final: a
  // wildcard final is is_final = true but is not a finals appearance (ISSUE-129 §8.4).
  if (matchType === 'finals') return sql`m.is_finals_series`;
  return sql`m.round_type = ${matchType}::round_type`;
}

function scopeSql(plan: NlQueryPlan): SqlFragment {
  const matchup = plan.scope.matchup!;
  const clauses: SqlFragment[] = [sql`
    (
      (home.organization_id = ${matchup.clubA.organizationId}
       AND away.organization_id = ${matchup.clubB.organizationId})
      OR
      (home.organization_id = ${matchup.clubB.organizationId}
       AND away.organization_id = ${matchup.clubA.organizationId})
    )
  `];
  if (plan.scope.venue) clauses.push(sql`m.venue_id = ${plan.scope.venue.id}`);
  if (plan.scope.seasonMin !== undefined) clauses.push(sql`m.season >= ${plan.scope.seasonMin}`);
  if (plan.scope.seasonMax !== undefined) clauses.push(sql`m.season <= ${plan.scope.seasonMax}`);
  if (plan.scope.roundNumber !== undefined) clauses.push(sql`m.round_number = ${plan.scope.roundNumber}`);
  clauses.push(matchTypeSql(plan.scope.matchType));
  return clauses.reduce((all, clause) => sql`${all} AND ${clause}`);
}

/** One physical match row per meeting; organization identity spans historical club eras. */
export async function answerHeadToHead(plan: NlQueryPlan): Promise<NlAnswerPayload> {
  const matchup = plan.scope.matchup!;
  const where = scopeSql(plan);
  const rows = await sql<NlHeadToHeadRow[]>`
    WITH scoped AS (
      SELECT m.id, m.match_date, m.season, m.round_type, m.round_number, m.winner_club_id
        FROM matches m
        JOIN clubs home ON home.id = m.home_club_id
        JOIN clubs away ON away.id = m.away_club_id
       WHERE ${where}
    )
    SELECT a.id AS "clubAId", a.name AS "clubAName", a.slug AS "clubASlug",
           b.id AS "clubBId", b.name AS "clubBName", b.slug AS "clubBSlug",
           (SELECT count(*)::int FROM scoped s
             WHERE s.winner_club_id IN (SELECT id FROM clubs WHERE organization_id = a.id)) AS "clubAWins",
           (SELECT count(*)::int FROM scoped s
             WHERE s.winner_club_id IN (SELECT id FROM clubs WHERE organization_id = b.id)) AS "clubBWins",
           (SELECT count(*)::int FROM scoped s WHERE s.winner_club_id IS NULL) AS draws,
           (SELECT count(*)::int FROM scoped) AS total,
           (SELECT s.id FROM scoped s
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastMatchId",
           (SELECT s.match_date FROM scoped s
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastMatchDate",
           (SELECT s.season FROM scoped s
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastMatchSeason",
           (SELECT s.round_type::text FROM scoped s
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastMatchRoundType",
           (SELECT s.round_number FROM scoped s
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastMatchRoundNumber",
           (SELECT s.id FROM scoped s WHERE s.winner_club_id IS NULL
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastDrawMatchId",
           (SELECT s.match_date FROM scoped s WHERE s.winner_club_id IS NULL
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastDrawDate",
           (SELECT s.season FROM scoped s WHERE s.winner_club_id IS NULL
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastDrawSeason",
           (SELECT s.round_type::text FROM scoped s WHERE s.winner_club_id IS NULL
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastDrawRoundType",
           (SELECT s.round_number FROM scoped s WHERE s.winner_club_id IS NULL
             ORDER BY s.match_date DESC NULLS LAST, s.season DESC, s.id DESC LIMIT 1) AS "lastDrawRoundNumber"
      FROM club_organizations a
      CROSS JOIN club_organizations b
     WHERE a.id = ${matchup.clubA.organizationId}
       AND b.id = ${matchup.clubB.organizationId}
  `;
  return { kind: 'head_to_head', row: rows[0] ?? null };
}
