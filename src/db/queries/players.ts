import 'server-only';

import { cache } from 'react';
import postgres from 'postgres';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

export type PlayerListRow = {
  id: number;
  slug: string;
  displayName: string;
  debutSeason: number | null;
  finalSeason: number | null;
  games: number;
  goals: number;
  finals: number;
  premierships: number;
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
  // Ties on a small integer are the norm here, so games breaks them: four
  // premierships in 120 games is the more remarkable career.
  premierships: 'c.premierships DESC, c.games DESC, p.sort_name',
} as const;

export type PlayerSort = keyof typeof PLAYER_SORTS;

export function isPlayerSort(value: string | undefined): value is PlayerSort {
  return value !== undefined && Object.hasOwn(PLAYER_SORTS, value);
}

/**
 * Career columns the player index may be filtered on.
 *
 * The allowlist that `rangeConditions` resolves against: a filter key with
 * no entry here produces no SQL. Era-limited statistics are deliberately
 * absent for the reason `advanced-spec.ts` gives — filtering on disposals
 * would quietly exclude everyone who played before they were recorded.
 */
export const PLAYER_FILTER_COLUMNS: Record<string, string> = {
  games: 'c.games',
  goals: 'c.goals',
  finals: 'c.finals',
  premierships: 'c.premierships',
  brownlow_votes: 'c.brownlow_votes',
  brownlow_medals: 'c.brownlow_medals',
  clubs: 'c.clubs_played',
  seasons: 'c.seasons_played',
  wins: 'c.wins',
  debut: 'c.debut_season',
  final: 'c.final_season',
};

export type PlayerListFilters = {
  club?: string;
  season?: number;
  name?: string;
  ranges?: FilterValues;
};

/**
 * Paged player index.
 *
 * Club names are aggregated in the same query rather than fetched per
 * player, so a 50-row page costs one round trip, not 51.
 */
export async function listPlayers(options: PlayerListFilters & {
  sort: PlayerSort;
  limit: number;
  offset: number;
}): Promise<{ rows: PlayerListRow[]; total: number }> {
  const { sort, limit, offset, club, season, name, ranges } = options;
  // Sort key is resolved through a fixed map; user input never reaches SQL.
  const orderBy = PLAYER_SORTS[sort];

  const conditions = ranges ? rangeConditions(ranges, PLAYER_FILTER_COLUMNS) : [];
  if (name) conditions.push(sql`p.display_name ILIKE ${containsPattern(name)}`);
  if (club) {
    conditions.push(sql`
      EXISTS (SELECT 1 FROM player_clubs pc
                JOIN clubs cl ON cl.id = pc.club_id
               WHERE pc.player_id = p.id AND cl.slug = ${club})
    `);
  }
  if (season !== undefined) {
    conditions.push(sql`
      EXISTS (SELECT 1 FROM player_season_stats ps
               WHERE ps.player_id = p.id AND ps.season = ${season})
    `);
  }
  const where = allOf(conditions);

  const rows = await sql<(PlayerListRow & { total: string })[]>`
    SELECT p.id,
           p.slug,
           p.display_name       AS "displayName",
           c.debut_season       AS "debutSeason",
           c.final_season       AS "finalSeason",
           COALESCE(c.games, 0) AS games,
           COALESCE(c.goals, 0) AS goals,
           COALESCE(c.finals, 0) AS finals,
           COALESCE(c.premierships, 0) AS premierships,
           COALESCE(c.brownlow_votes, 0) AS "brownlowVotes",
           COALESCE(c.clubs_played, 0) AS "clubsPlayed",
           (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
              FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
             WHERE pc.player_id = p.id) AS "clubNames",
           count(*) OVER ()     AS total
      FROM players p
      LEFT JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
     ORDER BY ${sql.unsafe(orderBy)}
     LIMIT ${limit} OFFSET ${offset}
  `;

  if (rows.length > 0) {
    return {
      rows: rows.map(({ total: _total, ...rest }) => rest),
      total: Number(rows[0].total),
    };
  }

  // An offset past the end returns no rows, and a window count carried on
  // those rows would report the collection as empty. Count separately so
  // "13,361 players" stays true on a page that happens to be past the last
  // one, and so the caller can redirect to a page that exists.
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM players p
      LEFT JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
  `;
  return { rows: [], total: Number(counted.total) };
}

export type PlayerProfile = {
  id: number;
  slug: string;
  displayName: string;
  givenName?: string | null;
  surname?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  notes?: string | null;
  dob: Date | null;
  dobConfidence: string;
  dobDisputed: boolean;
  birthYear: number | null;
  birthYearConfidence: string;
  games: number;
  goals: number;
  behinds: number | null;
  behindsRecordedGames: number;
  kicks: number | null;
  kicksRecordedGames: number;
  handballs: number | null;
  handballsRecordedGames: number;
  disposals: number | null;
  disposalsRecordedGames: number;
  marks: number | null;
  marksRecordedGames: number;
  tackles: number | null;
  tacklesRecordedGames: number;
  hitouts: number | null;
  hitoutsRecordedGames: number;
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

async function fetchPlayer(id: number): Promise<PlayerProfile | null> {
  const [row] = await sql<PlayerProfile[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           p.given_name AS "givenName", p.surname AS "surname",
           p.height_cm AS "heightCm", p.weight_kg AS "weightKg",
           p.notes AS "notes",
           p.dob, p.dob_confidence AS "dobConfidence",
           p.dob_disputed AS "dobDisputed",
           p.birth_year AS "birthYear",
           p.birth_year_confidence AS "birthYearConfidence",
           COALESCE(c.games, 0) AS "games",
           COALESCE(c.goals, 0) AS "goals",
           c.behinds, COALESCE(c.behinds_recorded_games, 0) AS "behindsRecordedGames",
           c.kicks, COALESCE(c.kicks_recorded_games, 0) AS "kicksRecordedGames",
           c.handballs, COALESCE(c.handballs_recorded_games, 0) AS "handballsRecordedGames",
           c.disposals, COALESCE(c.disposals_recorded_games, 0) AS "disposalsRecordedGames",
           c.marks, COALESCE(c.marks_recorded_games, 0) AS "marksRecordedGames",
           c.tackles, COALESCE(c.tackles_recorded_games, 0) AS "tacklesRecordedGames",
           c.hitouts, COALESCE(c.hitouts_recorded_games, 0) AS "hitoutsRecordedGames",
           COALESCE(c.finals, 0) AS "finals",
           COALESCE(c.premierships, 0) AS "premierships",
           COALESCE(c.wins, 0) AS "wins",
           COALESCE(c.draws, 0) AS "draws",
           COALESCE(c.losses, 0) AS "losses",
           COALESCE(c.brownlow_votes, 0) AS "brownlowVotes",
           COALESCE(c.brownlow_medals, 0) AS "brownlowMedals",
           COALESCE(c.clubs_played, 0) AS "clubsPlayed",
           COALESCE(c.seasons_played, 0) AS "seasonsPlayed",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           c.debut_date AS "debutDate", c.last_match_date AS "lastMatchDate",
           c.best_goals_game AS "bestGoalsGame",
           c.best_disposals_game AS "bestDisposalsGame"
      FROM players p
      LEFT JOIN player_career_stats c ON c.player_id = p.id
     WHERE p.id = ${id}
  `;
  return row ?? null;
}

