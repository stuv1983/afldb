import 'server-only';

import { sql } from '@/db/client';
import { allOf, type SqlFragment } from '@/db/queries/filters';
import { containsPattern } from '@/lib/like';

/**
 * Curated achievements from player_achievements (migration 053).
 *
 * A sibling of awards.ts, not an extension of records.ts: that module is
 * the computed-leaderboard mechanism (rank() over an existing numeric
 * column), and these facts have no backing column to rank -- AFLDB has no
 * play-by-play data, so "their first kick was a goal" exists only because
 * a cited source says so.
 *
 * Unlinked rows are kept and shown. The source spelling is evidence even
 * when it names nobody AFLDB can identify, and hiding those rows would
 * quietly overstate how complete the linking is. Aggregates count linked
 * rows only, which is why the page states both numbers.
 */

const FIRST_KICK_GOAL = sql`achievement_type = 'first_kick_goal'`;
const LINKED = sql`player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')`;

export type FirstKickGoalRow = {
  id: number;
  playerId: number | null;
  playerSlug: string | null;
  playerName: string;
  linkStatus: string;
  season: number;
  roundRaw: string;
  clubName: string | null;
  clubSlug: string | null;
  opponentName: string | null;
  opponentSlug: string | null;
  matchId: number | null;
  consecutiveGoalKicks: number;
  noFurtherCareerGoals: boolean;
  noFurtherCareerKicks: boolean;
  kicklessMatchesBeforeFirstKick: number;
};

export type FirstKickGoalFeature = 'multi-kick' | 'only-career-goal';

export type FirstKickGoalFilters = {
  q?: string;
  club?: string;
  decade?: number;
  feature?: FirstKickGoalFeature;
};

export async function getFirstKickGoalList(filters: FirstKickGoalFilters = {}): Promise<FirstKickGoalRow[]> {
  const conditions: SqlFragment[] = [];
  if (filters.q) {
    conditions.push(sql`COALESCE(p.display_name, a.player_name_clean) ILIKE ${containsPattern(filters.q)}`);
  }
  if (filters.club) {
    // By lineage, so the Western Bulldogs filter includes Footscray rows.
    conditions.push(sql`
      cl.organization_id = (SELECT organization_id FROM clubs WHERE slug = ${filters.club})
    `);
  }
  if (filters.decade !== undefined) {
    conditions.push(sql`a.season BETWEEN ${filters.decade} AND ${filters.decade + 9}`);
  }
  if (filters.feature === 'multi-kick') {
    conditions.push(sql`a.consecutive_goal_kicks > 1`);
  } else if (filters.feature === 'only-career-goal') {
    conditions.push(sql`a.no_further_career_goals`);
  }
  const where = allOf(conditions);

  return sql<FirstKickGoalRow[]>`
    SELECT a.id,
           a.player_id AS "playerId", p.slug AS "playerSlug",
           COALESCE(p.display_name, a.player_name_clean) AS "playerName",
           a.link_status_value AS "linkStatus",
           a.season, a.round_raw AS "roundRaw",
           cl.name AS "clubName", cl.slug AS "clubSlug",
           opp.name AS "opponentName", opp.slug AS "opponentSlug",
           a.match_id AS "matchId",
           a.consecutive_goal_kicks AS "consecutiveGoalKicks",
           a.no_further_career_goals AS "noFurtherCareerGoals",
           a.no_further_career_kicks AS "noFurtherCareerKicks",
           a.kickless_matches_before_first_kick AS "kicklessMatchesBeforeFirstKick"
      FROM player_achievements a
      LEFT JOIN players p ON p.id = a.player_id
      LEFT JOIN clubs cl ON cl.id = a.club_id
      LEFT JOIN matches m ON m.id = a.match_id
      LEFT JOIN clubs opp ON opp.id = CASE
        WHEN m.home_club_id = a.club_id THEN m.away_club_id
        WHEN m.away_club_id = a.club_id THEN m.home_club_id
      END
     WHERE a.${FIRST_KICK_GOAL} AND ${where}
     ORDER BY a.season, a.id
  `;
}

