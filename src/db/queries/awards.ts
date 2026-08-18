import 'server-only';

import { cache } from 'react';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import { parseStatLine } from '@/lib/jsonb';
import type { FilterValues } from '@/search/table-filters';

/**
 * Awards, honours and captaincies.
 *
 * Two rules run through every query here.
 *
 * A **name is not a link.** `award_winners.player_id` is NULL whenever the
 * source name could not be tied to a player with confidence, and 95 Hall
 * of Fame inductees and 100 pre-1979 All-Australians are state-league
 * figures who have no AFLDB player at all. Those rows are returned with
 * the source spelling and no link, never dropped.
 *
 * A **club is named as it was at the time.** Winner rows carry the club
 * identity of their own season, so a 1980 Charles Sutton Medal reads
 * Footscray even though the source said Western Bulldogs.
 */

export type AwardSummary = {
  id: number;
  slug: string;
  name: string;
  category: string;
  competition: string | null;
  description: string | null;
  firstSeason: number | null;
  lastSeason: number | null;
  clubId: number | null;
  clubName: string | null;
  clubSlug: string | null;
  winnerCount: number;
  seasonCount: number;
};

const AWARD_SUMMARY_COLUMNS = sql`
  a.id, a.slug, a.name, a.category, a.competition, a.description,
  a.first_season AS "firstSeason", a.last_season AS "lastSeason",
  a.club_id AS "clubId", c.name AS "clubName", c.slug AS "clubSlug",
  (SELECT count(*) FROM award_winners w WHERE w.award_id = a.id)::int
    AS "winnerCount",
  (SELECT count(DISTINCT w.season) FROM award_winners w WHERE w.award_id = a.id)::int
    AS "seasonCount"
`;

export async function listAwards(): Promise<AwardSummary[]> {
  return sql<AwardSummary[]>`
    SELECT ${AWARD_SUMMARY_COLUMNS}
      FROM awards a
      LEFT JOIN clubs c ON c.id = a.club_id
     ORDER BY a.category, a.name
  `;
}

/**
 * All 39 awards, for a dropdown -- the grid solver's generic "won an
 * award…" builders. Grouped by category (award / club_best_and_fairest /
 * draft_pick / honour_team) so the picker can render an <optgroup>;
 * mirrors getClubOptions() in advanced-search.ts.
 */
export async function getAwardOptions() {
  return sql<{ id: number; name: string; category: string }[]>`
    SELECT id, name, category FROM awards
     ORDER BY category, name
  `;
}

async function fetchAward(slug: string): Promise<AwardSummary | null> {
  const [row] = await sql<AwardSummary[]>`
    SELECT ${AWARD_SUMMARY_COLUMNS}
      FROM awards a
      LEFT JOIN clubs c ON c.id = a.club_id
     WHERE a.slug = ${slug}
  `;
  return row ?? null;
}

export type AwardWinnerRow = {
  id: number;
  season: number | null;
  playerId: number | null;
  playerSlug: string | null;
  playerName: string;
  linkStatus: string;
  clubId: number | null;
  clubName: string | null;
  clubSlug: string | null;
  clubNameRaw: string | null;
  votes: string | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
};

const WINNER_COLUMNS = sql`
  w.id, w.season,
  w.player_id AS "playerId", p.slug AS "playerSlug",
  COALESCE(p.display_name, w.player_name_raw) AS "playerName",
  w.link_status_value::text AS "linkStatus",
  w.club_id AS "clubId", c.name AS "clubName", c.slug AS "clubSlug",
  w.club_name_raw AS "clubNameRaw",
  w.votes, w.position,
  w.is_captain AS "isCaptain", w.is_vice_captain AS "isViceCaptain",
  w.note
`;

/** Every winner of one award, most recent first. */
export async function getAwardWinners(awardId: number): Promise<AwardWinnerRow[]> {
  return sql<AwardWinnerRow[]>`
    SELECT ${WINNER_COLUMNS}
      FROM award_winners w
      LEFT JOIN players p ON p.id = w.player_id
      LEFT JOIN clubs c   ON c.id = w.club_id
     WHERE w.award_id = ${awardId}
     ORDER BY w.season DESC NULLS LAST, w.position NULLS LAST, "playerName"
  `;
}

