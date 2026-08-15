import 'server-only';

import { cache } from 'react';

import { sql } from '@/db/client';
import { allOf, containsPattern, prefixPattern, rangeConditions } from '@/db/queries/filters';
import {
  AFLW_MATCH_OUTCOME_FILTERS,
  AFLW_MATCH_SORTS,
  AFLW_MATCH_TYPE_FILTERS,
  AFLW_PLAYER_SORTS,
  type AflwMatchSort,
  type AflwPlayerSort,
} from '@/search/aflw-filters';
import type { FilterValues } from '@/search/table-filters';

/**
 * AFLW queries, against the `aflw` read schema (migration 026).
 *
 * Two things make this module look different from its AFL counterparts,
 * and both come from the competition rather than from the code.
 *
 * A season is identified by `season_key`, never by year: AFLW played two
 * seasons inside calendar 2022, so 2022 does not identify a season.
 * Anything that orders or spans seasons uses `ordinal`.
 *
 * A club, player, venue and match are identified by the source's own key.
 * The scrape carries no AFLW rename history and applies current club
 * names retroactively, so a name is a label, not an identity.
 *
 * The single-row getters are wrapped in React's `cache`, because every
 * detail page asks for the same row twice: once in `generateMetadata` and
 * once in the page body. Without it each request runs the aggregate over
 * the whole player-match table twice to render one page.
 */

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type AflwSeasonSummary = {
  seasonKey: string;
  ordinal: number;
  calendarYear: number;
  displayLabel: string;
  firstFixtureDate: Date | null;
  lastFixtureDate: Date | null;
  fixtureCount: number;
  playedCount: number;
  ladderGroupCount: number;
  hasGrandFinal: boolean;
  isComplete: boolean;
  status: string;
  premierCode: string | null;
  premierName: string | null;
  playerCount: number;
  clubCount: number;
};

export const AFLW_SEASON_FILTER_COLUMNS: Record<string, string> = {
  ordinal: 's.ordinal',
  year: 's.calendar_year',
  matches: 's.played_count',
  clubs: 's.club_count',
  players: 's.player_count',
};

const SEASON_COLUMNS = sql`
  s.season_key AS "seasonKey", s.ordinal, s.calendar_year AS "calendarYear",
  s.display_label AS "displayLabel",
  s.first_fixture_date AS "firstFixtureDate",
  s.last_fixture_date AS "lastFixtureDate",
  s.fixture_count AS "fixtureCount", s.played_count AS "playedCount",
  s.ladder_group_count AS "ladderGroupCount",
  s.has_grand_final AS "hasGrandFinal",
  s.is_complete AS "isComplete", s.status,
  s.premier_team_code AS "premierCode", pc.name AS "premierName",
  s.player_count AS "playerCount", s.club_count AS "clubCount"
`;

export async function listAflwSeasons(filters: {
  status?: string;
  premier?: string;
  ranges?: FilterValues;
} = {}): Promise<AflwSeasonSummary[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, AFLW_SEASON_FILTER_COLUMNS)
    : [];
  if (filters.status) conditions.push(sql`s.status = ${filters.status}`);
  if (filters.premier) conditions.push(sql`s.premier_team_code = ${filters.premier}`);
  const where = allOf(conditions);

  return sql<AflwSeasonSummary[]>`
    SELECT ${SEASON_COLUMNS}
      FROM aflw.seasons s
      LEFT JOIN aflw.clubs pc ON pc.code = s.premier_team_code
     WHERE ${where}
     ORDER BY s.ordinal DESC
  `;
}

export const getAflwSeason = cache(
  async (seasonKey: string): Promise<AflwSeasonSummary | null> => {
    const [row] = await sql<AflwSeasonSummary[]>`
      SELECT ${SEASON_COLUMNS}
        FROM aflw.seasons s
        LEFT JOIN aflw.clubs pc ON pc.code = s.premier_team_code
       WHERE s.season_key = ${seasonKey}
    `;
    return row ?? null;
  },
);

/** Season options for a filter control, newest first. */
export async function getAflwSeasonOptions(): Promise<{ key: string; label: string }[]> {
  return sql<{ key: string; label: string }[]>`
    SELECT season_key AS key, display_label AS label
      FROM aflw.seasons ORDER BY ordinal DESC
  `;
}

