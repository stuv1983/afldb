import 'server-only';
import { brownlowAcceptedSql } from './brownlow-readiness';

import type { SqlExecutor } from '@afldb/db';
import { isSealedSeason, sealedSeasonsFrom, type SeasonRegistry } from '@afldb/domain';
import type {
  BrownlowEligibilityRule,
  BrownlowLeaderboardEntryInput,
  BrownlowLeaderboardInput,
  BrownlowMatchContextInput,
  BrownlowMatchVotesInput,
  BrownlowReconciliationInput,
  BrownlowStoredTotalInput,
  BrownlowVoteInput,
} from '@afldb/derived';

import {
  deriveProviderTeamClubMapping,
  type FixtureTeamEvidence,
  type ProviderTeamIdentity,
  type ProviderTeamMappingEntry,
  type ProviderTeamMappingRefusal,
} from '@/lib/brownlow/provider-team-club-map';

/**
 * Read loader for the Brownlow reconciliation (AFLDB V2 Stage 5, plan D9; ADR 0007). READ-ONLY,
 * over the {@link SqlExecutor} port; parameterised SQL only; ids cast `::int` and coerced with
 * `Number()`; a NULL player/match/club stays NULL (an unresolved id is unresolved, never zero).
 *
 * WHAT IT READS, AND WHAT IT DOES NOT
 *  - match votes: `staging.afl_api_brownlow_vote` (migration 103) — one row per vote, written by
 *    the AFL API Brownlow settle with the provider ids and, where resolved, the canonical
 *    `match_id` / `player_id` (club_id is NULL today: the settle resolves no club). The table is
 *    an upsert on its primary key, so it holds the current projection of each match's vote set.
 *    Rows are grouped by `provider_match_id` into one {@link BrownlowMatchVotesInput} per match.
 *  - stored totals: `brownlow_season_votes` (migration 005) for the season — the authoritative
 *    published totals. `null` when the season has NO rows, which the reconciliation reports as
 *    "not supplied", never as zero votes.
 *  - match context: every `matches` row of the season. `homeProviderTeamId` / `awayProviderTeamId`
 *    stay NULL: the club check runs on the vote's mapped `clubId` instead, so a mapping is never
 *    invented here and never applied unless derived whole (above).
 *  - leaderboard (V2-GAP-023): the per-player `brownlow_leaderboard` records the Brownlow settle
 *    stages on the observation spine (`staging.source_records` heads, scope `season=<year>`, not
 *    absent). `null` when none are staged, which the reconciliation reports as "not supplied". A
 *    staged player whose provider id resolves to no (or more than one) canonical player stays
 *    UNRESOLVED (`playerId: null`); the reconciliation then refuses the whole season, loudly.
 *  - provider team -> club (V2-GAP-023): derived by `deriveProviderTeamClubMapping` from the
 *    committed provider team identities (supplied by the caller), the `clubs` rows and the fixtures
 *    observation of each voted match, and applied to every vote's `clubId` ONLY when the whole
 *    mapping is complete, unambiguous and consistent. Otherwise `clubId` stays NULL and the
 *    reconciliation keeps reporting `club_unverifiable`, with the refusal codes in
 *    {@link BrownlowStagingEvidence}. Without supplied identities the mapping is not attempted.
 *  - award readiness: `complete` only when the season is SEALED in the registry (plan R-022)
 *    AND existing coverage/publication accepts its Brownlow totals. Otherwise `in_progress`;
 *    raw evidence remains available but cannot determine an authoritative medal/ranking.
 *
 * PRIVILEGES. `afldb_import` may SELECT every table read here: `staging` carries the importer's
 * blanket grants (tools/maintenance/privileges.sql, the "Staging is the importer's own
 * workspace" block), and `brownlow_season_votes`, `matches` and `sources` are registered
 * import-writable (migration 045), hence SELECT-able.
 */

/** The provider the staged votes belong to (`sources.key`; the report's `sourceKey` literal). */
export const BROWNLOW_VOTE_SOURCE_KEY = 'afl_api';

/** The staged votes of one match disagree with each other in a way the input type cannot carry. */
export class BrownlowInputError extends Error {
  readonly code = 'inconsistent_staging_rows' as const;

  constructor(message: string) {
    super(message);
    this.name = 'BrownlowInputError';
  }
}

