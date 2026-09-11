import { randomUUID } from 'node:crypto';

import 'server-only';

import { cache } from 'react';
import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
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

export const PLAYER_SORTS: Record<string, string> = {
  games: 'c.games',
  goals: 'c.goals',
  name: 'p.sort_name',
  debut: 'c.debut_season',
  final_game: 'c.final_season',
  brownlow_votes: 'c.brownlow_votes',
  finals: 'c.finals',
  premierships: 'c.premierships',
};

export type PlayerSort = keyof typeof PLAYER_SORTS;

export function isPlayerSort(value: string | undefined): value is PlayerSort {
  return value !== undefined && Object.hasOwn(PLAYER_SORTS, value);
}

export type PlayerSortDir = 'asc' | 'desc';

export function isPlayerSortDir(value: string | undefined): value is PlayerSortDir {
  return value === 'asc' || value === 'desc';
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
  dir?: PlayerSortDir;
  limit: number;
  offset: number;
}): Promise<{ rows: PlayerListRow[]; total: number }> {
  const { sort, dir = 'desc', limit, offset, club, season, name, ranges } = options;
  
  // Base column for the sort
  const sortCol = PLAYER_SORTS[sort];
  const sqlDir = dir === 'asc' ? sql`ASC` : sql`DESC`;
  
  // Custom orderBy construction to handle ties and specific requirements
  let orderBy;
  if (sort === 'name') {
    orderBy = sql`${sql.unsafe(sortCol)} ${sqlDir}`;
  } else if (sort === 'debut' || sort === 'final_game') {
    const nulls = dir === 'asc' ? sql`NULLS LAST` : sql`NULLS LAST`;
    orderBy = sql`${sql.unsafe(sortCol)} ${sqlDir} ${nulls}, p.sort_name ASC`;
  } else if (sort === 'premierships') {
    orderBy = sql`${sql.unsafe(sortCol)} ${sqlDir}, c.games ${sqlDir}, p.sort_name ASC`;
  } else {
    orderBy = sql`${sql.unsafe(sortCol)} ${sqlDir}, p.sort_name ASC`;
  }

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
     ORDER BY ${orderBy}
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
};

export type CreatedPlayer = { id: number; slug: string; displayName: string };

/**
 * The transaction-scoped half of player creation, and the ONE player-creation
 * primitive in `src/` (AFLDB-ISSUE-160 §5). Compound import mutations --
 * "create and link" (`player-links.ts`) and "create player + draft selection"
 * (`admin-draft.ts`) -- call this only after locking their own prerequisite
 * row, so those workflows share the creation rules without opening a second
 * connection or committing an orphan player halfway through.
 *
 * WHY IT MINTS AN IDENTITY. Before ISSUE-160 an admin-created player carried
 * no durable identity at all: nothing in `external_identities` named it, so
 * `replay_admin_overrides(players)` could not patch it, no replay re-created
 * it after a destructive reload, and its `player_creation` audit rows were
 * `no_identity_in_replaced` on a promotion -- which STOPS a PROD promotion
 * (DEF-4a). Every player created here therefore gets, in this same
 * transaction:
 *
 *   1. an `external_identities (manual_admin_edit, <token>)` row -- the
 *      durable identity, a `randomUUID()` minted once and never edited, never
 *      name-derived;
 *   2. a `data_overrides ('players', 'manual_admin_edit:<token>', 'identity')`
 *      row carrying the whole player -- the durable RECORD, which
 *      `replay_admin_overrides(players)` re-creates the row from on a rebuilt
 *      candidate (§8.1).
 *
 * `search_name`, `slug` and `sort_name` are derived IN SQL, by the same
 * expressions `import_fitzroy_core.import_players()` and the §8.1 replay use,
 * so a replayed twin of this row is byte-identical to it. Deriving them in
 * JavaScript is what would make a promoted database differ from the one the
 * admin typed into.
 *
 * `adminUserId` is required because the override row requires it: no caller
 * can create a player whose durable record is unattributable.
 *
 * There is deliberately NO draft branch here any more (D-5): the only
 * `INSERT INTO draft_picks` in `src/` is `admin-draft.ts`, so draft selections
 * have exactly one mutation contract.
 */