/** One season of an award — the whole team, for All-Australian. */
export async function getAwardSeason(
  awardId: number,
  season: number,
): Promise<AwardWinnerRow[]> {
  return sql<AwardWinnerRow[]>`
    SELECT ${WINNER_COLUMNS}
      FROM award_winners w
      LEFT JOIN players p ON p.id = w.player_id
      LEFT JOIN clubs c   ON c.id = w.club_id
     WHERE w.award_id = ${awardId} AND w.season = ${season}
     ORDER BY w.is_captain DESC, w.position NULLS LAST, "playerName"
  `;
}

export async function getAwardSeasons(awardId: number): Promise<number[]> {
  const rows = await sql<{ season: number }[]>`
    SELECT DISTINCT season FROM award_winners
     WHERE award_id = ${awardId} AND season IS NOT NULL
     ORDER BY season DESC
  `;
  return rows.map((r) => r.season);
}

/**
 * Players with the most wins of one award.
 *
 * Counted over linked players only: an unlinked row names a person AFLDB
 * cannot identify, so counting it would either invent a multiple winner
 * or split one across two spellings.
 */
export async function getAwardLeaders(awardId: number, limit = 10) {
  return sql<{
    playerId: number; slug: string; displayName: string;
    wins: number; seasons: string;
  }[]>`
    SELECT p.id AS "playerId", p.slug, p.display_name AS "displayName",
           count(*)::int AS wins,
           string_agg(w.season::text, ', ' ORDER BY w.season) AS seasons
      FROM award_winners w
      JOIN players p ON p.id = w.player_id
     WHERE w.award_id = ${awardId}
       AND w.link_status_value IN ('unique','resolved')
     GROUP BY p.id, p.slug, p.display_name
    HAVING count(*) > 1
     ORDER BY count(*) DESC, min(w.season)
     LIMIT ${limit}
  `;
}

// --- Rising Star nominations ---

export type NominationRow = {
  id: number;
  season: number;
  roundNumber: number | null;
  playerId: number | null;
  playerSlug: string | null;
  playerName: string;
  linkStatus: string;
  clubName: string | null;
  clubSlug: string | null;
  opponentName: string | null;
  opponentSlug: string | null;
  isWinner: boolean;
  isIneligible: boolean;
  ineligibleReason: string | null;
  statLine: Record<string, number> | null;
};

/**
 * As the driver hands the row back, before `stat_line` is decoded.
 *
 * jsonb arrives as raw TEXT on this project's client, so the column is read
 * as `unknown` and passed through `parseStatLine` (src/lib/jsonb.ts) rather
 * than being annotated as the object it is not yet.
 */
type RawNominationRow = Omit<NominationRow, 'statLine'> & { statLine: unknown };

const NOMINATION_COLUMNS = sql`
  n.id, n.season, n.round_number AS "roundNumber",
  n.player_id AS "playerId", p.slug AS "playerSlug",
  COALESCE(p.display_name, n.player_name_raw) AS "playerName",
  n.link_status_value::text AS "linkStatus",
  c.name AS "clubName", c.slug AS "clubSlug",
  o.name AS "opponentName", o.slug AS "opponentSlug",
  n.is_winner AS "isWinner", n.is_ineligible AS "isIneligible",
  n.ineligible_reason AS "ineligibleReason",
  n.stat_line AS "statLine"
`;

export async function getNominationsBySeason(
  awardId: number,
  season: number,
): Promise<NominationRow[]> {
  const rows = await sql<RawNominationRow[]>`
    SELECT ${NOMINATION_COLUMNS}
      FROM award_nominations n
      LEFT JOIN players p ON p.id = n.player_id
      LEFT JOIN clubs c   ON c.id = n.club_id
      LEFT JOIN clubs o   ON o.id = n.opponent_club_id
     WHERE n.award_id = ${awardId} AND n.season = ${season}
     ORDER BY n.round_number NULLS LAST, "playerName"
  `;
  return rows.map((row) => ({ ...row, statLine: parseStatLine(row.statLine) }));
}

