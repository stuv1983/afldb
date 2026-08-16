import 'server-only';

import { cache } from 'react';

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

async function fetchMatch(id: number): Promise<MatchDetail | null> {
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

export type VaultMeeting = MatchListRow & {
  /** Every match these two clubs have played, this one included. */
  meetings: number;
  /** The recent fixture whose pairing selected this meeting. */
  latestId: number;
  latestSeason: number;
  latestDate: Date;
};

/**
 * "From the vault": for each pairing in the most recent round, one random
 * earlier meeting between the same two clubs.
 *
 * The home page used to list the latest results, which in a historical
 * database is the least interesting thing on it — the same six lines from the
 * end of last season, every visit, until the next import. Keeping the
 * pairings but rolling the meeting back to a random point in their shared
 * history turns the same fixtures into a different page every time the
 * hourly ISR window turns over, and every line is a real match with a link.
 *
 * Pairings are matched on club identity in either direction — the 1958
 * meeting is as valid as the modern one whichever side had the home ground —
 * and on identity rather than organization, so a rename's two eras are not
 * silently folded together (see docs/architecture.md §4.5).
 *
 * A pairing that has met exactly once (an expansion club's first meeting)
 * yields no earlier match, so the LATERAL drops it: the panel then shows
 * fewer rows rather than repeating the fixture it was supposed to replace.
 */
export async function getVaultMeetings(limit = 6): Promise<VaultMeeting[]> {
  return sql<VaultMeeting[]>`
    WITH latest AS (
      SELECT id, home_club_id, away_club_id, season, match_date
        FROM matches
       ORDER BY match_date DESC, id DESC
       LIMIT ${limit}
    ),
    pairs AS (
      SELECT DISTINCT ON (least(home_club_id, away_club_id), greatest(home_club_id, away_club_id))
             least(home_club_id, away_club_id)    AS club_a,
             greatest(home_club_id, away_club_id) AS club_b,
             id AS latest_id, season AS latest_season, match_date AS latest_date
        FROM latest
       ORDER BY least(home_club_id, away_club_id), greatest(home_club_id, away_club_id),
                match_date DESC, id DESC
    )
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.match_date AS "matchDate",
           h.name AS "homeName", h.slug AS "homeSlug",
           a.name AS "awayName", a.slug AS "awaySlug",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           m.attendance,
           p.latest_id     AS "latestId",
           p.latest_season AS "latestSeason",
           p.latest_date   AS "latestDate",
           (SELECT count(*) FROM matches c
             WHERE (c.home_club_id = p.club_a AND c.away_club_id = p.club_b)
                OR (c.home_club_id = p.club_b AND c.away_club_id = p.club_a))::int AS meetings
      FROM pairs p
      CROSS JOIN LATERAL (
        SELECT e.*
          FROM matches e
         WHERE ((e.home_club_id = p.club_a AND e.away_club_id = p.club_b)
             OR (e.home_club_id = p.club_b AND e.away_club_id = p.club_a))
           AND e.id <> p.latest_id
         ORDER BY random()
         LIMIT 1
      ) m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     ORDER BY p.latest_date DESC, p.latest_id DESC
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
export const getMatch = cache(fetchMatch);
