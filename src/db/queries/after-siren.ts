import 'server-only';

import { sql } from '@/db/client';

export type PlayerAfterSirenEvent = {
  id: number;
  season: number;
  roundRaw: string;
  competition: string;
  premiershipSeason: boolean;
  clubId: number | null;
  clubName: string;
  clubSlug: string | null;
  opponentClubId: number | null;
  opponentName: string;
  opponentSlug: string | null;
  matchId: number | null;
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  kickerResult: 'win' | 'draw' | 'loss';
  siren: 'final' | 'end_of_regulation' | 'end_of_extra_time';
  kickerScoreRaw: string;
  opponentScoreRaw: string;
  cited: boolean;
};

/**
 * A player's after-the-siren kicks, from the canonical `after_siren_kicks`
 * table (migration 089, AFLDB-ISSUE-118 §23.33/§23.34). Read-only exposure:
 * this never recomputes, imports or corrects an event, it only shapes the
 * public fields a profile needs -- internal provenance (source_id,
 * source_record_id, candidate_count, link_status) stays off the page, the
 * same discipline every other public read model here follows.
 *
 * The kicker's own club and the opponent are both resolved to a canonical
 * club when the source's club string links to one; `clubSlug` /
 * `opponentSlug` are null otherwise, same fallback-to-raw-name convention as
 * `getPlayerMatches`.
 */
export type AfterSirenOccurrence = {
  season: number;
  roundRaw: string;
  /** Read out of a jsonb aggregate, so this is a date string, never a Date instance. */
  matchDate: string | null;
  matchId: number | null;
  opponentName: string | null;
  opponentSlug: string | null;
  kickEffect: 'won' | 'drew' | 'none';
};

export type AfterSirenRecordRow = {
  playerId: number;
  displayName: string;
  slug: string;
  attempts: number;
  goals: number;
  behinds: number;
  misses: number;
  goalsToWin: number;
  goalsToDraw: number;
  firstAttempt: AfterSirenOccurrence;
  lastAttempt: AfterSirenOccurrence;
  /** Null for a player with no goal (their attempts board entry still shows). */
  firstGoal: AfterSirenOccurrence | null;
  lastGoal: AfterSirenOccurrence | null;
};

/**
 * Per-player after-the-siren totals, for the Records "most attempts" /
 * "most goals" boards (AFLDB-ISSUE-139 UI handoff). first/latest for the
 * attempts board comes from every attempt; first/latest for the goals
 * board comes only from goal rows -- the two are read from separate CTEs
 * so a "most goals" first/latest can never be filled from a non-goal
 * attempt.
 */
