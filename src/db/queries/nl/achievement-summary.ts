import 'server-only';

import { sql } from '@/db/client';
import { allOf, type SqlFragment } from '@/db/queries/filters';
import { clubPath, playerPath, seasonPath } from '@/lib/format';
import { NL_ACHIEVEMENTS, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAchievementGroupRow, NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * Summaries OF an achievement: how its holders distribute across clubs,
 * decades and seasons, which clubs have never had one, and the first and
 * most recent occurrences.
 *
 * Every query here is hand-written per summary kind rather than assembled
 * from fragments. The achievement itself reaches SQL as a bound parameter
 * taken from NL_ACHIEVEMENTS, never as text from the question -- the same
 * allowlist-then-bind rule the grid solver's builders follow.
 *
 * Only linked rows count. An unmatched source row is still stored (the
 * spelling is evidence), but it names nobody, so counting it would inflate
 * a club's tally with a player who might already be in it under a name
 * that did resolve.
 *
 * The plan's season range and club scope are honoured by every kind
 * (validatePlan rejects the scopes no summary can express, and clubFor on
 * clubs_without): "since 2000" and "Carlton ... by decade" filter the
 * rows being summarised, and the header total is scoped the same way so
 * "measured across N players" describes the population actually counted.
 */
const LINKED = sql`player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')`;

export async function answerAchievementSummary(plan: NlQueryPlan): Promise<NlAnswerPayload> {
  const summary = plan.achievementSummary!;
  const achievement = NL_ACHIEVEMENTS[summary.achievementKey];
  const type = achievement.value;

  // Scope conditions over the achievement rows themselves (alias `a`):
  // the season the feat happened in and the club it was done FOR, by
  // lineage like every club filter in this codebase. An IN-subquery
  // rather than a join, so the same fragment drops into every query
  // regardless of whether it already joins clubs.
  const { seasonMin, seasonMax, clubFor } = plan.scope;
  const scopeConditions: SqlFragment[] = [];
  if (seasonMin !== undefined) scopeConditions.push(sql`a.season >= ${seasonMin}`);
  if (seasonMax !== undefined) scopeConditions.push(sql`a.season <= ${seasonMax}`);
  if (clubFor) {
    scopeConditions.push(sql`a.club_id IN (SELECT id FROM clubs WHERE organization_id = ${clubFor.organizationId})`);
  }
  const scoped = allOf(scopeConditions);

  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM player_achievements a
     WHERE a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
  `;

  const base = { kind: 'achievement_summary' as const, achievementLabel: achievement.label, total };

  switch (summary.kind) {
    case 'by_club': {
      // Grouped by organization, not by club identity, so Footscray and
      // the Western Bulldogs are one lineage -- the convention every club
      // aggregate in this codebase follows.
      const rows = await sql<{ label: string; value: number; slug: string }[]>`
        SELECT o.name AS label, count(*)::int AS value, o.slug
          FROM player_achievements a
          JOIN clubs cl ON cl.id = a.club_id
          JOIN club_organizations o ON o.id = cl.organization_id
         WHERE a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
         GROUP BY o.id, o.name, o.slug
         ORDER BY count(*) DESC, o.name
      `;
      return { ...base, groupBy: 'club', rows: rows.map((r) => ({ label: r.label, value: r.value, href: clubPath(r.slug) })) };
    }

    case 'clubs_without': {
      // Clubs are listed by organization, and a defunct club counts: a
      // question about who has never had one is asking about the whole
      // history, not just the 18 current teams. A season scope narrows
      // the occurrences being checked ("never had one since 2000"), not
      // the clubs being listed.
      const rows = await sql<{ label: string; slug: string }[]>`
        SELECT o.name AS label, o.slug
          FROM club_organizations o
         WHERE NOT EXISTS (
           SELECT 1 FROM player_achievements a
             JOIN clubs cl ON cl.id = a.club_id
            WHERE cl.organization_id = o.id
              AND a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
         )
         ORDER BY o.name
      `;
      return { ...base, groupBy: 'club', rows: rows.map((r) => ({ label: r.label, value: 0, href: clubPath(r.slug) })) };
    }

    case 'by_decade': {
      const rows = await sql<{ decade: number; value: number }[]>`
        SELECT (a.season / 10) * 10 AS decade, count(*)::int AS value
          FROM player_achievements a
         WHERE a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
         GROUP BY (a.season / 10) * 10
         ORDER BY (a.season / 10) * 10
      `;
      return { ...base, groupBy: 'decade', rows: rows.map((r) => ({ label: `${r.decade}s`, value: r.value, href: null })) };
    }

    case 'by_season': {
      const rows = await sql<{ season: number; value: number }[]>`
        SELECT a.season, count(*)::int AS value
          FROM player_achievements a
         WHERE a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
         GROUP BY a.season
         ORDER BY count(*) DESC, a.season DESC
      `;
      return { ...base, groupBy: 'season', rows: rows.map((r) => ({ label: String(r.season), value: r.value, href: seasonPath(r.season) })) };
    }

    case 'earliest':
    case 'latest': {
      // Ordered by the match date where the game is known, so "the most
      // recent" is one occurrence rather than everyone who shares the
      // latest season. Rows still tie when they genuinely fall on the
      // same day, and a row with no resolved match can only tie on
      // season -- picking between those would invent a precision the
      // data does not have.
      const rows = await sql<{
        season: number; playerId: number; playerName: string; playerSlug: string; roundRaw: string;
      }[]>`
        WITH occurrence AS (
          SELECT a.season, a.player_id, a.round_raw, m.match_date,
                 rank() OVER (
                   ORDER BY a.season ${summary.kind === 'earliest' ? sql`ASC` : sql`DESC`},
                            m.match_date ${summary.kind === 'earliest' ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`}
                 ) AS position
            FROM player_achievements a
            LEFT JOIN matches m ON m.id = a.match_id
           WHERE a.achievement_type = ${type} AND a.${LINKED} AND ${scoped}
        )
        SELECT o.season, o.player_id AS "playerId", p.display_name AS "playerName",
               p.slug AS "playerSlug", o.round_raw AS "roundRaw"
          FROM occurrence o
          JOIN players p ON p.id = o.player_id
         WHERE o.position = 1
         ORDER BY p.sort_name
      `;
      const mapped: NlAchievementGroupRow[] = rows.map((r) => ({
        label: `${r.playerName} (${r.roundRaw === '' ? '' : `Round ${r.roundRaw}, `}${r.season})`,
        value: r.season,
        href: playerPath(r.playerSlug, r.playerId),
      }));
      return { ...base, groupBy: 'occurrence', rows: mapped };
    }
  }
}