export async function getFirstKickGoalSummary(): Promise<{
  total: number;
  linked: number;
  unlinked: number;
  earliestSeason: number | null;
  latestSeason: number | null;
  multiKick: number;
  onlyCareerGoal: number;
  matchesResolved: number;
}> {
  const [row] = await sql<{
    total: number; linked: number; unlinked: number;
    earliestSeason: number | null; latestSeason: number | null;
    multiKick: number; onlyCareerGoal: number; matchesResolved: number;
  }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ${LINKED})::int AS linked,
           count(*) FILTER (WHERE NOT (${LINKED}))::int AS unlinked,
           min(season)::int AS "earliestSeason",
           max(season)::int AS "latestSeason",
           count(*) FILTER (WHERE consecutive_goal_kicks > 1)::int AS "multiKick",
           count(*) FILTER (WHERE no_further_career_goals)::int AS "onlyCareerGoal",
           count(*) FILTER (WHERE match_id IS NOT NULL)::int AS "matchesResolved"
      FROM player_achievements
     WHERE ${FIRST_KICK_GOAL}
  `;
  return row;
}

export type FirstKickGoalHighlight = {
  playerId: number | null;
  playerSlug: string | null;
  playerName: string;
  season: number;
  roundRaw: string;
  matchId: number | null;
};

/**
 * The earliest- and most-recent-dated rows, each with enough detail (player,
 * round, match) to link to rather than just the bare year the stat strip
 * showed before. Ties (more than one row in the extreme season) resolve to
 * the lowest `id`, i.e. import order -- an arbitrary but stable pick rather
 * than an undefined one.
 */
export async function getFirstKickGoalHighlights(): Promise<{
  earliest: FirstKickGoalHighlight | null;
  latest: FirstKickGoalHighlight | null;
}> {
  const rows = await sql<(FirstKickGoalHighlight & { which: 'earliest' | 'latest' })[]>`
    (SELECT 'earliest' AS which, a.player_id AS "playerId", p.slug AS "playerSlug",
            COALESCE(p.display_name, a.player_name_clean) AS "playerName",
            a.season, a.round_raw AS "roundRaw", a.match_id AS "matchId"
       FROM player_achievements a
       LEFT JOIN players p ON p.id = a.player_id
      WHERE a.${FIRST_KICK_GOAL}
      ORDER BY a.season ASC, a.id ASC
      LIMIT 1)
    UNION ALL
    (SELECT 'latest' AS which, a.player_id AS "playerId", p.slug AS "playerSlug",
            COALESCE(p.display_name, a.player_name_clean) AS "playerName",
            a.season, a.round_raw AS "roundRaw", a.match_id AS "matchId"
       FROM player_achievements a
       LEFT JOIN players p ON p.id = a.player_id
      WHERE a.${FIRST_KICK_GOAL}
      ORDER BY a.season DESC, a.id DESC
      LIMIT 1)
  `;
  return {
    earliest: rows.find((r) => r.which === 'earliest') ?? null,
    latest: rows.find((r) => r.which === 'latest') ?? null,
  };
}

/** Linked rows by club lineage, the same shape as getNominationsByClub. */
export async function getFirstKickGoalByClub() {
  return sql<{ name: string; slug: string; players: number; earliest: number; latest: number }[]>`
    SELECT o.name, o.slug,
           count(*)::int AS players,
           min(a.season)::int AS earliest,
           max(a.season)::int AS latest
      FROM player_achievements a
      JOIN clubs cl ON cl.id = a.club_id
      JOIN club_organizations o ON o.id = cl.organization_id
     WHERE a.${FIRST_KICK_GOAL} AND a.${LINKED}
     GROUP BY o.id, o.name, o.slug
     ORDER BY count(*) DESC, o.name
  `;
}

export async function getFirstKickGoalByDecade() {
  return sql<{ decade: number; players: number }[]>`
    SELECT (season / 10) * 10 AS decade, count(*)::int AS players
      FROM player_achievements
     WHERE ${FIRST_KICK_GOAL} AND ${LINKED}
     GROUP BY (season / 10) * 10
     ORDER BY (season / 10) * 10
  `;
}

/** Clubs with no recorded instance -- a real answer, not an empty result. */
export async function getClubsWithoutFirstKickGoal() {
  return sql<{ name: string; slug: string }[]>`
    SELECT o.name, o.slug
      FROM club_organizations o
     WHERE NOT EXISTS (
       SELECT 1 FROM player_achievements a
         JOIN clubs cl ON cl.id = a.club_id
        WHERE cl.organization_id = o.id
          AND a.${FIRST_KICK_GOAL} AND a.${LINKED}
     )
     ORDER BY o.name
  `;
}

/**
 * The source and how much of it linked, for the provenance note. Read
 * from sources/import_batches rather than restated in the page, so the
 * page cannot drift from what was actually imported.
 */
export async function getFirstKickGoalProvenance() {
  const [row] = await sql<{
    name: string; url: string | null; description: string | null; importedAt: Date | null;
  }[]>`
    SELECT s.name, s.url, s.description, max(a.imported_at) AS "importedAt"
      FROM player_achievements a
      JOIN sources s ON s.id = a.source_id
     WHERE a.${FIRST_KICK_GOAL}
     GROUP BY s.id, s.name, s.url, s.description
     LIMIT 1
  `;
  return row ?? null;
}
