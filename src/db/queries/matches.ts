import 'server-only';

import { sql } from '@/db/client';

export type MatchListRow = {
  id: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  matchDate: Date;
  homeName: string;
  homeSlug: string;
  awayName: string;
  awaySlug: string;
  homeScore: number;
  awayScore: number;
  venueName: string;
  attendance: number | null;
};

export async function getSeasonMatches(year: number): Promise<MatchListRow[]> {
  return sql<MatchListRow[]>`
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.match_date AS "matchDate",
           h.name AS "homeName", h.slug AS "homeSlug",
           a.name AS "awayName", a.slug AS "awaySlug",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           m.attendance
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE m.season = ${year}
     ORDER BY m.match_date, m.id
  `;
}

export type MatchDetail = {
  id: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  roundCode: string;
  isFinal: boolean;
  matchDate: Date;
  matchTime: string | null;
  venueName: string;
  venueSlug: string | null;
  homeClubId: number;
  homeName: string;
  homeSlug: string;
  awayClubId: number;
  awayName: string;
  awaySlug: string;
  homeGoals: number | null;
  homeBehinds: number | null;
  homeScore: number;
  awayGoals: number | null;
  awayBehinds: number | null;
  awayScore: number;
  result: string;
  winnerName: string | null;
  margin: number;
  attendance: number | null;
  matchEvent: string | null;
};

export async function getMatch(id: number): Promise<MatchDetail | null> {
  const [row] = await sql<MatchDetail[]>`
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.round_code AS "roundCode",
           m.is_final AS "isFinal",
           m.match_date AS "matchDate", m.match_time AS "matchTime",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           v.slug AS "venueSlug",
           m.home_club_id AS "homeClubId", h.name AS "homeName", h.slug AS "homeSlug",
           m.away_club_id AS "awayClubId", a.name AS "awayName", a.slug AS "awaySlug",
           m.home_goals AS "homeGoals", m.home_behinds AS "homeBehinds",
           m.home_score AS "homeScore",
           m.away_goals AS "awayGoals", m.away_behinds AS "awayBehinds",
           m.away_score AS "awayScore",
           m.result::text, w.name AS "winnerName", m.margin, m.attendance,
           m.match_event AS "matchEvent"
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN clubs w ON w.id = m.winner_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE m.id = ${id}
  `;
  return row ?? null;
}

export async function getMatchPeriods(matchId: number) {
  return sql<{
    clubId: number; period: number;
    goals: number | null; behinds: number | null; points: number | null;
  }[]>`
    SELECT club_id AS "clubId", period, goals, behinds, points
      FROM match_period_scores
     WHERE match_id = ${matchId}
     ORDER BY club_id, period
  `;
}

export type MatchPlayerRow = {
  playerId: number;
  slug: string;
  displayName: string;
  clubId: number;
  goals: number | null;
  behinds: number | null;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  hitouts: number | null;
  brownlowVotes: number | null;
};

export async function getMatchPlayers(matchId: number): Promise<MatchPlayerRow[]> {
  return sql<MatchPlayerRow[]>`
    SELECT s.player_id AS "playerId", p.slug, p.display_name AS "displayName",
           s.club_id AS "clubId",
           s.goals, s.behinds, s.kicks, s.handballs, s.disposals,
           s.marks, s.tackles, s.hitouts,
           s.brownlow_votes AS "brownlowVotes"
      FROM player_match_stats s
      JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ${matchId}
     ORDER BY s.club_id,
              COALESCE(s.disposals, -1) DESC,
              COALESCE(s.goals, -1) DESC,
              p.sort_name
  `;
}

/** Recent matches for the homepage. */
export async function getRecentMatches(limit = 8): Promise<MatchListRow[]> {
  return sql<MatchListRow[]>`
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.match_date AS "matchDate",
           h.name AS "homeName", h.slug AS "homeSlug",
           a.name AS "awayName", a.slug AS "awaySlug",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           m.attendance
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${limit}
  `;
}

/**
 * Matches most likely to be requested: every grand final, then the most
 * recent matches. Used to seed the static params of the match route.
 */
export async function listNotableMatchIds(limit: number) {
  return sql<{ id: number }[]>`
    (SELECT id FROM matches WHERE round_type = 'grand_final')
    UNION
    (SELECT id FROM matches ORDER BY match_date DESC LIMIT ${limit})
  `;
}