export interface BrownlowInputRequest {
  /** Medal publication may use authoritative historical totals when no API votes exist.
   * This does not claim API coverage or per-match reconciliation. */
  readonly storedOnlyFallback?: boolean;
  readonly season: number;
  readonly registry: SeasonRegistry;
  /** ISO-8601 UTC instant supplied by the caller. */
  readonly generatedAt: string;
  /** Omit for the reconciliation's default (`unrecorded`). */
  readonly eligibilityRule?: BrownlowEligibilityRule;
  /**
   * The committed provider team identities (`data/reference/afl-api-identities.json` `teams`).
   * Omit and the provider-team-to-club mapping is not attempted (`club_unverifiable` as before).
   */
  readonly providerTeamIdentities?: readonly ProviderTeamIdentity[];
}

/** What the staged leaderboard and the provider-team mapping contributed to this input. */
export interface BrownlowStagingEvidence {
  leaderboard: {
    staged: boolean;
    status: string | null;
    entries: number;
    ineligibleEntries: number;
    /** Entries whose provider eligibility is absent, null or not a boolean (UNKNOWN). */
    unknownEligibilityEntries: number;
    winnerEntries: number;
    /** Entries whose provider player id resolves to no (or several) canonical players. */
    unresolvedPlayers: number;
    /** Players the feed no longer lists (stamped absent, excluded from the comparison). */
    absentEntries: number;
  };
  teamMapping:
    | { state: 'not_attempted'; reason: 'no_identities_supplied' | 'no_votes_staged' }
    | { state: 'not_attempted'; reason: 'identities_unavailable'; error: string }
    | {
      state: 'derived';
      entries: readonly ProviderTeamMappingEntry[];
      fixtureMatches: number;
      uncorroborated: readonly string[];
    }
    | { state: 'refused'; refusals: readonly ProviderTeamMappingRefusal[]; fixtureMatches: number };
}

export interface BrownlowReconciliationInputWithEvidence {
  input: BrownlowReconciliationInput;
  staging: BrownlowStagingEvidence;
}

interface VoteRow {
  providerMatchId: string;
  providerPlayerId: string;
  providerTeamId: string;
  apiRoundNumber: number | string;
  canonicalRoundNumber: number | string;
  votes: number | string;
  eligible: boolean | null;
  matchId: number | string | null;
  playerId: number | string | null;
  clubId: number | string | null;
}
interface StoredRow {
  playerId: number | string;
  clubId: number | string | null;
  votes: number | string;
  voteRank: number | string | null;
  eligibleRank: number | string | null;
  isIneligible: boolean;
  isWinner: boolean;
}
interface LeaderboardRow {
  providerPlayerId: string;
  payload: {
    providerTeamId: string;
    votes: number;
    eligible: boolean | null;
    winner: boolean;
    leader: boolean;
    feedStatus: string | null;
  };
  playerIds: Array<number | string> | null;
}
interface FixtureRow {
  providerMatchId: string;
  matchId: number | string;
  providerHomeTeamId: string | null;
  providerAwayTeamId: string | null;
  homeClubId: number | string | null;
  awayClubId: number | string | null;
}
interface ClubRow {
  clubId: number | string;
  legacyClubHist: string;
}
interface ContextRow {
  matchId: number | string;
  season: number | string;
  roundNumber: number | string | null;
  isFinal: boolean;
  homeClubId: number | string | null;
  awayClubId: number | string | null;
}