export type DraftPickInput = {
  recruitedFrom?: string | null;
  /** A draft row is a historical fact, so its season is never inferred. */
  draftYear: number;
  draftType?: string | null;
  pickNumber?: number | null;
  clubId?: number | null;
  draftAge?: number | null;
  pickNote?: string | null;
  detail?: string | null;
};

export type CreatePlayerInput = {
  displayName: string;
  givenName?: string | null;
  surname?: string | null;
  dob?: string | null;
  dobConfidence?: 'sourced' | 'estimated' | 'derived' | 'unknown';
  heightCm?: number | null;
  weightKg?: number | null;
  notes?: string | null;
  debutSeason?: number | null;
  finalSeason?: number | null;
  draftInfo?: DraftPickInput | null;
};

export type CreatedPlayer = { id: number; slug: string; displayName: string };

/**
 * The transaction-scoped half of player creation.
 *
 * Compound import mutations (notably "create and link") call this only
 * after locking their own prerequisite row. Keeping the inserts here means
 * those workflows share the standalone creation rules without opening a
 * second connection or committing an orphan player halfway through.
 */
export async function createPlayerInTransaction(
  tx: postgres.TransactionSql,
  input: CreatePlayerInput,
): Promise<CreatedPlayer> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100) {
    throw new Error('Display name is required (up to 100 characters).');
  }
  let givenName = input.givenName?.trim() || null;
  let surname = input.surname?.trim() || null;

  if (!givenName && !surname) {
    const parts = displayName.split(/\s+/);
    if (parts.length === 1) {
      surname = parts[0];
    } else {
      givenName = parts.slice(0, -1).join(' ');
      surname = parts[parts.length - 1];
    }
  }

  const sortName = surname ? (givenName ? `${surname}, ${givenName}` : surname) : displayName;
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player';

  const dob = input.dob ? input.dob.trim() : null;
  const dobConfidence = dob ? (input.dobConfidence || 'sourced') : 'unknown';
  const birthYear = dob && /^\d{4}/.test(dob) ? Number(dob.slice(0, 4)) : null;

  if (input.draftInfo && (
    !Number.isInteger(input.draftInfo.draftYear)
    || input.draftInfo.draftYear < 1981
    || input.draftInfo.draftYear > 2100
  )) {
    throw new Error(
      'An explicit draft year from 1981 to 2100 is required when draft information is supplied.',
    );
  }

  let draftClubNameRaw: string | null = null;
  if (input.draftInfo?.clubId != null) {
    if (!Number.isInteger(input.draftInfo.clubId) || input.draftInfo.clubId <= 0) {
      throw new Error('Draft club ID must be a positive integer.');
    }
    const [club] = await tx<{ id: number; name: string; activeId: number | null }[]>`
      SELECT c.id, c.name,
             afldb_identity_for_season(c.organization_id, ${input.draftInfo.draftYear}) AS "activeId"
        FROM clubs c
       WHERE c.id = ${input.draftInfo.clubId}
    `;
    if (!club) throw new Error(`Draft club #${input.draftInfo.clubId} does not exist.`);
    if (club.activeId !== club.id) {
      throw new Error(`${club.name} is not the historical club identity active in ${input.draftInfo.draftYear}.`);
    }
    draftClubNameRaw = club.name;
  }

  const [row] = await tx<CreatedPlayer[]>`
    INSERT INTO players (
      display_name, given_name, surname, sort_name, search_name, slug,
      dob, dob_confidence, birth_year, birth_year_confidence,
      height_cm, weight_kg, notes,
      debut_season, final_season
    ) VALUES (
      ${displayName}, ${givenName}, ${surname}, ${sortName},
      afldb_normalise_name(${displayName}), ${slug},
      ${dob}::date, ${dobConfidence}::value_confidence,
      ${birthYear}, ${dobConfidence}::value_confidence,
      ${input.heightCm ?? null}, ${input.weightKg ?? null}, ${input.notes?.trim() || null},
      ${input.debutSeason ?? null}, ${input.finalSeason ?? null}
    )
    RETURNING id, slug, display_name AS "displayName"
  `;

  // Seed zero career stats.
  await tx`
    INSERT INTO player_career_stats (
      player_id, games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
      finals, premierships, wins, draws, losses, brownlow_votes, brownlow_medals,
      clubs_played, seasons_played, behinds_recorded_games, kicks_recorded_games,
      handballs_recorded_games, disposals_recorded_games, marks_recorded_games,
      tackles_recorded_games, hitouts_recorded_games
    ) VALUES (
      ${row.id}, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0,
      0, 0
    ) ON CONFLICT (player_id) DO NOTHING
  `;

  // Optional draft & recruitment record. The year is deliberately required:
  // neither a birth date nor the wall clock is evidence of a draft season.
  if (input.draftInfo) {
    const d = input.draftInfo;
    const draftType = d.draftType?.trim() || 'National Draft';

    await tx`
      INSERT INTO draft_picks (
        draft_year, draft_type, pick_number, player_name_raw, player_id,
        link_status_value, club_id, club_name_raw, original_club_raw,
        height_cm, weight_kg, draft_age, pick_note, detail
      ) VALUES (
        ${d.draftYear},
        ${draftType},
        ${d.pickNumber ?? null},
        ${displayName},
        ${row.id},
        'resolved',
        ${d.clubId ?? null},
        ${draftClubNameRaw},
        ${d.recruitedFrom?.trim() || null},
        ${input.heightCm ?? null},
        ${input.weightKg ?? null},
        ${d.draftAge ?? null},
        ${d.pickNote?.trim() || null},
        ${d.detail?.trim() || null}
      )
    `;
  }

  return row;
}

/**
 * Create a new player in the database (see changeLog.md).
 * Used for drafted players who have yet to play a match or historical players.
 */
export async function createPlayer(input: CreatePlayerInput): Promise<CreatedPlayer> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) {
    throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  }

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const created = await importSql.begin((tx) => createPlayerInTransaction(tx, input));

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
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
  /**
   * The club of most games that season, from a LEFT JOIN on the nullable
   * player_season_stats.primary_club_id -- null when the derived row names
   * no club, which the schema permits (migration 015).
   */
  clubName: string | null;
  clubSlug: string | null;
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
  if (rows.length > 0) {
    return {
      rows: rows.map(({ total: _total, ...rest }) => rest),
      total: Number(rows[0].total),
    };
  }

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

/** Display names for a handful of player ids, e.g. resolving the grid solver's Teammates axes for display. */
export async function getPlayerNames(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await sql<{ id: number; displayName: string }[]>`
    SELECT id, display_name AS "displayName" FROM players WHERE id = ANY(${ids})
  `;
  return new Map(rows.map((r) => [r.id, r.displayName]));
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
export const getPlayer = cache(fetchPlayer);