/** Season winners, for the award's landing page. */
export async function getNominationWinners(awardId: number): Promise<NominationRow[]> {
  const rows = await sql<RawNominationRow[]>`
    SELECT ${NOMINATION_COLUMNS}
      FROM award_nominations n
      LEFT JOIN players p ON p.id = n.player_id
      LEFT JOIN clubs c   ON c.id = n.club_id
      LEFT JOIN clubs o   ON o.id = n.opponent_club_id
     WHERE n.award_id = ${awardId} AND n.is_winner
     ORDER BY n.season DESC
  `;
  return rows.map((row) => ({ ...row, statLine: parseStatLine(row.statLine) }));
}

export async function getNominationSeasons(awardId: number) {
  return sql<{ season: number; nominations: number; winner: string | null }[]>`
    SELECT n.season,
           count(*)::int AS nominations,
           max(CASE WHEN n.is_winner
                    THEN COALESCE(p.display_name, n.player_name_raw) END) AS winner
      FROM award_nominations n
      LEFT JOIN players p ON p.id = n.player_id
     WHERE n.award_id = ${awardId}
     GROUP BY n.season
     ORDER BY n.season DESC
  `;
}

/** Clubs with the most nominations — a genuine "who develops talent" list. */
export async function getNominationsByClub(awardId: number) {
  return sql<{
    clubId: number; name: string; slug: string;
    nominations: number; winners: number;
  }[]>`
    SELECT o.id AS "clubId", o.name, o.slug,
           count(*)::int AS nominations,
           count(*) FILTER (WHERE n.is_winner)::int AS winners
      FROM award_nominations n
      JOIN clubs cl ON cl.id = n.club_id
      JOIN club_organizations o ON o.id = cl.organization_id
     WHERE n.award_id = ${awardId}
     GROUP BY o.id, o.name, o.slug
     ORDER BY count(*) DESC, o.name
  `;
}

// --- Hall of Fame and honour teams ---

export type HallOfFameRow = {
  id: number;
  name: string;
  playerId: number | null;
  playerSlug: string | null;
  linkStatus: string;
  category: string | null;
  inductedYear: number | null;
  isLegend: boolean;
  legendYear: number | null;
  clubNameRaw: string | null;
  state: string | null;
  playingCareer: string | null;
  removedYear: number | null;
};

/** Hall of Fame columns the list may be filtered on. */
export const HALL_OF_FAME_FILTER_COLUMNS: Record<string, string> = {
  inducted: 'h.inducted_year',
};

export type HallOfFameFilters = {
  q?: string;
  category?: string;
  ranges?: FilterValues;
};

export async function listHallOfFame(
  filters: HallOfFameFilters = {},
): Promise<HallOfFameRow[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, HALL_OF_FAME_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`h.name ILIKE ${containsPattern(filters.q)}`);
  if (filters.category) conditions.push(sql`h.category = ${filters.category}`);
  const where = allOf(conditions);

  return sql<HallOfFameRow[]>`
    SELECT h.id, h.name,
           h.player_id AS "playerId", p.slug AS "playerSlug",
           h.link_status_value::text AS "linkStatus",
           h.category, h.inducted_year AS "inductedYear",
           h.is_legend AS "isLegend", h.legend_year AS "legendYear",
           h.club_name_raw AS "clubNameRaw", h.state,
           h.playing_career AS "playingCareer",
           h.removed_year AS "removedYear"
      FROM hall_of_fame h
      LEFT JOIN players p ON p.id = h.player_id
     WHERE ${where}
     ORDER BY h.inducted_year NULLS LAST, h.name
  `;
}

export async function getHallOfFameCategories(): Promise<string[]> {
  const rows = await sql<{ category: string }[]>`
    SELECT DISTINCT category FROM hall_of_fame
     WHERE category IS NOT NULL ORDER BY category
  `;
  return rows.map((r) => r.category);
}

export type HonourTeamMemberRow = {
  id: number;
  teamName: string;
  playerId: number | null;
  playerSlug: string | null;
  playerName: string;
  linkStatus: string;
  position: string | null;
  role: string | null;
  clubNameRaw: string | null;
  sortOrder: number;
  note: string | null;
};

export async function listHonourTeams() {
  return sql<{ teamName: string; members: number; linked: number }[]>`
    SELECT team_name AS "teamName",
           count(*)::int AS members,
           count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked
      FROM honour_team_members
     GROUP BY team_name
     ORDER BY team_name
  `;
}