export async function getAfterSirenRecords(): Promise<AfterSirenRecordRow[]> {
  return sql<AfterSirenRecordRow[]>`
    WITH totals AS (
      SELECT a.player_id, count(*)::int AS attempts,
             count(*) FILTER (WHERE a.kick_scored = 'goal')::int AS goals,
             count(*) FILTER (WHERE a.kick_scored = 'behind')::int AS behinds,
             count(*) FILTER (WHERE a.kick_scored = 'none')::int AS misses,
             count(*) FILTER (
               WHERE a.kick_scored = 'goal' AND a.kick_effect = 'won'
             )::int AS goals_to_win,
             count(*) FILTER (
               WHERE a.kick_scored = 'goal' AND a.kick_effect = 'drew'
             )::int AS goals_to_draw
        FROM after_siren_kicks a
       WHERE a.player_id IS NOT NULL
       GROUP BY a.player_id
    ),
    first_attempt AS (
      SELECT DISTINCT ON (a.player_id)
        a.player_id, a.season, a.round_raw, m.match_date, a.match_id,
        COALESCE(op.name, a.opponent_name_raw) AS opponent_name, op.slug AS opponent_slug, a.kick_effect
        FROM after_siren_kicks a
        LEFT JOIN matches m ON m.id = a.match_id
        LEFT JOIN clubs op ON op.id = a.opponent_club_id
       WHERE a.player_id IS NOT NULL
       ORDER BY a.player_id, a.season, a.id
    ),
    last_attempt AS (
      SELECT DISTINCT ON (a.player_id)
        a.player_id, a.season, a.round_raw, m.match_date, a.match_id,
        COALESCE(op.name, a.opponent_name_raw) AS opponent_name, op.slug AS opponent_slug, a.kick_effect
        FROM after_siren_kicks a
        LEFT JOIN matches m ON m.id = a.match_id
        LEFT JOIN clubs op ON op.id = a.opponent_club_id
       WHERE a.player_id IS NOT NULL
       ORDER BY a.player_id, a.season DESC, a.id DESC
    ),
    first_goal AS (
      SELECT DISTINCT ON (a.player_id)
        a.player_id, a.season, a.round_raw, m.match_date, a.match_id,
        COALESCE(op.name, a.opponent_name_raw) AS opponent_name, op.slug AS opponent_slug, a.kick_effect
        FROM after_siren_kicks a
        LEFT JOIN matches m ON m.id = a.match_id
        LEFT JOIN clubs op ON op.id = a.opponent_club_id
       WHERE a.player_id IS NOT NULL AND a.kick_scored = 'goal'
       ORDER BY a.player_id, a.season, a.id
    ),
    last_goal AS (
      SELECT DISTINCT ON (a.player_id)
        a.player_id, a.season, a.round_raw, m.match_date, a.match_id,
        COALESCE(op.name, a.opponent_name_raw) AS opponent_name, op.slug AS opponent_slug, a.kick_effect
        FROM after_siren_kicks a
        LEFT JOIN matches m ON m.id = a.match_id
        LEFT JOIN clubs op ON op.id = a.opponent_club_id
       WHERE a.player_id IS NOT NULL AND a.kick_scored = 'goal'
       ORDER BY a.player_id, a.season DESC, a.id DESC
    )
    SELECT t.player_id AS "playerId", p.display_name AS "displayName", p.slug,
           t.attempts, t.goals, t.behinds, t.misses,
           t.goals_to_win AS "goalsToWin", t.goals_to_draw AS "goalsToDraw",
           jsonb_build_object(
             'season', fa.season, 'roundRaw', fa.round_raw, 'matchDate', fa.match_date,
             'matchId', fa.match_id, 'opponentName', fa.opponent_name,
             'opponentSlug', fa.opponent_slug, 'kickEffect', fa.kick_effect
           ) AS "firstAttempt",
           jsonb_build_object(
             'season', la.season, 'roundRaw', la.round_raw, 'matchDate', la.match_date,
             'matchId', la.match_id, 'opponentName', la.opponent_name,
             'opponentSlug', la.opponent_slug, 'kickEffect', la.kick_effect
           ) AS "lastAttempt",
           CASE WHEN fg.player_id IS NOT NULL THEN jsonb_build_object(
             'season', fg.season, 'roundRaw', fg.round_raw, 'matchDate', fg.match_date,
             'matchId', fg.match_id, 'opponentName', fg.opponent_name,
             'opponentSlug', fg.opponent_slug, 'kickEffect', fg.kick_effect
           ) END AS "firstGoal",
           CASE WHEN lg.player_id IS NOT NULL THEN jsonb_build_object(
             'season', lg.season, 'roundRaw', lg.round_raw, 'matchDate', lg.match_date,
             'matchId', lg.match_id, 'opponentName', lg.opponent_name,
             'opponentSlug', lg.opponent_slug, 'kickEffect', lg.kick_effect
           ) END AS "lastGoal"
      FROM totals t
      JOIN players p ON p.id = t.player_id
      LEFT JOIN first_attempt fa ON fa.player_id = t.player_id
      LEFT JOIN last_attempt la ON la.player_id = t.player_id
      LEFT JOIN first_goal fg ON fg.player_id = t.player_id
      LEFT JOIN last_goal lg ON lg.player_id = t.player_id
     ORDER BY t.attempts DESC, p.display_name
  `;
}

export async function getPlayerAfterSirenEvents(playerId: number): Promise<PlayerAfterSirenEvent[]> {
  return sql<PlayerAfterSirenEvent[]>`
    SELECT a.id, a.season, a.round_raw AS "roundRaw", a.competition,
           a.premiership_season AS "premiershipSeason",
           a.club_id AS "clubId", COALESCE(cl.name, a.club_name_raw) AS "clubName", cl.slug AS "clubSlug",
           a.opponent_club_id AS "opponentClubId",
           COALESCE(op.name, a.opponent_name_raw) AS "opponentName", op.slug AS "opponentSlug",
           a.match_id AS "matchId",
           a.kick_scored AS "kickScored", a.kick_effect AS "kickEffect",
           a.kicker_result AS "kickerResult", a.siren,
           a.kicker_score_raw AS "kickerScoreRaw", a.opponent_score_raw AS "opponentScoreRaw",
           a.cited
      FROM after_siren_kicks a
      LEFT JOIN clubs cl ON cl.id = a.club_id
      LEFT JOIN clubs op ON op.id = a.opponent_club_id
     WHERE a.player_id = ${playerId}
     ORDER BY a.season DESC, a.id DESC
  `;
}
