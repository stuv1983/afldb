import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SqlExecutor } from '@afldb/db';
import type { SeasonRegistry } from '@afldb/domain';
import {
  COLEMAN_AWARD_SLUG,
  COLEMAN_DERIVATION_VERSION,
  ColemanContractError,
  parseColemanContract,
  type ColemanContract,
  type ColemanDerivationInput,
  type ColemanGoalFact,
  type ColemanIdentityRow,
  type ColemanMatchRow,
  type ColemanStoredWinner,
} from '@afldb/derived';

/**
 * Read loaders for the Coleman Medal derivation and its publications (AFLDB V2 Stage 5, plan D9;
 * ADR 0006). READ-ONLY, over the {@link SqlExecutor} port, so the same SQL runs on the postgres.js
 * import connection in production and on in-memory PGlite in tests.
 *
 * Rules every query here follows:
 *  - PARAMETERISED SQL only. Every value, including the contract's identity statuses, is a
 *    positional parameter; the only interpolated text is a generated list of `$n` placeholders.
 *  - Ids are cast `::int` in SQL and coerced with `Number()` (postgres.js returns int8 as a string).
 *  - NULL goals stay NULL. `player_match_stats.goals` NULL means "not recorded", never zero; the
 *    derivation refuses the whole season on one NULL in a home-and-away row rather than understate
 *    a total, so this loader must hand the NULL through untouched.
 *  - Identity is by stable id and by the contract's identity rule (an `afltables` source,
 *    `afltables_profile_url`, an accepted status) — never by name.
 *
 * The role that runs these needs SELECT on matches, player_match_stats, external_identities,
 * sources, awards, award_winners and derived_award_results. `afldb_import` has all of them:
 * the first six are registered import-writable (migration 045 registered every statistical table
 * that existed then), `derived_award_results` has its own grant (tools/maintenance/privileges.sql,
 * migration 112).
 */

/** Path segments of the Coleman derivation contract, relative to the project root. */
export const COLEMAN_CONTRACT_SEGMENTS = ['data', 'reference', 'coleman-derivation.json'] as const;

/** Parse `data/reference/coleman-derivation.json`. Throws {@link ColemanContractError} on any problem. */
export function loadColemanContract(projectRoot: string = process.cwd()): ColemanContract {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(join(projectRoot, ...COLEMAN_CONTRACT_SEGMENTS), 'utf8'));
  } catch (error) {
    throw new ColemanContractError(
      `the Coleman derivation contract (${COLEMAN_CONTRACT_SEGMENTS.join('/')}) could not be read: ${
        error instanceof Error ? error.message.split('\n')[0] : 'unknown error'
      }`,
    );
  }
  return parseColemanContract(json);
}

/* ------------------------------------------------------------------ *
 * Derivation input
 * ------------------------------------------------------------------ */

export interface ColemanInputRequest {
  readonly season: number;
  /** The operator's attestation that the season is settled (plan R-022). Never inferred. */
  readonly settled: boolean;
  /** ISO-8601 UTC instant supplied by the caller (never read from a clock here). */
  readonly derivedAt: string;
  readonly registry: SeasonRegistry;
  readonly contract: ColemanContract;
}

interface MatchRow { matchId: number | string; season: number | string; roundType: string; homeClubId: number | string; awayClubId: number | string }
interface GoalRow { matchId: number | string; playerId: number | string; clubId: number | string; goals: number | string | null }
interface IdentityRow { playerId: number | string; matchMethod: string; externalId: string; status: string }

/**
 * The derivation input for ONE season: every match of the season (home-and-away and finals), every
 * player-match goal fact of those matches, and the accepted identity rows of the players in them.
 * The caller decides what to do with it (`deriveColeman`, `publishColemanResult`).
 */
export async function loadColemanDerivationInput(
  executor: SqlExecutor,
  request: ColemanInputRequest,
): Promise<ColemanDerivationInput> {
  const { season, contract } = request;

  const matchRows = await executor.query<MatchRow>(
    `SELECT m.id::int AS "matchId", m.season::int AS season, m.round_type::text AS "roundType",
            m.home_club_id::int AS "homeClubId", m.away_club_id::int AS "awayClubId"
       FROM matches m
      WHERE m.season = $1::int
      ORDER BY m.id`,
    [season],
  );
  const goalRows = await executor.query<GoalRow>(
    `SELECT pms.match_id::int AS "matchId", pms.player_id::int AS "playerId",
            pms.club_id::int AS "clubId", pms.goals::int AS goals
       FROM player_match_stats pms
       JOIN matches m ON m.id = pms.match_id
      WHERE m.season = $1::int
      ORDER BY pms.match_id, pms.player_id`,
    [season],
  );

  // The contract's identity rule. The accepted statuses are parameters: $1 season, $2 source key,
  // $3 match method, $4.. the statuses.
  const statusPlaceholders = contract.identityStatuses.map((_, index) => `$${index + 4}`).join(', ');
  const identityRows = await executor.query<IdentityRow>(
    `SELECT ei.player_id::int AS "playerId", ei.match_method AS "matchMethod",
            ei.external_id AS "externalId", ei.status::text AS status
       FROM external_identities ei
       JOIN sources s ON s.id = ei.source_id
      WHERE s.key = $2
        AND ei.match_method = $3
        AND ei.status::text IN (${statusPlaceholders})
        AND ei.player_id IN (
          SELECT pms.player_id
            FROM player_match_stats pms
            JOIN matches m ON m.id = pms.match_id
           WHERE m.season = $1::int)
      ORDER BY ei.player_id, ei.external_id`,
    [season, contract.sourceKey, contract.identityMatchMethod, ...contract.identityStatuses],
  );

  const matches: ColemanMatchRow[] = matchRows.map((row) => ({
    matchId: Number(row.matchId),
    season: Number(row.season),
    roundType: row.roundType,
    homeClubId: Number(row.homeClubId),
    awayClubId: Number(row.awayClubId),
  }));
  const playerMatchGoals: ColemanGoalFact[] = goalRows.map((row) => ({
    matchId: Number(row.matchId),
    playerId: Number(row.playerId),
    clubId: Number(row.clubId),
    // NULL = not recorded. Number(null) would be 0: map NULL (and undefined) explicitly.
    goals: row.goals === null || row.goals === undefined ? null : Number(row.goals),
  }));
  const identities: ColemanIdentityRow[] = identityRows.map((row) => ({
    playerId: Number(row.playerId),
    matchMethod: row.matchMethod,
    externalId: row.externalId,
    status: row.status,
  }));

  return {
    contract,
    season,
    seasonState: { registry: request.registry, settled: request.settled },
    matches,
    playerMatchGoals,
    identities,
    derivedAt: request.derivedAt,
    derivationVersion: COLEMAN_DERIVATION_VERSION,
  };
}

