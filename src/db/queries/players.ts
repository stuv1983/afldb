import 'server-only';

import { sql } from '@/db/client';

export type PlayerListRow = {
  id: number;
  slug: string;
  displayName: string;
  debutSeason: number | null;
  finalSeason: number | null;
  games: number;
  goals: number;
  finals: number;
  brownlowVotes: number;
  clubsPlayed: number;
  clubNames: string | null;
};

export const PLAYER_SORTS = {
  games: 'c.games DESC, p.sort_name',
  goals: 'c.goals DESC, p.sort_name',
  name: 'p.sort_name',
  debut: 'c.debut_season DESC NULLS LAST, p.sort_name',
  final_game: 'c.final_season DESC NULLS LAST, p.sort_name',
  brownlow_votes: 'c.brownlow_votes DESC, p.sort_name',
  finals: 'c.finals DESC, p.sort_name',
} as const;

export type PlayerSort = keyof typeof PLAYER_SORTS;

export function isPlayerSort(value: string | undefined): value is PlayerSort {
  return value !== undefined && Object.hasOwn(PLAYER_SORTS, value);
}

/**
 * Paged player index.
 *
 * Club names are aggregated in the same query rather than fetched per
 * player, so a 50-row page costs one round trip, not 51.
 */
export async function listPlayers(options: {
  sort: PlayerSort;
  limit: number;
  offset: number;
  club?: string;
  season?: number;
}): Promise<{ rows: PlayerListRow[]; total: number }> {
  const { sort, limit, offset, club, season } = options;
  // Sort key is resolved through a fixed map; user input never reaches SQL.
  const orderBy = PLAYER_SORTS[sort];

  const rows = await sql<(PlayerListRow & { total: string })[]>`
    WITH filtered AS (
      SELECT p.id
        FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
       WHERE (${club ?? null}::text IS NULL OR EXISTS (
               SELECT 1 FROM player_clubs pc
                 JOIN clubs cl ON cl.id = pc.club_id
                WHERE pc.player_id = p.id AND cl.slug = ${club ?? null}))
         AND (${season ?? null}::int IS NULL OR EXISTS (
               SELECT 1 FROM player_season_stats ps
                WHERE ps.player_id = p.id AND ps.season = ${season ?? null}))
    )
    SELECT p.id,
           p.slug,
           p.display_name       AS "displayName",
           c.debut_season       AS "debutSeason",
           c.final_season       AS "finalSeason",
           c.games, c.goals, c.finals,
           c.brownlow_votes     AS "brownlowVotes",
           c.clubs_played       AS "clubsPlayed",
           (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
              FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
             WHERE pc.player_id = p.id) AS "clubNames",
           count(*) OVER ()     AS total
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     WHERE p.id IN (SELECT id FROM filtered)
     ORDER BY ${sql.unsafe(orderBy)}
     LIMIT ${limit} OFFSET ${offset}
  `;

  if (rows.length > 0) return { rows, total: Number(rows[0].total) };

  // An offset past the end returns no rows, and a window count carried on
  // those rows would report the collection as empty. Count separately so
  // "13,361 players" stays true on a page that happens to be past the last
  // one, and so the caller can redirect to a page that exists.
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     WHERE (${club ?? null}::text IS NULL OR EXISTS (
             SELECT 1 FROM player_clubs pc
               JOIN clubs cl ON cl.id = pc.club_id
              WHERE pc.player_id = p.id AND cl.slug = ${club ?? null}))
       AND (${season ?? null}::int IS NULL OR EXISTS (
             SELECT 1 FROM player_season_stats ps
              WHERE ps.player_id = p.id AND ps.season = ${season ?? null}))
  `;
  return { rows: [], total: Number(counted.total) };
}

export type PlayerProfile = {
  id: number;
  slug: string;
  displayName: string;
  dob: Date | null;
  dobConfidence: string;
  dobDisputed: boolean;
  birthYear: number | null;
  birthYearConfidence: string;
  games: number;
  goals: number;
  behinds: number | null;
  disposals: number | null;
  disposalsRecordedGames: number;
  marks: number | null;
  tackles: number | null;
  tacklesRecordedGames: number;
  hitouts: number | null;
  finals: number;
  premierships: number;
  wins: number;
  draws: number;
  losses: number;
  brownlowVotes: number;
  brownlowMedals: number;
  clubsPlayed: number;
  seasonsPlayed: number;
  debutSeason: number | null;
  finalSeason: number | null;
  debutDate: Date | null;
  lastMatchDate: Date | null;
  bestGoalsGame: number | null;
  bestDisposalsGame: number | null;
};

export async function getPlayer(id: number): Promise<PlayerProfile | null> {
  const [row] = await sql<PlayerProfile[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           p.dob, p.dob_confidence AS "dobConfidence",
           p.dob_disputed AS "dobDisputed",
           p.birth_year AS "birthYear",
           p.birth_year_confidence AS "birthYearConfidence",
           c.games, c.goals, c.behinds, c.disposals,
           c.disposals_recorded_games AS "disposalsRecordedGames",
           c.marks, c.tackles,
           c.tackles_recorded_games AS "tacklesRecordedGames",
           c.hitouts, c.finals, c.premierships, c.wins, c.draws, c.losses,
           c.brownlow_votes AS "brownlowVotes",
           c.brownlow_medals AS "brownlowMedals",
           c.clubs_played AS "clubsPlayed",
           c.seasons_played AS "seasonsPlayed",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           c.debut_date AS "debutDate", c.last_match_date AS "lastMatchDate",
           c.best_goals_game AS "bestGoalsGame",
           c.best_disposals_game AS "bestDisposalsGame"
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     WHERE p.id = ${id}
  `;
  return row ?? null;
}