export async function getHonourTeam(teamName: string): Promise<HonourTeamMemberRow[]> {
  return sql<HonourTeamMemberRow[]>`
    SELECT h.id, h.team_name AS "teamName",
           h.player_id AS "playerId", p.slug AS "playerSlug",
           COALESCE(p.display_name, h.player_name_raw) AS "playerName",
           h.link_status_value::text AS "linkStatus",
           h.position, h.role, h.club_name_raw AS "clubNameRaw",
           h.sort_order AS "sortOrder", h.note
      FROM honour_team_members h
      LEFT JOIN players p ON p.id = h.player_id
     WHERE h.team_name = ${teamName}
     ORDER BY h.sort_order, "playerName"
  `;
}

// --- Per-player and per-club views ---

/** Every honour AFLDB can attribute to one player. */
export async function getPlayerHonours(playerId: number) {
  const [awards, nominations, allAustralian, captaincies, hof, teams, firstKickGoal] = await Promise.all([
    sql<{
      slug: string; name: string; category: string; competition: string | null;
      seasons: string; wins: number;
    }[]>`
      SELECT a.slug, a.name, a.category, a.competition,
             string_agg(w.season::text, ', ' ORDER BY w.season) AS seasons,
             count(*)::int AS wins
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE w.player_id = ${playerId}
         AND w.link_status_value IN ('unique','resolved')
         AND a.slug <> 'all-australian'
       GROUP BY a.id, a.slug, a.name, a.category, a.competition
       ORDER BY min(w.season)
    `,
    sql<{ season: number; roundNumber: number | null; isWinner: boolean }[]>`
      SELECT n.season, n.round_number AS "roundNumber", n.is_winner AS "isWinner"
        FROM award_nominations n
       WHERE n.player_id = ${playerId}
         AND n.link_status_value IN ('unique','resolved')
       ORDER BY n.season, n.round_number
    `,
    sql<{ season: number; position: string | null; isCaptain: boolean }[]>`
      SELECT w.season, w.position, w.is_captain AS "isCaptain"
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE w.player_id = ${playerId}
         AND a.slug = 'all-australian'
         AND w.link_status_value IN ('unique','resolved')
       ORDER BY w.season
    `,
    sql<{ season: number; clubName: string; clubSlug: string; role: string }[]>`
      SELECT cp.season, c.name AS "clubName", c.slug AS "clubSlug", cp.role
        FROM captaincies cp
        JOIN clubs c ON c.id = cp.club_id
       WHERE cp.player_id = ${playerId}
         AND cp.link_status_value IN ('unique','resolved')
       ORDER BY cp.season
    `,
    sql<{
      inductedYear: number | null; isLegend: boolean; legendYear: number | null;
      category: string | null;
    }[]>`
      SELECT inducted_year AS "inductedYear", is_legend AS "isLegend",
             legend_year AS "legendYear", category
        FROM hall_of_fame
       WHERE player_id = ${playerId}
         AND link_status_value IN ('unique','resolved')
       LIMIT 1
    `,
    sql<{ teamName: string; position: string | null }[]>`
      SELECT team_name AS "teamName", position
        FROM honour_team_members
       WHERE player_id = ${playerId}
         AND link_status_value IN ('unique','resolved')
       ORDER BY team_name
    `,
    // A curated achievement (player_achievements, migration 053) rather
    // than an award: no ceremony, no votes, just a recorded feat.
    sql<{
      season: number; roundRaw: string; clubName: string | null; clubSlug: string | null;
      consecutiveGoalKicks: number; noFurtherCareerGoals: boolean; noFurtherCareerKicks: boolean;
      kicklessMatchesBeforeFirstKick: number;
      opponentName: string | null; opponentSlug: string | null;
    }[]>`
      SELECT a.season, a.round_raw AS "roundRaw",
             c.name AS "clubName", c.slug AS "clubSlug",
             a.consecutive_goal_kicks AS "consecutiveGoalKicks",
             a.no_further_career_goals AS "noFurtherCareerGoals",
             a.no_further_career_kicks AS "noFurtherCareerKicks",
             a.kickless_matches_before_first_kick AS "kicklessMatchesBeforeFirstKick",
             opp.name AS "opponentName", opp.slug AS "opponentSlug"
        FROM player_achievements a
        LEFT JOIN clubs c ON c.id = a.club_id
        LEFT JOIN matches m ON m.id = a.match_id
        -- The opponent is whichever side of the match the player's club
        -- was not; null when the match or the club never resolved.
        LEFT JOIN clubs opp ON opp.id = CASE
          WHEN m.home_club_id = a.club_id THEN m.away_club_id
          WHEN m.away_club_id = a.club_id THEN m.home_club_id
        END
       WHERE a.player_id = ${playerId}
         AND a.achievement_type = 'first_kick_goal'
         AND a.link_status_value IN ('unique','resolved')
       LIMIT 1
    `,
  ]);

  return {
    awards,
    nominations,
    allAustralian,
    captaincies,
    hallOfFame: hof[0] ?? null,
    honourTeams: teams,
    firstKickGoal: firstKickGoal[0] ?? null,
    total: awards.length + allAustralian.length + captaincies.length
      + teams.length + (hof.length ? 1 : 0) + nominations.length
      + firstKickGoal.length,
  };
}

