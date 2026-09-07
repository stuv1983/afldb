import 'server-only';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

export type VenueSummary = {
  id: number;
  slug: string;
  canonicalName: string;
  firstSeason: number | null;
  lastSeason: number | null;
  matches: number;
};

/**
 * Venue columns the index may be filtered on.
 *
 * `matches` is a count, so it is pre-aggregated in the subquery below and
 * filtered as an ordinary column — the same shape `aflw.venues` gives the
 * AFLW side. Special-casing it here would leave one filter outside the
 * mechanism every other filter goes through.
 */
export const VENUE_FILTER_COLUMNS: Record<string, string> = {
  first_season: 'v.first_season',
  last_season: 'v.last_season',
  matches: 'v.matches',
};

export type VenueFilters = { q?: string; state?: string; ranges?: FilterValues };

export async function listVenues(filters: VenueFilters = {}): Promise<VenueSummary[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, VENUE_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`v.canonical_name ILIKE ${containsPattern(filters.q)}`);
  if (filters.state) conditions.push(sql`v.state = ${filters.state}`);
  const where = allOf(conditions);

  return sql<VenueSummary[]>`
    SELECT v.id, v.slug, v.canonical_name AS "canonicalName",
           v.first_season AS "firstSeason", v.last_season AS "lastSeason",
           v.matches
      FROM (
        SELECT v.id, v.slug, v.canonical_name, v.first_season, v.last_season, v.state,
               COALESCE(m.matches, 0) AS matches
          FROM venues v
          LEFT JOIN (
            SELECT venue_id, count(*)::int AS matches FROM matches GROUP BY venue_id
          ) m ON m.venue_id = v.id
      ) v
     WHERE ${where}
     ORDER BY v.matches DESC, v.canonical_name
  `;
}

export async function getVenueStates(): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT DISTINCT state FROM venues WHERE state IS NOT NULL ORDER BY state
  `;
  return rows.map((r) => r.state);
}

// =====================================================================
// AFLDB-ISSUE-150 — venue historical record page
//
// Every function here is scoped to one venue by `matches.venue_id` and
// mirrors the semantics of `ISSUE-150-venue-evidence.sql`, which is the
// correctness contract:
//
//  - historical club identities are preserved — the club columns come
//    straight from `matches.home_club_id` / `away_club_id`, never folded
//    into `clubs.current_identity_id` / `organization_id`;
//  - `matches.attendance` is NULL when the crowd was never recorded and
//    is never coerced to 0; a genuine recorded 0 is kept;
//  - "lowest recorded attendance" is the minimum non-NULL attendance,
//    a legitimate 0 included;
//  - `matches.home_score` / `away_score` are `NOT NULL`, so scores and
//    margins have no unrecorded case;
//  - `player_match_stats` marks / kicks / handballs / goals are NULL for
//    the eras they were not collected in; statistical totals SUM only the
//    rows where the statistic is recorded and never COALESCE a NULL to 0;
//  - every leaderboard and record has a deterministic tie-break so the
//    database's natural row order never decides which row is shown.
// =====================================================================

/** A match rendered as a linked record row. */
export type VenueMatchBrief = {
  id: number;
  season: number;
  matchDate: Date;
  roundType: string;
  roundNumber: number | null;
  homeName: string;
  homeSlug: string;
  awayName: string;
  awaySlug: string;
  homeScore: number;
  awayScore: number;
  /** matches.attendance — NULL where the crowd was never recorded, never 0. */
  attendance: number | null;
};

const VENUE_MATCH_BRIEF_COLUMNS = sql`
  m.id, m.season, m.match_date AS "matchDate",
  m.round_type AS "roundType", m.round_number AS "roundNumber",
  h.name AS "homeName", h.slug AS "homeSlug",
  a.name AS "awayName", a.slug AS "awaySlug",
  m.home_score AS "homeScore", m.away_score AS "awayScore",
  m.attendance
`;

const VENUE_MATCH_BRIEF_JOINS = sql`
  JOIN clubs h ON h.id = m.home_club_id
  JOIN clubs a ON a.id = m.away_club_id