export type PlayerClubStint = {
  clubId: number;
  clubName: string;
  clubSlug: string;
  games: number;
  goals: number;
  firstSeason: number;
  lastSeason: number;
};

export async function getPlayerClubs(playerId: number): Promise<PlayerClubStint[]> {
  return sql<PlayerClubStint[]>`
    SELECT pc.club_id AS "clubId", cl.name AS "clubName", cl.slug AS "clubSlug",
           pc.games, pc.goals,
           pc.first_season AS "firstSeason", pc.last_season AS "lastSeason"
      FROM player_clubs pc
      JOIN clubs cl ON cl.id = pc.club_id
     WHERE pc.player_id = ${playerId}
     ORDER BY pc.first_season, cl.name
  `;
}

export type PlayerSeasonRow = {
  season: number;
  clubName: string;
  clubSlug: string;
  /** Clubs represented that season. >1 means a mid-season transfer. */
  clubCount: number;
  games: number;
  finals: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number | null;
  behinds: number | null;
  disposals: number | null;
  disposalsRecordedGames: number;
  marks: number | null;
  tackles: number | null;
  hitouts: number | null;
  brownlowVotes: number | null;
  /** Why brownlowVotes is null: 'complete' | 'not_applicable' | 'pending'. */
  brownlowStatus: string;
  isPremier: boolean;
  seasonStatus: string;
};

/**
 * One row per season, not per club.
 *
 * A player-season is the grain at which season awards are decided, so
 * reading it this way is what keeps a mid-season transfer from showing
 * its Brownlow total twice. Where a player represented two clubs, the
 * club column names the club of most games and clubCount is 2; the
 * club-by-club playing record lives in player_club_season_stats and is
 * shown separately.
 */
export async function getPlayerSeasons(playerId: number): Promise<PlayerSeasonRow[]> {
  return sql<PlayerSeasonRow[]>`
    SELECT s.season,
           cl.name AS "clubName", cl.slug AS "clubSlug",
           s.club_count AS "clubCount",
           s.games, s.finals, s.wins, s.draws, s.losses,
           s.goals, s.behinds, s.disposals,
           s.disposals_recorded_games AS "disposalsRecordedGames",
           s.marks, s.tackles, s.hitouts,
           s.brownlow_votes AS "brownlowVotes",
           s.brownlow_status AS "brownlowStatus",
           s.is_premier AS "isPremier",
           se.status AS "seasonStatus"
      FROM player_season_stats s
      JOIN seasons se ON se.year = s.season
      LEFT JOIN clubs cl ON cl.id = s.primary_club_id
     WHERE s.player_id = ${playerId}
     ORDER BY s.season
  `;
}

export type PlayerClubSeasonRow = {
  season: number;
  clubName: string;
  clubSlug: string;
  games: number;
  goals: number | null;
};