/**
 * Awards presented by one club, across every era of the club.
 *
 * Scoped by lineage, so the Western Bulldogs page shows the Charles
 * Sutton Medal won under the Footscray name as well.
 */
export async function getClubAwards(clubId: number) {
  return sql<{
    slug: string; name: string; winnerCount: number;
    firstSeason: number | null; lastSeason: number | null;
  }[]>`
    SELECT a.slug, a.name,
           count(w.id)::int AS "winnerCount",
           min(w.season) AS "firstSeason", max(w.season) AS "lastSeason"
      FROM awards a
      JOIN award_winners w ON w.award_id = a.id
     WHERE a.club_id IN (
             SELECT id FROM clubs
              WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
           )
        OR w.club_id IN (
             SELECT id FROM clubs
              WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
           )
     GROUP BY a.id, a.slug, a.name
     ORDER BY count(w.id) DESC, a.name
  `;
}

/** Best-and-fairest winners for a club, newest first. */
export async function getClubBestAndFairest(clubId: number, limit = 20) {
  return sql<{
    season: number | null; playerId: number | null; playerSlug: string | null;
    playerName: string; linkStatus: string; awardName: string; awardSlug: string;
  }[]>`
    SELECT w.season, w.player_id AS "playerId", p.slug AS "playerSlug",
           COALESCE(p.display_name, w.player_name_raw) AS "playerName",
           w.link_status_value::text AS "linkStatus",
           a.name AS "awardName", a.slug AS "awardSlug"
      FROM award_winners w
      JOIN awards a ON a.id = w.award_id
      LEFT JOIN players p ON p.id = w.player_id
     WHERE a.category = 'club_best_and_fairest'
       AND w.club_id IN (
             SELECT id FROM clubs
              WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
           )
     ORDER BY w.season DESC
     LIMIT ${limit}
  `;
}

export async function getClubCaptains(clubId: number) {
  return sql<{
    season: number; playerId: number | null; playerSlug: string | null;
    playerName: string; linkStatus: string; role: string; period: string | null;
    identityName: string;
  }[]>`
    SELECT cp.season, cp.player_id AS "playerId", p.slug AS "playerSlug",
           COALESCE(p.display_name, cp.player_name_raw) AS "playerName",
           cp.link_status_value::text AS "linkStatus",
           cp.role, cp.period, c.name AS "identityName"
      FROM captaincies cp
      JOIN clubs c ON c.id = cp.club_id
      LEFT JOIN players p ON p.id = cp.player_id
     WHERE cp.club_id IN (
             SELECT id FROM clubs
              WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
           )
     ORDER BY cp.season DESC, cp.role
  `;
}

/**
 * Deduplicated per request.
 *
 * generateMetadata and the page body both need this row, and neither can
 * hand it to the other — Next calls them separately. Without React's
 * cache() that is two identical queries for every render of an entity
 * page, doubling the cost of the pages a crawler spends most of its time
 * on. Outside a request scope cache() calls straight through, so the
 * import tools and the test suite are unaffected.
 */
export const getAward = cache(fetchAward);