export async function createPlayerInTransaction(
  tx: postgres.TransactionSql,
  input: CreatePlayerInput,
  actor: { adminUserId: number },
): Promise<CreatedPlayer> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100) {
    throw new Error('Display name is required (up to 100 characters).');
  }
  if (!Number.isInteger(actor.adminUserId) || actor.adminUserId <= 0) {
    throw new Error('A valid administrator id is required to create a player.');
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

  const dob = input.dob ? input.dob.trim() : null;
  const dobConfidence = dob ? (input.dobConfidence || 'sourced') : 'unknown';
  const birthYear = dob && /^\d{4}/.test(dob) ? Number(dob.slice(0, 4)) : null;
  const heightCm = input.heightCm ?? null;
  const weightKg = input.weightKg ?? null;
  const notes = input.notes?.trim() || null;

  const token = randomUUID();

  const [row] = await tx<CreatedPlayer[]>`
    INSERT INTO players (
      display_name, given_name, surname, sort_name, search_name, slug,
      dob, dob_confidence, birth_year, birth_year_confidence,
      height_cm, weight_kg, notes,
      debut_season, final_season
    ) VALUES (
      ${displayName}, ${givenName}, ${surname},
      CASE
        WHEN ${surname}::text IS NULL THEN ${displayName}::text
        WHEN ${givenName}::text IS NULL THEN ${surname}::text
        ELSE ${surname}::text || ', ' || ${givenName}::text
      END,
      afldb_normalise_name(${displayName}),
      regexp_replace(afldb_normalise_name(${displayName}), '\\s+', '-', 'g'),
      ${dob}::date, ${dobConfidence}::value_confidence,
      ${birthYear}, ${dobConfidence}::value_confidence,
      ${heightCm}, ${weightKg}, ${notes},
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

  // The durable identity. 'resolved' is the human-decision status (as opposed
  // to an importer's 'unique'), matching every other admin-authored link.
  await tx`
    INSERT INTO external_identities
          (source_id, external_id, external_name, external_url, player_id,
           status, candidate_count, match_method, notes)
    VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'),
            ${token}, ${displayName}, NULL, ${row.id},
            'resolved', 0, 'manual_admin_edit',
            'Player created in the AFLDB admin surface (AFLDB-ISSUE-160 §5).')
  `;

  // The durable record. Absent-vs-explicit-null is preserved: a key is
  // written only for a field the caller supplied, so the §8.1 replay's
  // jsonb_exists arms mean what they say. display_name is always present --
  // it is NOT NULL, and the replay re-creates the row from it.
  const identityPayload: Record<string, unknown> = { display_name: displayName };
  identityPayload.given_name = givenName;
  identityPayload.surname = surname;
  if (input.dob !== undefined) {
    identityPayload.dob = dob;
    identityPayload.dob_confidence = dobConfidence;
    identityPayload.birth_year = birthYear;
  }
  if (input.heightCm !== undefined) identityPayload.height_cm = heightCm;
  if (input.weightKg !== undefined) identityPayload.weight_kg = weightKg;
  if (input.notes !== undefined) identityPayload.notes = notes;

  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
    VALUES ('players', ${`manual_admin_edit:${token}`}, 'identity',
            ${tx.json(identityPayload as postgres.JSONValue)}, ${actor.adminUserId}, true, now())
  `;

  return row;
}

/**
 * The `manual_admin_edit` token a player carries. Moved unchanged to the shared
 * identity module (AFLDB-ISSUE-161 §29) when season lists became the second
 * domain that names a player durably; re-exported here so every existing
 * importer of this module is unchanged.
 */
export { readManualPlayerToken } from '@/db/queries/player-identity';