`;

export type VenueOverview = {
  /** Total AFL/VFL matches recorded at the venue. */
  matches: number;
  /** Matches with a recorded (non-NULL) attendance. */
  matchesWithAttendance: number;
  /** Mean of the recorded attendances, or NULL when none is recorded. */
  avgAttendance: number | null;
  firstMatch: VenueMatchBrief | null;
  latestMatch: VenueMatchBrief | null;
};

/**
 * Headline venue overview (evidence §1, §2): total matches, recorded-
 * attendance coverage, and the first and most recent recorded match with
 * enough context to be useful (date, teams, score). The match picks are
 * ordered `match_date, id` and `match_date DESC, id DESC` — `matches.id`
 * is unique, so each is a single deterministic row.
 *
 * `avg(attendance)` ignores NULLs by definition, so an unrecorded crowd
 * never drags the average toward zero.
 */
export async function getVenueOverview(venueId: number): Promise<VenueOverview> {
  const [[totals], [firstMatch], [latestMatch]] = await Promise.all([
    sql<{
      matches: number; matchesWithAttendance: number; avgAttendance: number | null;
    }[]>`
      SELECT count(*)::int AS matches,
             count(attendance)::int AS "matchesWithAttendance",
             round(avg(attendance))::int AS "avgAttendance"
        FROM matches WHERE venue_id = ${venueId}
    `,
    sql<VenueMatchBrief[]>`
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS}
        FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
       WHERE m.venue_id = ${venueId}
       ORDER BY m.match_date, m.id
       LIMIT 1
    `,
    sql<VenueMatchBrief[]>`
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS}
        FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
       WHERE m.venue_id = ${venueId}
       ORDER BY m.match_date DESC, m.id DESC
       LIMIT 1
    `,
  ]);

  return {
    matches: totals.matches,
    matchesWithAttendance: totals.matchesWithAttendance,
    avgAttendance: totals.avgAttendance,
    firstMatch: firstMatch ?? null,
    latestMatch: latestMatch ?? null,
  };
}

export type VenueClubRecordRow = {
  /** The historical club identity that played, never folded to the modern one. */
  clubId: number;
  clubName: string;
  clubSlug: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** wins / games * 100. Draws are NOT counted as half-wins. */
  winPct: number;
};

/**
 * Win–draw–loss record of every historical club identity that has played
 * at the venue (evidence §3).
 *
 * A `club_games` set unions the venue's matches once from the home
 * club's perspective and once from the away club's, so `score_for` /
 * `score_against` read the same way regardless of which side the club
 * was. Grouped by the raw `clubs.id` from the match, so Footscray and
 * the Western Bulldogs — and South Melbourne and the Sydney Swans —
 * stay separate rows for the eras they actually played under.
 *
 * Win percentage is `wins / games * 100`, the plain definition; a draw
 * is not half a win. Ordered `games DESC, wins DESC, name, id` — the id
 * is the final tie-break so the order is total.
 */
export async function getVenueClubRecords(venueId: number): Promise<VenueClubRecordRow[]> {
  return sql<VenueClubRecordRow[]>`
    WITH club_games AS (
      SELECT m.home_club_id AS club_id,
             m.home_score    AS score_for,
             m.away_score    AS score_against
        FROM matches m
       WHERE m.venue_id = ${venueId}
      UNION ALL
      SELECT m.away_club_id AS club_id,
             m.away_score    AS score_for,
             m.home_score    AS score_against
        FROM matches m
       WHERE m.venue_id = ${venueId}
    )
    SELECT c.id   AS "clubId",
           c.name AS "clubName",
           c.slug AS "clubSlug",
           count(*)::int AS games,
           count(*) FILTER (WHERE cg.score_for > cg.score_against)::int AS wins,
           count(*) FILTER (WHERE cg.score_for = cg.score_against)::int AS draws,
           count(*) FILTER (WHERE cg.score_for < cg.score_against)::int AS losses,
           (round(
             100.0 * count(*) FILTER (WHERE cg.score_for > cg.score_against)
                   / nullif(count(*), 0),
             2))::float8 AS "winPct"
      FROM club_games cg
      JOIN clubs c ON c.id = cg.club_id
     GROUP BY c.id, c.name, c.slug
     ORDER BY games DESC, wins DESC, c.name, c.id
  `;
}

/** A single-team score at the venue, with the opposing team for context. */
export type VenueScoreRecord = VenueMatchBrief & {
  /** The team that posted `score`. */
  scoringClubName: string;
  scoringClubSlug: string;
  score: number;
  opponentScore: number;
};

export type VenueMarginRecord = VenueMatchBrief & { margin: number };

export type VenueRecords = {
  highestAttendance: VenueMatchBrief | null;
  /** Minimum non-NULL attendance — a legitimate recorded 0 counts. */
  lowestAttendance: VenueMatchBrief | null;
  highestScore: VenueScoreRecord | null;
  biggestMargin: VenueMarginRecord | null;
};

/**
 * The venue's compact record board (evidence §4, §6, §7):
 *
 *  - **highest / lowest recorded attendance** — `attendance IS NOT NULL`,
 *    ordered `attendance DESC|ASC, match_date, id`. A NULL crowd is never
 *    a small crowd and never appears; a recorded 0 is a real minimum.
 *  - **highest team score** — a home/away union of single-team scores,
 *    `score DESC, match_date, match_id, club_id`.
 *  - **biggest winning margin** — `home_score <> away_score`, ordered
 *    `abs(home_score - away_score) DESC, match_date, id`.
 *
 * Every ORDER BY ends on a unique column, so each record is one row and
 * a shared value never lets row order decide the winner. A venue with no
 * matches (or none with a recorded crowd) yields `null` for that record.
 */
export async function getVenueRecords(venueId: number): Promise<VenueRecords> {
  const [highAtt, lowAtt, highScore, bigMargin] = await Promise.all([
    sql<VenueMatchBrief[]>`
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS}
        FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
       WHERE m.venue_id = ${venueId} AND m.attendance IS NOT NULL
       ORDER BY m.attendance DESC, m.match_date, m.id
       LIMIT 1
    `,
    sql<VenueMatchBrief[]>`
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS}
        FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
       WHERE m.venue_id = ${venueId} AND m.attendance IS NOT NULL
       ORDER BY m.attendance ASC, m.match_date, m.id
       LIMIT 1
    `,
    sql<VenueScoreRecord[]>`
      WITH team_scores AS (
        SELECT m.id AS match_id, m.match_date,
               m.home_club_id AS club_id, m.away_club_id AS opponent_id,
               m.home_score   AS score,   m.away_score   AS opponent_score
          FROM matches m
         WHERE m.venue_id = ${venueId}
        UNION ALL
        SELECT m.id AS match_id, m.match_date,
               m.away_club_id AS club_id, m.home_club_id AS opponent_id,
               m.away_score   AS score,   m.home_score   AS opponent_score
          FROM matches m
         WHERE m.venue_id = ${venueId}
      )
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS},
             sc.name AS "scoringClubName", sc.slug AS "scoringClubSlug",
             ts.score AS score, ts.opponent_score AS "opponentScore"
        FROM team_scores ts
        JOIN matches m ON m.id = ts.match_id ${VENUE_MATCH_BRIEF_JOINS}
        JOIN clubs sc ON sc.id = ts.club_id
       ORDER BY ts.score DESC, ts.match_date, ts.match_id, ts.club_id
       LIMIT 1
    `,
    sql<VenueMarginRecord[]>`
      SELECT ${VENUE_MATCH_BRIEF_COLUMNS},
             abs(m.home_score - m.away_score) AS margin
        FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
       WHERE m.venue_id = ${venueId} AND m.home_score <> m.away_score
       ORDER BY abs(m.home_score - m.away_score) DESC, m.match_date, m.id
       LIMIT 1
    `,
  ]);

  return {
    highestAttendance: highAtt[0] ?? null,
    lowestAttendance: lowAtt[0] ?? null,
    highestScore: highScore[0] ?? null,
    biggestMargin: bigMargin[0] ?? null,
  };
}

export type VenueLeaderCategory = 'games' | 'goals' | 'marks' | 'kicks' | 'handballs';

export type VenueLeaderRow = {
  rank: number;
  playerId: number;
  playerName: string;
  playerSlug: string;
  /** Games played, or the SUM of a recorded statistic. */
  value: number;
  /**
   * Matches this total is drawn from. For `games` it equals `value`. For
   * a statistic it is the count of matches at the venue where that
   * statistic was recorded for the player — always <= their games, and
   * the wording the UI shows so a sparse-era total is not read as a
   * complete one.
   */
  recordedGames: number;
};

export type VenuePlayerLeaders = Record<VenueLeaderCategory, VenueLeaderRow[]>;

/**
 * Top five players at the venue for games, goals, marks, kicks and
 * handballs (evidence §8–§12), in a single round trip.
 *
 *  - **games** counts `player_match_stats` rows at the venue (one per
 *    player per match).
 *  - **goals / marks / kicks / handballs** SUM the statistic over only
 *    the venue matches where it `IS NOT NULL`. A NULL — the statistic was
 *    not collected in that era — is excluded from the sum, never treated
 *    as 0, so the marks / kicks / handballs boards do not imply complete
 *    historical coverage.
 *
 * Each board is ranked `value DESC, player_id` (the evidence tie-break —
 * `players.id` is unique, so the order is total) and cut to five.
 */
export async function getVenuePlayerLeaders(venueId: number): Promise<VenuePlayerLeaders> {
  const rows = await sql<(VenueLeaderRow & { category: VenueLeaderCategory })[]>`
    WITH venue_stats AS (
      SELECT pms.player_id, pms.goals, pms.marks, pms.kicks, pms.handballs
        FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
       WHERE m.venue_id = ${venueId}
    ),
    agg AS (
      SELECT 'games'::text AS category, player_id,
             count(*)::int AS value, count(*)::int AS recorded_games
        FROM venue_stats GROUP BY player_id
      UNION ALL
      SELECT 'goals', player_id, sum(goals)::int, count(goals)::int
        FROM venue_stats WHERE goals IS NOT NULL GROUP BY player_id
      UNION ALL
      SELECT 'marks', player_id, sum(marks)::int, count(marks)::int
        FROM venue_stats WHERE marks IS NOT NULL GROUP BY player_id
      UNION ALL
      SELECT 'kicks', player_id, sum(kicks)::int, count(kicks)::int
        FROM venue_stats WHERE kicks IS NOT NULL GROUP BY player_id
      UNION ALL
      SELECT 'handballs', player_id, sum(handballs)::int, count(handballs)::int
        FROM venue_stats WHERE handballs IS NOT NULL GROUP BY player_id
    ),
    ranked AS (
      SELECT a.*,
             row_number() OVER (
               PARTITION BY a.category
               ORDER BY a.value DESC, a.player_id
             ) AS rank
        FROM agg a
    )
    SELECT r.category,
           r.rank::int AS rank,
           p.id   AS "playerId",
           p.display_name AS "playerName",
           p.slug AS "playerSlug",
           r.value,
           r.recorded_games AS "recordedGames"
      FROM ranked r
      JOIN players p ON p.id = r.player_id
     WHERE r.rank <= 5
     ORDER BY r.category, r.rank
  `;

  const leaders: VenuePlayerLeaders = {
    games: [], goals: [], marks: [], kicks: [], handballs: [],
  };
  for (const { category, ...row } of rows) leaders[category].push(row);
  return leaders;
}

export type VenueMatchRow = VenueMatchBrief;

/**
 * The venue's complete match history, one page at a time (evidence has
 * no LIMIT — the page supplies `limit` / `offset`).
 *
 * Ordered `match_date DESC, id DESC` — newest first, `id` breaking a
 * shared date so paging is stable. `count(*) OVER ()` returns the total
 * alongside the page; an empty page (offset past the end) falls back to
 * a plain count so the caller still learns the total, exactly as
 * `getPlayerMatches` does.
 */
export async function getVenueMatches(
  venueId: number,
  options: { limit: number; offset: number },
): Promise<{ rows: VenueMatchRow[]; total: number }> {
  const { limit, offset } = options;

  const rows = await sql<(VenueMatchRow & { total: string })[]>`
    SELECT ${VENUE_MATCH_BRIEF_COLUMNS},
           count(*) OVER () AS total
      FROM matches m ${VENUE_MATCH_BRIEF_JOINS}
     WHERE m.venue_id = ${venueId}
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${limit} OFFSET ${offset}
  `;
  if (rows.length > 0) {
    return {
      rows: rows.map(({ total: _total, ...rest }) => rest),
      total: Number(rows[0].total),
    };
  }

  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total FROM matches WHERE venue_id = ${venueId}
  `;
  return { rows: [], total: Number(counted.total) };
}