export type AflwLadderRow = {
  conference: string;
  teamCode: string;
  clubName: string | null;
  ladderRank: number;
  played: number;
  premiershipPoints: number;
  percentage: string | null;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

export async function getAflwLadder(seasonKey: string): Promise<AflwLadderRow[]> {
  return sql<AflwLadderRow[]>`
    SELECT conference, team_code AS "teamCode", club_name AS "clubName",
           ladder_rank AS "ladderRank", played,
           premiership_points AS "premiershipPoints", percentage,
           wins, draws, losses,
           points_for AS "pointsFor", points_against AS "pointsAgainst"
      FROM aflw.ladders
     WHERE season_key = ${seasonKey}
     ORDER BY conference, ladder_rank
  `;
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

export type AflwClubRow = {
  code: string;
  name: string;
  firstSeasonOrdinal: number;
  lastSeasonOrdinal: number;
  seasonsContested: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  finals: number;
  premierships: number;
  pointsFor: number;
  pointsAgainst: number;
};

export const AFLW_CLUB_FILTER_COLUMNS: Record<string, string> = {
  seasons: 'c.seasons_contested',
  matches: 'c.matches',
  wins: 'c.wins',
  finals: 'c.finals',
  premierships: 'c.premierships',
};

const CLUB_COLUMNS = sql`
  c.code, c.name,
  c.first_season_ordinal AS "firstSeasonOrdinal",
  c.last_season_ordinal  AS "lastSeasonOrdinal",
  c.seasons_contested    AS "seasonsContested",
  c.matches, c.wins, c.draws, c.losses, c.finals, c.premierships,
  c.points_for     AS "pointsFor",
  c.points_against AS "pointsAgainst"
`;

export async function listAflwClubs(filters: {
  q?: string;
  ranges?: FilterValues;
} = {}): Promise<AflwClubRow[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, AFLW_CLUB_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`c.name ILIKE ${containsPattern(filters.q)}`);
  const where = allOf(conditions);

  return sql<AflwClubRow[]>`
    SELECT ${CLUB_COLUMNS}
      FROM aflw.club_totals c
     WHERE ${where}
     ORDER BY c.premierships DESC, c.wins DESC, c.name
  `;
}

export const getAflwClub = cache(async (code: string): Promise<AflwClubRow | null> => {
  const [row] = await sql<AflwClubRow[]>`
    SELECT ${CLUB_COLUMNS} FROM aflw.club_totals c WHERE c.code = ${code}
  `;
  return row ?? null;
});

/**
 * Clubs as filter options, in label order.
 *
 * Reads the club list rather than `club_totals`: a dropdown needs a code
 * and a name, and the totals view recomputes every club's win-loss ledger
 * over the whole match table to produce them.
 */
export async function getAflwClubOptions(): Promise<{ value: string; label: string }[]> {
  return sql<{ value: string; label: string }[]>`
    SELECT code AS value, name AS label FROM aflw.clubs ORDER BY name
  `;
}

export type AflwClubSeasonRow = {
  seasonKey: string;
  seasonLabel: string;
  ordinal: number;
  conference: string;
  ladderRank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  percentage: string | null;
  isPremier: boolean;
};

export async function getAflwClubSeasons(code: string): Promise<AflwClubSeasonRow[]> {
  return sql<AflwClubSeasonRow[]>`
    SELECT s.season_key AS "seasonKey", s.display_label AS "seasonLabel",
           s.ordinal, COALESCE(l.conference, '') AS conference,
           l.ladder_rank AS "ladderRank", l.played,
           l.wins, l.draws, l.losses, l.percentage,
           (s.premier_team_code = ${code}) AS "isPremier"
      FROM aflw.seasons s
      JOIN aflw.ladders l
        ON l.season_key = s.season_key AND l.team_code = ${code}
     ORDER BY s.ordinal DESC
  `;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type AflwPlayerListRow = {
  slug: string;
  displayName: string;
  clubNames: string | null;
  debutSeasonLabel: string;
  finalSeasonLabel: string;
  games: number;
  goals: number;
  disposals: number;
  marks: number;
  tackles: number;
  premierships: number;
};

/**
 * Career columns the player index and Advanced Search may filter on.
 *
 * Unlike the AFL side, every statistic here is available for every season
 * the competition has played: the AFLW source records disposals, tackles
 * and metres gained from 2017 onward. Filtering on them therefore
 * excludes nobody by era.
 */
export const AFLW_PLAYER_FILTER_COLUMNS: Record<string, string> = {
  games: 'c.games',
  goals: 'c.goals',
  behinds: 'c.behinds',
  disposals: 'c.disposals',
  kicks: 'c.kicks',
  handballs: 'c.handballs',
  marks: 'c.marks',
  tackles: 'c.tackles',
  hitouts: 'c.hitouts',
  contested: 'c.contested',
  metres_gained: 'c.metres_gained',
  fantasy_points: 'c.fantasy_points',
  finals: 'c.finals',
  wins: 'c.wins',
  premierships: 'c.premierships',
  seasons: 'c.seasons_played',
  clubs: 'c.clubs_played',
  debut: 'c.debut_season_ordinal',
};

export async function listAflwPlayers(options: {
  sort: AflwPlayerSort;
  limit: number;
  offset: number;
  name?: string;
  club?: string;
  seasonKey?: string;
  ranges?: FilterValues;
}): Promise<{ rows: AflwPlayerListRow[]; total: number }> {
  const { sort, limit, offset, name, club, seasonKey, ranges } = options;
  const orderBy = AFLW_PLAYER_SORTS[sort].sql;

  const conditions = ranges ? rangeConditions(ranges, AFLW_PLAYER_FILTER_COLUMNS) : [];
  if (name) conditions.push(sql`p.display_name ILIKE ${containsPattern(name)}`);
  if (club) {
    conditions.push(sql`
      EXISTS (SELECT 1 FROM aflw.player_match_stats pms
               WHERE pms.player_slug = p.slug AND pms.team_code = ${club})
    `);
  }
  if (seasonKey) {
    conditions.push(sql`
      EXISTS (SELECT 1 FROM aflw.player_seasons ps
               WHERE ps.player_slug = p.slug AND ps.season_key = ${seasonKey})
    `);
  }
  const where = allOf(conditions);

  const rows = await sql<(AflwPlayerListRow & { total: string })[]>`
    SELECT p.slug, p.display_name AS "displayName", c.club_names AS "clubNames",
           ds.display_label AS "debutSeasonLabel",
           fs.display_label AS "finalSeasonLabel",
           c.games, c.goals, c.disposals, c.marks, c.tackles, c.premierships,
           count(*) OVER () AS total
      FROM aflw.players p
      JOIN aflw.player_careers c ON c.player_slug = p.slug
      LEFT JOIN aflw.seasons ds ON ds.ordinal = c.debut_season_ordinal
      LEFT JOIN aflw.seasons fs ON fs.ordinal = c.final_season_ordinal
     WHERE ${where}
     ORDER BY ${sql.unsafe(orderBy)}
     LIMIT ${limit} OFFSET ${offset}
  `;

  if (rows.length > 0) return { rows, total: Number(rows[0].total) };

  // A window count cannot survive an empty page, and the caller needs the
  // real total to redirect to a page that exists.
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM aflw.players p
      JOIN aflw.player_careers c ON c.player_slug = p.slug
     WHERE ${where}
  `;
  return { rows: [], total: Number(counted.total) };
}

export type AflwPlayerProfile = {
  slug: string;
  displayName: string;
  currentClubName: string | null;
  currentTeamCode: string | null;
  games: number;
  finals: number;
  wins: number;
  draws: number;
  losses: number;
  premierships: number;
  seasonsPlayed: number;
  clubsPlayed: number;
  clubNames: string | null;
  debutSeasonLabel: string | null;
  finalSeasonLabel: string | null;
  debutDate: Date | null;
  lastMatchDate: Date | null;
  goals: number;
  behinds: number;
  scorePoints: number;
  kicks: number;
  handballs: number;
  disposals: number;
  contested: number;
  metresGained: number;
  marks: number;
  tackles: number;
  hitouts: number;
  fantasyPoints: number;
  bestGoalsGame: number;
  bestDisposalsGame: number;
};

export const getAflwPlayer = cache(async (slug: string): Promise<AflwPlayerProfile | null> => {
  const [row] = await sql<AflwPlayerProfile[]>`
    SELECT p.slug, p.display_name AS "displayName",
           p.current_club_name AS "currentClubName",
           p.current_team_code AS "currentTeamCode",
           c.games, c.finals, c.wins, c.draws, c.losses, c.premierships,
           c.seasons_played AS "seasonsPlayed",
           c.clubs_played   AS "clubsPlayed",
           c.club_names     AS "clubNames",
           ds.display_label AS "debutSeasonLabel",
           fs.display_label AS "finalSeasonLabel",
           c.debut_date AS "debutDate", c.last_match_date AS "lastMatchDate",
           c.goals, c.behinds, c.score_points AS "scorePoints",
           c.kicks, c.handballs, c.disposals, c.contested,
           c.metres_gained AS "metresGained",
           c.marks, c.tackles, c.hitouts,
           c.fantasy_points AS "fantasyPoints",
           c.best_goals_game AS "bestGoalsGame",
           c.best_disposals_game AS "bestDisposalsGame"
      FROM aflw.players p
      JOIN aflw.player_careers c ON c.player_slug = p.slug
      LEFT JOIN aflw.seasons ds ON ds.ordinal = c.debut_season_ordinal
      LEFT JOIN aflw.seasons fs ON fs.ordinal = c.final_season_ordinal
     WHERE p.slug = ${slug}
  `;
  return row ?? null;
});

export type AflwPlayerSeasonRow = {
  seasonKey: string;
  seasonLabel: string;
  clubName: string | null;
  teamCode: string;
  games: number;
  finals: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  behinds: number;
  disposals: number;
  marks: number;
  tackles: number;
  hitouts: number;
  metresGained: number;
  fantasyPoints: number;
};

export async function getAflwPlayerSeasons(slug: string): Promise<AflwPlayerSeasonRow[]> {
  return sql<AflwPlayerSeasonRow[]>`
    SELECT ps.season_key AS "seasonKey", ps.season_label AS "seasonLabel",
           ps.team_code AS "teamCode", c.name AS "clubName",
           ps.games, ps.finals, ps.wins, ps.draws, ps.losses,
           ps.goals, ps.behinds, ps.disposals, ps.marks, ps.tackles,
           ps.hitouts, ps.metres_gained AS "metresGained",
           ps.fantasy_points AS "fantasyPoints"
      FROM aflw.player_seasons ps
      LEFT JOIN aflw.clubs c ON c.code = ps.team_code
     WHERE ps.player_slug = ${slug}
     ORDER BY ps.season_ordinal
  `;
}

export type AflwPlayerMatchRow = {
  matchKey: string;
  seasonKey: string;
  seasonLabel: string;
  matchDate: Date;
  roundCode: string;
  roundNumber: number | null;
  roundType: string;
  clubName: string | null;
  opponentCode: string;
  opponentName: string | null;
  venueName: string;
  outcome: string;
  pointsFor: number;
  pointsAgainst: number;
  goals: number;
  behinds: number;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  hitouts: number;
  contested: number;
  metresGained: number;
  fantasyPoints: number;
  position: string;
};

export async function getAflwPlayerMatches(
  slug: string,
  options: { limit: number; offset: number; seasonKey?: string },
): Promise<{ rows: AflwPlayerMatchRow[]; total: number }> {
  const { limit, offset, seasonKey } = options;
  const rows = await sql<(AflwPlayerMatchRow & { total: string })[]>`
    SELECT pms.match_key AS "matchKey", pms.season_key AS "seasonKey",
           pms.season_label AS "seasonLabel", pms.match_date AS "matchDate",
           pms.round_code AS "roundCode", pms.round_number AS "roundNumber",
           pms.round_type AS "roundType",
           pms.club_name AS "clubName",
           pms.opponent_code AS "opponentCode", oc.name AS "opponentName",
           pms.venue_name AS "venueName", pms.outcome,
           pms.points_for AS "pointsFor", pms.points_against AS "pointsAgainst",
           pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
           pms.marks, pms.tackles, pms.hitouts, pms.contested,
           pms.metres_gained AS "metresGained",
           pms.fantasy_points AS "fantasyPoints",
           pms.position,
           count(*) OVER () AS total
      FROM aflw.player_match_stats pms
      LEFT JOIN aflw.clubs oc ON oc.code = pms.opponent_code
     WHERE pms.player_slug = ${slug}
       AND (${seasonKey ?? null}::text IS NULL OR pms.season_key = ${seasonKey ?? null})
     ORDER BY pms.match_date DESC, pms.match_key DESC
     LIMIT ${limit} OFFSET ${offset}
  `;
  if (rows.length > 0) return { rows, total: Number(rows[0].total) };

  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM aflw.player_match_stats pms
     WHERE pms.player_slug = ${slug}
       AND (${seasonKey ?? null}::text IS NULL OR pms.season_key = ${seasonKey ?? null})
  `;
  return { rows: [], total: Number(counted.total) };
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export type AflwMatchRow = {
  matchKey: string;
  seasonKey: string;
  seasonLabel: string;
  calendarYear: number;
  roundCode: string;
  roundNumber: number | null;
  roundType: string;
  isFinal: boolean;
  matchDate: Date;
  matchTime: string | null;
  venueName: string;
  weatherRaw: string;
  homeTeamCode: string;
  homeClubName: string | null;
  awayTeamCode: string;
  awayClubName: string | null;
  homeGoals: number;
  homeBehinds: number;
  homeScore: number;
  awayGoals: number;
  awayBehinds: number;
  awayScore: number;
  margin: number;
  totalScore: number;
  highScore: number;
  lowScore: number;
  result: string;
  winnerTeamCode: string | null;
};

const MATCH_COLUMNS = sql`
  m.match_key AS "matchKey", m.season_key AS "seasonKey",
  m.season_label AS "seasonLabel", m.calendar_year AS "calendarYear",
  m.round_code AS "roundCode", m.round_number AS "roundNumber",
  m.round_type AS "roundType", m.is_final AS "isFinal",
  m.match_date AS "matchDate", m.match_time AS "matchTime",
  m.venue_name AS "venueName", m.weather_raw AS "weatherRaw",
  m.home_team_code AS "homeTeamCode", m.home_club_name AS "homeClubName",
  m.away_team_code AS "awayTeamCode", m.away_club_name AS "awayClubName",
  m.home_goals AS "homeGoals", m.home_behinds AS "homeBehinds",
  m.home_score AS "homeScore",
  m.away_goals AS "awayGoals", m.away_behinds AS "awayBehinds",
  m.away_score AS "awayScore",
  m.margin, m.total_score AS "totalScore",
  m.high_score AS "highScore", m.low_score AS "lowScore",
  m.result, m.winner_team_code AS "winnerTeamCode"
`;

export const getAflwMatch = cache(async (matchKey: string): Promise<AflwMatchRow | null> => {
  const [row] = await sql<AflwMatchRow[]>`
    SELECT ${MATCH_COLUMNS} FROM aflw.matches m WHERE m.match_key = ${matchKey}
  `;
  return row ?? null;
});

export async function getAflwSeasonMatches(seasonKey: string): Promise<AflwMatchRow[]> {
  return sql<AflwMatchRow[]>`
    SELECT ${MATCH_COLUMNS}
      FROM aflw.matches m
     WHERE m.season_key = ${seasonKey}
     ORDER BY m.match_date, m.match_key
  `;
}

export async function getAflwRecentMatches(limit = 8): Promise<AflwMatchRow[]> {
  return sql<AflwMatchRow[]>`
    SELECT ${MATCH_COLUMNS}
      FROM aflw.matches m
     ORDER BY m.match_date DESC, m.match_key DESC
     LIMIT ${limit}
  `;
}

export type AflwMatchPlayerRow = {
  playerSlug: string;
  playerName: string;
  teamCode: string;
  jumperNumber: string;
  position: string;
  goals: number;
  behinds: number;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  hitouts: number;
  contested: number;
  metresGained: number;
  fantasyPoints: number;
};

export async function getAflwMatchPlayers(matchKey: string): Promise<AflwMatchPlayerRow[]> {
  return sql<AflwMatchPlayerRow[]>`
    SELECT pms.player_slug AS "playerSlug",
           pms.player_name_raw AS "playerName",
           pms.team_code AS "teamCode",
           pms.jumper_number AS "jumperNumber",
           pms.position,
           pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
           pms.marks, pms.tackles, pms.hitouts, pms.contested,
           pms.metres_gained AS "metresGained",
           pms.fantasy_points AS "fantasyPoints"
      FROM aflw.player_match_stats pms
     WHERE pms.match_key = ${matchKey}
     ORDER BY pms.team_code, pms.disposals DESC, pms.player_name_raw
  `;
}

export type AflwScoringEventRow = {
  eventSeq: number;
  period: number;
  clock: string;
  teamCode: string;
  clubName: string | null;
  eventType: string;
  playerName: string;
  points: number;
  homeGoals: number;
  homeBehinds: number;
  awayGoals: number;
  awayBehinds: number;
};

export async function getAflwMatchScoring(matchKey: string): Promise<AflwScoringEventRow[]> {
  return sql<AflwScoringEventRow[]>`
    SELECT event_seq AS "eventSeq", period, clock,
           team_code AS "teamCode", club_name AS "clubName",
           event_type AS "eventType", player_name_raw AS "playerName",
           points,
           home_goals AS "homeGoals", home_behinds AS "homeBehinds",
           away_goals AS "awayGoals", away_behinds AS "awayBehinds"
      FROM aflw.scoring_events
     WHERE match_key = ${matchKey}
     ORDER BY event_seq
  `;
}

// ---------------------------------------------------------------------------
// Match search
// ---------------------------------------------------------------------------

export const AFLW_MATCH_FILTER_COLUMNS: Record<string, string> = {
  margin: 'm.margin',
  total_score: 'm.total_score',
  high_score: 'm.high_score',
  low_score: 'm.low_score',
};

export async function runAflwMatchSearch(options: {
  sort: AflwMatchSort;
  limit: number;
  offset: number;
  clubs?: string[];
  seasonKey?: string;
  venue?: string;
  outcome?: string;
  matchType?: string;
  ranges?: FilterValues;
}): Promise<{ rows: AflwMatchRow[]; total: number }> {
  const { sort, limit, offset, clubs, seasonKey, venue, outcome, matchType, ranges } = options;
  const conditions = ranges ? rangeConditions(ranges, AFLW_MATCH_FILTER_COLUMNS) : [];

  if (clubs?.length) {
    conditions.push(sql`
      (m.home_team_code = ANY(${clubs}) OR m.away_team_code = ANY(${clubs}))
    `);
  }
  if (seasonKey) conditions.push(sql`m.season_key = ${seasonKey}`);
  if (venue) conditions.push(sql`m.venue_slug = ${venue}`);
  // The condition comes from the same declaration the select options are
  // built from, so an option can never exist without the SQL behind it.
  const outcomeFilter = outcome ? AFLW_MATCH_OUTCOME_FILTERS[
    outcome as keyof typeof AFLW_MATCH_OUTCOME_FILTERS
  ] : undefined;
  if (outcomeFilter) conditions.push(sql`${sql.unsafe(outcomeFilter.sql)}`);
  const typeFilter = matchType ? AFLW_MATCH_TYPE_FILTERS[
    matchType as keyof typeof AFLW_MATCH_TYPE_FILTERS
  ] : undefined;
  if (typeFilter) conditions.push(sql`${sql.unsafe(typeFilter.sql)}`);
  const where = allOf(conditions);

  const rows = await sql<(AflwMatchRow & { total: string })[]>`
    SELECT ${MATCH_COLUMNS}, count(*) OVER () AS total
      FROM aflw.matches m
     WHERE ${where}
     ORDER BY ${sql.unsafe(AFLW_MATCH_SORTS[sort].sql)}
     LIMIT ${limit} OFFSET ${offset}
  `;
  if (rows.length > 0) return { rows, total: Number(rows[0].total) };

  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total FROM aflw.matches m WHERE ${where}
  `;
  return { rows: [], total: Number(counted.total) };
}

// ---------------------------------------------------------------------------
// Venues and overview
// ---------------------------------------------------------------------------

export type AflwVenueRow = {
  slug: string;
  name: string;
  matches: number;
  firstSeasonLabel: string | null;
  lastSeasonLabel: string | null;
};

export const AFLW_VENUE_FILTER_COLUMNS: Record<string, string> = {
  matches: 'v.matches',
};

export async function listAflwVenues(filters: {
  q?: string;
  ranges?: FilterValues;
} = {}): Promise<AflwVenueRow[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, AFLW_VENUE_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`v.name ILIKE ${containsPattern(filters.q)}`);
  const where = allOf(conditions);

  return sql<AflwVenueRow[]>`
    SELECT v.slug, v.name, v.matches,
           fs.display_label AS "firstSeasonLabel",
           ls.display_label AS "lastSeasonLabel"
      FROM aflw.venues v
      LEFT JOIN aflw.seasons fs ON fs.ordinal = v.first_season_ordinal
      LEFT JOIN aflw.seasons ls ON ls.ordinal = v.last_season_ordinal
     WHERE ${where}
     ORDER BY v.matches DESC, v.name
  `;
}

export type AflwOverview = {
  seasons: number;
  clubs: number;
  players: number;
  matches: number;
  playerMatchRows: number;
  scoringEvents: number;
  firstDate: Date | null;
  lastDate: Date | null;
};

export async function getAflwOverview(): Promise<AflwOverview> {
  const [row] = await sql<AflwOverview[]>`
    SELECT (SELECT count(*) FROM aflw.seasons)::int AS seasons,
           (SELECT count(*) FROM aflw.clubs)::int AS clubs,
           (SELECT count(*) FROM aflw.players)::int AS players,
           (SELECT count(*) FROM aflw.matches)::int AS matches,
           (SELECT count(*) FROM aflw.player_match_stats)::int AS "playerMatchRows",
           (SELECT count(*) FROM aflw.scoring_events)::int AS "scoringEvents",
           (SELECT min(match_date) FROM aflw.matches) AS "firstDate",
           (SELECT max(match_date) FROM aflw.matches) AS "lastDate"
  `;
  return row;
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

export type AflwSearchRow = {
  slug: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

/**
 * AFLW players for the site-wide search.
 *
 * The AFL side normalises names in the database through
 * `afldb_normalise_name` and a stored `search_name`. There is no such
 * column here — these are views — so matching is a case-insensitive
 * contains against the display name, which is enough for 960 players and
 * costs one scan of a small view.
 */
export async function searchAflwPlayers(query: string, limit = 6): Promise<AflwSearchRow[]> {
  return sql<AflwSearchRow[]>`
    SELECT p.slug,
           p.display_name AS title,
           COALESCE(c.club_names, '') || ' · ' || c.games || ' games' AS subtitle,
           (CASE WHEN lower(p.display_name) = lower(${query}) THEN 1000
                 WHEN lower(p.display_name) LIKE lower(${prefixPattern(query)}) THEN 500
                 ELSE 250 END + LEAST(c.games, 100) / 10.0)::float AS rank
      FROM aflw.players p
      JOIN aflw.player_careers c ON c.player_slug = p.slug
     WHERE p.display_name ILIKE ${containsPattern(query)}
     ORDER BY rank DESC, c.games DESC, p.sort_name
     LIMIT ${limit}
  `;
}

export async function searchAflwClubs(query: string, limit = 3): Promise<AflwSearchRow[]> {
  return sql<AflwSearchRow[]>`
    SELECT c.code AS slug,
           c.name AS title,
           'AFLW club · ' || t.matches || ' matches' AS subtitle,
           (CASE WHEN lower(c.name) = lower(${query}) THEN 1000
                 WHEN lower(c.name) LIKE lower(${prefixPattern(query)}) THEN 500
                 ELSE 250 END)::float AS rank
      FROM aflw.clubs c
      JOIN aflw.club_totals t ON t.code = c.code
     WHERE c.name ILIKE ${containsPattern(query)}
     ORDER BY rank DESC, c.name
     LIMIT ${limit}
  `;
}