/**
 * Create a new player in the database (see changeLog.md).
 * Used for drafted players who have yet to play a match or historical players.
 *
 * The audit argument is required on purpose: the admin data editor's
 * required data_edits row is written inside the same import-role
 * transaction as the player insert (AFLDB-ISSUE-027), so no caller can
 * silently create a player without its audit. The create-and-link flow
 * does NOT come through here — it calls createPlayerInTransaction and
 * audits via player_link_resolutions instead.
 */
export async function createPlayer(
  input: CreatePlayerInput,
  audit: { adminUserId: number; note?: string | null },
): Promise<CreatedPlayer> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) {
    throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  }

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const created = await importSql.begin(async (tx) => {
      const player = await createPlayerInTransaction(tx, input, { adminUserId: audit.adminUserId });
      await recordDataEdit(tx, {
        tableName: 'players',
        rowId: player.id,
        fieldGroup: 'player_creation',
        oldValues: {},
        newValues: { displayName: player.displayName },
        adminUserId: audit.adminUserId,
        note: audit.note,
      });
      return player;
    });

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

export const PLAYER_MATCH_SORTS: Record<string, string> = {
  no: 's.career_game_no',
  date: 'm.match_date',
  rd: 'm.round_number',
  club: 'cl.name',
  opponent: 'opp.name',
  score: 'CASE WHEN m.home_club_id = s.club_id THEN m.home_score ELSE m.away_score END', // Usually score sorting is complex, wait, maybe just skip it if it's too complex or just sort by pointsFor
  g: 's.goals',
  b: 's.behinds',
  k: 's.kicks',
  hb: 's.handballs',
  d: 's.disposals',
  m: 's.marks',
  t: 's.tackles',
  ho: 's.hitouts',
  bv: 's.brownlow_votes',
};

export function isPlayerMatchSort(s: string | undefined): s is keyof typeof PLAYER_MATCH_SORTS {
  return s !== undefined && s in PLAYER_MATCH_SORTS;
}
export function isPlayerMatchSortDir(d: string | undefined): d is 'asc' | 'desc' {
  return d === 'asc' || d === 'desc';
}