/** Club-by-club breakdown, used only for seasons split across two clubs. */
export async function getPlayerClubSeasons(playerId: number): Promise<PlayerClubSeasonRow[]> {
  return sql<PlayerClubSeasonRow[]>`
    SELECT s.season, cl.name AS "clubName", cl.slug AS "clubSlug",
           s.games, s.goals
      FROM player_club_season_stats s
      JOIN clubs cl ON cl.id = s.club_id
     WHERE s.player_id = ${playerId}
       AND s.season IN (SELECT season FROM player_season_stats
                         WHERE player_id = ${playerId} AND club_count > 1)
     ORDER BY s.season, s.games DESC, cl.name
  `;
}

export type PlayerMatchRow = {
  matchId: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  matchDate: Date;
  clubName: string;
  opponentName: string;
  opponentSlug: string;
  venueName: string;
  outcome: string;
  pointsFor: number;
  pointsAgainst: number;
  goals: number | null;
  behinds: number | null;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  hitouts: number | null;
  brownlowVotes: number | null;
  careerGameNo: number | null;
};

/** Paged match log. */
export async function getPlayerMatches(
  playerId: number,
  options: { limit: number; offset: number; season?: number },
): Promise<{ rows: PlayerMatchRow[]; total: number }> {
  const { limit, offset, season } = options;
  const rows = await sql<(PlayerMatchRow & { total: string })[]>`
    SELECT m.id AS "matchId", m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.match_date AS "matchDate",
           cl.name AS "clubName",
           opp.name AS "opponentName", opp.slug AS "opponentSlug",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           CASE WHEN m.result = 'draw' THEN 'D'
                WHEN (m.result = 'home_win') = (m.home_club_id = s.club_id) THEN 'W'
                ELSE 'L' END AS outcome,
           CASE WHEN m.home_club_id = s.club_id THEN m.home_score ELSE m.away_score END AS "pointsFor",
           CASE WHEN m.home_club_id = s.club_id THEN m.away_score ELSE m.home_score END AS "pointsAgainst",
           s.goals, s.behinds, s.kicks, s.handballs, s.disposals,
           s.marks, s.tackles, s.hitouts,
           s.brownlow_votes AS "brownlowVotes",
           s.career_game_no AS "careerGameNo",
           count(*) OVER () AS total
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN clubs  cl ON cl.id = s.club_id
      JOIN clubs opp ON opp.id = CASE WHEN m.home_club_id = s.club_id
                                      THEN m.away_club_id ELSE m.home_club_id END
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE s.player_id = ${playerId}
       AND (${season ?? null}::int IS NULL OR m.season = ${season ?? null})
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${limit} OFFSET ${offset}
  `;
  if (rows.length > 0) return { rows, total: Number(rows[0].total) };

  // Same reason as listPlayers: a window count cannot survive an empty page.
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE s.player_id = ${playerId}
       AND (${season ?? null}::int IS NULL OR m.season = ${season ?? null})
  `;
  return { rows: [], total: Number(counted.total) };
}

/** Season Brownlow votes from the authoritative source. */
export async function getPlayerBrownlow(playerId: number) {
  return sql<{
    season: number;
    votes: number;
    voteRank: number | null;
    isWinner: boolean;
    isIneligible: boolean;
  }[]>`
    SELECT season, votes, vote_rank AS "voteRank",
           is_winner AS "isWinner", is_ineligible AS "isIneligible"
      FROM brownlow_season_votes
     WHERE player_id = ${playerId} AND votes > 0
     ORDER BY season
  `;
}

/** Resolve a legacy or stale slug to the canonical one for redirects. */
export async function getPlayerSlug(id: number): Promise<string | null> {
  const [row] = await sql<{ slug: string }[]>`
    SELECT slug FROM players WHERE id = ${id}
  `;
  return row?.slug ?? null;
}

/**
 * Players most likely to be requested, used to seed the static params of
 * the player route so it participates in the incremental cache.
 */
export async function listMostViewedPlayers(limit: number) {
  return sql<{ id: number; slug: string }[]>`
    SELECT p.id, p.slug
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     ORDER BY c.games DESC, c.brownlow_votes DESC
     LIMIT ${limit}
  `;
}