const optionalInt = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Group the exploded vote rows back into one record per provider match. */
function groupMatchVotes(rows: readonly VoteRow[]): BrownlowMatchVotesInput[] {
  const byMatch = new Map<string, VoteRow[]>();
  for (const row of rows) {
    const group = byMatch.get(row.providerMatchId);
    if (group) group.push(row);
    else byMatch.set(row.providerMatchId, [row]);
  }
  const matches: BrownlowMatchVotesInput[] = [];
  for (const [providerMatchId, group] of byMatch) {
    const apiRounds = new Set(group.map((row) => Number(row.apiRoundNumber)));
    if (apiRounds.size > 1) {
      throw new BrownlowInputError(
        `The staged votes of provider match ${providerMatchId} carry more than one API round number; `
        + 'a match has one round, so the staging rows are inconsistent and nothing is reconciled.',
      );
    }
    // All rows of one match come from one spine record, so these agree. If they ever do not, the
    // honest answer is "unresolved" (null), which the reconciliation refuses as a whole set.
    const matchIds = new Set(group.map((row) => optionalInt(row.matchId)));
    const canonicalRounds = new Set(group.map((row) => Number(row.canonicalRoundNumber)));
    const votes: BrownlowVoteInput[] = group.map((row) => ({
      providerPlayerId: row.providerPlayerId,
      providerTeamId: row.providerTeamId,
      playerId: optionalInt(row.playerId),
      clubId: optionalInt(row.clubId),
      votes: Number(row.votes),
      eligible: row.eligible,
    }));
    matches.push({
      providerMatchId,
      matchId: matchIds.size === 1 ? [...matchIds][0] : null,
      apiRoundNumber: [...apiRounds][0],
      canonicalRoundNumber: canonicalRounds.size === 1 ? [...canonicalRounds][0] : null,
      votes,
    });
  }
  return matches;
}

/** The reconciliation input for ONE season. Throws {@link BrownlowInputError} on inconsistent staging. */
export async function loadBrownlowReconciliationInput(
  executor: SqlExecutor,
  request: BrownlowInputRequest,
): Promise<BrownlowReconciliationInput> {
  return (await loadBrownlowReconciliationInputWithEvidence(executor, request)).input;
}

/** The staged leaderboard of one season, resolved to canonical players, plus what was absent. */
export async function loadStagedLeaderboard(
  executor: SqlExecutor, season: number,
): Promise<{ board: BrownlowLeaderboardInput | null; unresolved: number; absent: number }> {
  const rows = await executor.query<LeaderboardRow>(
    `SELECT r.external_record_id AS "providerPlayerId", p.raw_payload AS payload,
            (SELECT array_agg(DISTINCT e.player_id::int)
               FROM external_identities e
              WHERE e.source_id = r.source_id AND e.external_id = r.external_record_id
                AND e.status IN ('unique', 'resolved') AND e.player_id IS NOT NULL) AS "playerIds"
       FROM staging.source_records r
       JOIN sources s ON s.id = r.source_id
       JOIN staging.source_record_versions v
         ON (v.source_id, v.family, v.external_record_id, v.version_seq)
          = (r.source_id, r.family, r.external_record_id, r.current_version_seq)
       JOIN staging.source_payloads p
         ON (p.source_id, p.family, p.payload_hash) = (v.source_id, v.family, v.payload_hash)
      WHERE s.key = $2
        AND r.family = 'brownlow_leaderboard'
        AND r.scope_key = 'season=' || $1::int
        AND r.absent_since IS NULL
      ORDER BY r.external_record_id`,
    [season, BROWNLOW_VOTE_SOURCE_KEY],
  );
  const absentRows = await executor.query<{ n: number | string }>(
    `SELECT count(*)::int AS n
       FROM staging.source_records r JOIN sources s ON s.id = r.source_id
      WHERE s.key = $2 AND r.family = 'brownlow_leaderboard'
        AND r.scope_key = 'season=' || $1::int AND r.absent_since IS NOT NULL`,
    [season, BROWNLOW_VOTE_SOURCE_KEY],
  );
  const absent = Number(absentRows[0]?.n ?? 0);
  if (rows.length === 0) return { board: null, unresolved: 0, absent };

  const statuses = new Set(rows.map((row) => row.payload.feedStatus ?? null));
  if (statuses.size > 1) {
    throw new BrownlowInputError(
      `The staged leaderboard of season ${season} carries more than one feed status `
      + `(${[...statuses].map((status) => String(status)).sort().join(', ')}); the staging rows are inconsistent and nothing is reconciled.`,
    );
  }
  let unresolved = 0;
  const entries: BrownlowLeaderboardEntryInput[] = rows.map((row) => {
    const ids = row.playerIds ?? [];
    const playerId = ids.length === 1 ? Number(ids[0]) : null;
    if (playerId === null) unresolved += 1;
    return {
      providerPlayerId: row.providerPlayerId,
      providerTeamId: row.payload.providerTeamId,
      playerId,
      totalVotes: Number(row.payload.votes),
      // BP-2025-ELIGIBILITY-v1: only an explicit boolean is evidence; anything else is UNKNOWN (null).
      eligible: typeof row.payload.eligible === 'boolean' ? row.payload.eligible : null,
      winner: row.payload.winner === true,
      leader: row.payload.leader === true,
    };
  });
  return { board: { status: [...statuses][0] ?? null, entries }, unresolved, absent };
}