/* ------------------------------------------------------------------ *
 * Stored winners
 * ------------------------------------------------------------------ */

interface StoredWinnerRow {
  season: number | string;
  playerId: number | string | null;
  sourceKey: string | null;
  sourceRecordId: string | null;
  status: string;
}

/**
 * The `award_winners` rows of the Coleman award (every status, so the comparison can list void
 * rows as ignored), optionally for one season. A row with NO season is undated and cannot be
 * compared with a season's derivation, so it is not returned.
 */
export async function loadStoredColemanWinners(
  executor: SqlExecutor,
  season?: number,
): Promise<ColemanStoredWinner[]> {
  const rows = await executor.query<StoredWinnerRow>(
    `SELECT w.season::int AS season, w.player_id::int AS "playerId", s.key AS "sourceKey",
            w.source_record_id AS "sourceRecordId", w.status
       FROM award_winners w
       JOIN awards a ON a.id = w.award_id
       LEFT JOIN sources s ON s.id = w.source_id
      WHERE a.slug = $1
        AND w.season IS NOT NULL
        AND ($2::int IS NULL OR w.season = $2::int)
      ORDER BY w.season, w.id`,
    [COLEMAN_AWARD_SLUG, season ?? null],
  );
  return rows.map((row) => ({
    season: Number(row.season),
    playerId: row.playerId === null || row.playerId === undefined ? null : Number(row.playerId),
    sourceKey: row.sourceKey ?? null,
    sourceRecordId: row.sourceRecordId ?? null,
    status: row.status,
  }));
}

/* ------------------------------------------------------------------ *
 * Publications
 * ------------------------------------------------------------------ */

/** One CURRENT published Coleman derivation (no other row supersedes it). */
export interface ColemanPublicationRow {
  readonly id: number;
  readonly season: number;
  readonly methodVersion: number;
  readonly derivationVersion: string;
  readonly inputChecksum: string;
  /** ISO-8601 UTC. */
  readonly derivedAt: string;
  /** ISO-8601 UTC. */
  readonly publishedAt: string;
  /** auth_users.id of the publisher. */
  readonly publishedBy: number;
  readonly supersedesId: number | null;
  /** The stored `winners` jsonb, parsed. */
  readonly winners: unknown;
  /** `winners[].key` — the durable `coleman:<season>:<profile path>` keys. */
  readonly winnerKeys: readonly string[];
}

interface PublicationRow {
  id: number | string;
  season: number | string;
  methodVersion: number | string;
  derivationVersion: string;
  inputChecksum: string;
  derivedAt: string;
  publishedAt: string;
  publishedBy: number | string;
  supersedesId: number | string | null;
  winners: unknown;
}

function fromStore(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function keysOf(winners: unknown): string[] {
  if (!Array.isArray(winners)) return [];
  return winners.flatMap((winner) => {
    const key = (winner as { key?: unknown } | null)?.key;
    return typeof key === 'string' ? [key] : [];
  });
}

/**
 * The CURRENT rows of `derived_award_results` for the Coleman award (the rows no other row
 * supersedes — the same predicate the publisher uses), optionally for one season, newest season
 * first. Superseded rows are history and are not listed.
 */
export async function listColemanPublications(
  executor: SqlExecutor,
  season?: number,
): Promise<ColemanPublicationRow[]> {
  const rows = await executor.query<PublicationRow>(
    `SELECT r.id::int AS id, r.season::int AS season, r.method_version::int AS "methodVersion",
            r.derivation_version AS "derivationVersion", r.input_checksum AS "inputChecksum",
            to_char(r.derived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "derivedAt",
            to_char(r.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt",
            r.published_by::int AS "publishedBy", r.supersedes_id::int AS "supersedesId", r.winners
       FROM derived_award_results r
      WHERE r.award_slug = $1
        AND ($2::int IS NULL OR r.season = $2::int)
        AND NOT EXISTS (SELECT 1 FROM derived_award_results s WHERE s.supersedes_id = r.id)
      ORDER BY r.season DESC, r.id DESC`,
    [COLEMAN_AWARD_SLUG, season ?? null],
  );
  return rows.map((row) => {
    const winners = fromStore(row.winners);
    return {
      id: Number(row.id),
      season: Number(row.season),
      methodVersion: Number(row.methodVersion),
      derivationVersion: row.derivationVersion,
      inputChecksum: row.inputChecksum,
      derivedAt: row.derivedAt,
      publishedAt: row.publishedAt,
      publishedBy: Number(row.publishedBy),
      supersedesId: row.supersedesId === null || row.supersedesId === undefined ? null : Number(row.supersedesId),
      winners,
      winnerKeys: keysOf(winners),
    };
  });
}