/** Paged match log. */
export async function getPlayerMatches(
  playerId: number,
  options: { limit: number; offset: number; season?: number; sort?: string; dir?: string },
): Promise<{ rows: PlayerMatchRow[]; total: number }> {
  const { limit, offset, season, sort, dir } = options;

  let orderBy = sql`m.match_date DESC, m.id DESC`;
  if (isPlayerMatchSort(sort) && isPlayerMatchSortDir(dir)) {
    const sortCol = PLAYER_MATCH_SORTS[sort];
    const sqlDir = dir === 'asc' ? sql`ASC` : sql`DESC`;
    orderBy = sql`${sql.unsafe(sortCol)} ${sqlDir} NULLS LAST, m.match_date DESC, m.id DESC`;
  }
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
     ORDER BY ${orderBy}
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

export type PlayerFamilyRelationship = {
  relationshipType: string;
  /** The loader's label for what the source evidences (e.g. `brothers`, `sisters`, `siblings`). */
  relationshipLabel: string;
  direction: 'from' | 'to';
  relatedPlayerId: number | null;
  relatedPlayerSlug: string | null;
  relatedName: string;
};

export type PlayerFamilyFatherSonAsSon = {
  fatherPlayerId: number | null;
  fatherPlayerSlug: string | null;
  fatherName: string;
  clubName: string | null;
  draftYear: number;
  /** How the selection was made: 'national' | 'rookie' | 'pre-draft' (source pathway, not a pick number). */
  competition: string | null;
  /** The national-draft pick number, when the source recorded one (competition = 'national'); null otherwise -- never manufactured. */
  selectionPick: number | null;
};

export type PlayerFamilyFatherSonAsFather = {
  sonPlayerId: number | null;
  sonPlayerSlug: string | null;
  sonName: string;
  clubName: string | null;
  draftYear: number;
  /** How the selection was made: 'national' | 'rookie' | 'pre-draft' (source pathway, not a pick number). */
  competition: string | null;
  /** The national-draft pick number, when the source recorded one (competition = 'national'); null otherwise -- never manufactured. */
  selectionPick: number | null;
};

export type PlayerFamilyResult = {
  relationships: PlayerFamilyRelationship[];
  fatherSonAsSon: PlayerFamilyFatherSonAsSon[];
  fatherSonAsFather: PlayerFamilyFatherSonAsFather[];
};

/**
 * Family facts for a player from the canonical relationship tables
 * (AFLDB-ISSUE-118 §23.29). `player_relationships` is the general model
 * (parent/child today, siblings once §23.29's blocker clears — nothing
 * here assumes father-son is the only relationship type); the loader also
 * writes one `parent_child` row per father-son selection there
 * (`source_record_id` prefixed `father-son:`), so those rows are excluded
 * here to avoid presenting the same fact twice alongside the dedicated
 * `fatherSonAsSon` / `fatherSonAsFather` lists, which carry the selection
 * detail (club, draft year) the generic table does not.
 */
export async function getPlayerFamily(playerId: number): Promise<PlayerFamilyResult> {
  const [relationships, fatherSonAsSon, fatherSonAsFather] = await Promise.all([
    sql<PlayerFamilyRelationship[]>`
      SELECT r.relationship AS "relationshipType",
             r.relationship_label AS "relationshipLabel",
             CASE WHEN r.person_a_player_id = ${playerId} THEN 'from' ELSE 'to' END AS direction,
             CASE WHEN r.person_a_player_id = ${playerId} THEN r.person_b_player_id
                  ELSE r.person_a_player_id END AS "relatedPlayerId",
             CASE WHEN r.person_a_player_id = ${playerId} THEN pb.slug ELSE pa.slug END AS "relatedPlayerSlug",
             CASE WHEN r.person_a_player_id = ${playerId} THEN r.person_b_name
                  ELSE r.person_a_name END AS "relatedName"
        FROM player_relationships r
        LEFT JOIN players pa ON pa.id = r.person_a_player_id
        LEFT JOIN players pb ON pb.id = r.person_b_player_id
       WHERE (r.person_a_player_id = ${playerId} OR r.person_b_player_id = ${playerId})
         AND r.source_record_id NOT LIKE 'father-son:%'
       ORDER BY r.relationship, "relatedName"
    `,
    sql<PlayerFamilyFatherSonAsSon[]>`
      SELECT fs.father_player_id AS "fatherPlayerId", pf.slug AS "fatherPlayerSlug",
             fs.father_name AS "fatherName",
             COALESCE(cl.name, fs.club_name_raw) AS "clubName",
             fs.draft_year AS "draftYear", fs.competition,
             fs.selection_pick AS "selectionPick"
        FROM father_son_selections fs
        LEFT JOIN players pf ON pf.id = fs.father_player_id
        LEFT JOIN clubs cl ON cl.id = fs.club_id
       WHERE fs.drafted_player_id = ${playerId}
       ORDER BY fs.draft_year
    `,
    sql<PlayerFamilyFatherSonAsFather[]>`
      SELECT fs.drafted_player_id AS "sonPlayerId", ps.slug AS "sonPlayerSlug",
             fs.drafted_player_name AS "sonName",
             COALESCE(cl.name, fs.club_name_raw) AS "clubName",
             fs.draft_year AS "draftYear", fs.competition,
             fs.selection_pick AS "selectionPick"
        FROM father_son_selections fs
        LEFT JOIN players ps ON ps.id = fs.drafted_player_id
        LEFT JOIN clubs cl ON cl.id = fs.club_id
       WHERE fs.father_player_id = ${playerId}
       ORDER BY fs.draft_year
    `,
  ]);
  return { relationships, fatherSonAsSon, fatherSonAsFather };
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