/** Provider team ids beside the canonical clubs, for each staged voted match. */
async function loadFixtureTeamEvidence(executor: SqlExecutor, season: number): Promise<FixtureTeamEvidence[]> {
  const rows = await executor.query<FixtureRow>(
    `SELECT DISTINCT v.provider_match_id AS "providerMatchId", v.match_id::int AS "matchId",
            p.raw_payload #>> '{home,team,providerId}' AS "providerHomeTeamId",
            p.raw_payload #>> '{away,team,providerId}' AS "providerAwayTeamId",
            m.home_club_id::int AS "homeClubId", m.away_club_id::int AS "awayClubId"
       FROM staging.afl_api_brownlow_vote v
       JOIN sources s ON s.id = v.source_id
       JOIN staging.source_records r
         ON r.source_id = v.source_id AND r.family = 'match' AND r.external_record_id = v.provider_match_id
       JOIN staging.source_record_versions rv
         ON (rv.source_id, rv.family, rv.external_record_id, rv.version_seq)
          = (r.source_id, r.family, r.external_record_id, r.current_version_seq)
       JOIN staging.source_payloads p
         ON (p.source_id, p.family, p.payload_hash) = (rv.source_id, rv.family, rv.payload_hash)
       JOIN matches m ON m.id = v.match_id
      WHERE s.key = $2 AND v.family = 'brownlow_match_votes' AND v.season = $1::int
        AND v.match_id IS NOT NULL
      ORDER BY v.provider_match_id`,
    [season, BROWNLOW_VOTE_SOURCE_KEY],
  );
  return rows
    .filter((row) => row.providerHomeTeamId !== null && row.providerAwayTeamId !== null)
    .map((row) => ({
      providerMatchId: row.providerMatchId,
      matchId: Number(row.matchId),
      providerHomeTeamId: row.providerHomeTeamId as string,
      providerAwayTeamId: row.providerAwayTeamId as string,
      homeClubId: optionalInt(row.homeClubId),
      awayClubId: optionalInt(row.awayClubId),
    }));
}

/** {@link loadBrownlowReconciliationInput}, with what the staged leaderboard and team mapping contributed. */
export async function loadBrownlowReconciliationInputWithEvidence(
  executor: SqlExecutor,
  request: BrownlowInputRequest,
): Promise<BrownlowReconciliationInputWithEvidence> {
  const { season } = request;

  const voteRows = await executor.query<VoteRow>(
    `SELECT v.provider_match_id AS "providerMatchId", v.provider_player_id AS "providerPlayerId",
            v.provider_team_id AS "providerTeamId", v.api_round_number::int AS "apiRoundNumber",
            v.canonical_round_number::int AS "canonicalRoundNumber", v.votes::int AS votes,
            v.eligible AS eligible, v.match_id::int AS "matchId", v.player_id::int AS "playerId",
            v.club_id::int AS "clubId"
       FROM staging.afl_api_brownlow_vote v
       JOIN sources s ON s.id = v.source_id
      WHERE s.key = $2
        AND v.family = 'brownlow_match_votes'
        AND v.season = $1::int
      ORDER BY v.provider_match_id, v.provider_player_id`,
    [season, BROWNLOW_VOTE_SOURCE_KEY],
  );
  const storedRows = await executor.query<StoredRow>(
    `SELECT b.player_id::int AS "playerId", b.club_id::int AS "clubId", b.votes::int AS votes,
            b.vote_rank::int AS "voteRank", b.eligible_rank::int AS "eligibleRank",
            b.is_ineligible AS "isIneligible", b.is_winner AS "isWinner"
       FROM brownlow_season_votes b
      WHERE b.season = $1::int
      ORDER BY b.player_id`,
    [season],
  );
  const contextRows = await executor.query<ContextRow>(
    `SELECT m.id::int AS "matchId", m.season::int AS season, m.round_number::int AS "roundNumber",
            m.is_final AS "isFinal", m.home_club_id::int AS "homeClubId", m.away_club_id::int AS "awayClubId"
       FROM matches m
      WHERE m.season = $1::int
      ORDER BY m.id`,
    [season],
  );

  const storedTotals: BrownlowStoredTotalInput[] | null = storedRows.length === 0
    ? null
    : storedRows.map((row) => ({
      playerId: Number(row.playerId),
      clubId: optionalInt(row.clubId),
      votes: Number(row.votes),
      voteRank: optionalInt(row.voteRank),
      eligibleRank: optionalInt(row.eligibleRank),
      isIneligible: row.isIneligible,
      isWinner: row.isWinner,
    }));
  const matchContext: BrownlowMatchContextInput[] = contextRows.map((row) => ({
    matchId: Number(row.matchId),
    season: Number(row.season),
    roundNumber: optionalInt(row.roundNumber),
    isFinal: row.isFinal,
    homeClubId: optionalInt(row.homeClubId),
    awayClubId: optionalInt(row.awayClubId),
    homeProviderTeamId: null,
    awayProviderTeamId: null,
  }));

  const apiAbsent = request.storedOnlyFallback === true && voteRows.length === 0;
  const staged = apiAbsent
    ? { board: null as BrownlowLeaderboardInput | null, unresolved: 0, absent: 0 }
    : await loadStagedLeaderboard(executor, season);

  let matchVotes = groupMatchVotes(voteRows);
  let teamMapping: BrownlowStagingEvidence['teamMapping'];
  if (request.providerTeamIdentities === undefined) {
    teamMapping = { state: 'not_attempted', reason: 'no_identities_supplied' };
  } else if (voteRows.length === 0) {
    teamMapping = { state: 'not_attempted', reason: 'no_votes_staged' };
  } else {
    const clubs = (await executor.query<ClubRow>(
      `SELECT c.id::int AS "clubId", c.legacy_club_hist AS "legacyClubHist"
         FROM clubs c WHERE c.legacy_club_hist IS NOT NULL ORDER BY c.id`,
    )).map((row) => ({ clubId: Number(row.clubId), legacyClubHist: row.legacyClubHist }));
    const fixtureEvidence = await loadFixtureTeamEvidence(executor, season);
    const required = [
      ...voteRows.map((row) => row.providerTeamId),
      ...(staged.board?.entries.map((entry) => entry.providerTeamId) ?? []),
    ];
    const mapping = deriveProviderTeamClubMapping({
      requiredProviderTeamIds: required,
      identities: request.providerTeamIdentities,
      clubs,
      fixtureEvidence,
    });
    if (mapping.ok) {
      teamMapping = {
        state: 'derived', entries: mapping.entries, fixtureMatches: mapping.fixtureMatches,
        uncorroborated: mapping.uncorroborated,
      };
      matchVotes = matchVotes.map((match) => ({
        ...match,
        votes: match.votes.map((vote) => ({ ...vote, clubId: mapping.byProviderTeam.get(vote.providerTeamId) ?? null })),
      }));
    } else {
      teamMapping = { state: 'refused', refusals: mapping.refusals, fixtureMatches: mapping.fixtureMatches };
    }
  }

  const input: BrownlowReconciliationInput = {
    season,
    seasonState: isSealedSeason(sealedSeasonsFrom(request.registry), season)
      && (await executor.query<{ brownlowAccepted: boolean }>(
        `SELECT ${brownlowAcceptedSql('$1::int')} AS "brownlowAccepted"`, [season],
      )).some((row) => row.brownlowAccepted === true)
      ? 'complete' : 'in_progress',
    generatedAt: request.generatedAt,
    matchVotes,
    leaderboard: staged.board,
    storedTotals,
    matchContext: apiAbsent ? [] : matchContext,
  };
  const entries = staged.board?.entries ?? [];
  return {
    input: request.eligibilityRule === undefined ? input : { ...input, eligibilityRule: request.eligibilityRule },
    staging: {
      leaderboard: {
        staged: staged.board !== null,
        status: staged.board?.status ?? null,
        entries: entries.length,
        ineligibleEntries: entries.filter((entry) => entry.eligible === false).length,
        unknownEligibilityEntries: entries.filter((entry) => entry.eligible === null).length,
        winnerEntries: entries.filter((entry) => entry.winner).length,
        unresolvedPlayers: staged.unresolved,
        absentEntries: staged.absent,
      },
      teamMapping,
    },
  };
}
