import 'server-only';

import type { SqlExecutor } from '@afldb/db';
import { isSealedSeason, sealedSeasonsFrom, type SeasonRegistry } from '@afldb/domain';
import type {
  BrownlowEligibilityRule,
  BrownlowMatchContextInput,
  BrownlowMatchVotesInput,
  BrownlowReconciliationInput,
  BrownlowStoredTotalInput,
  BrownlowVoteInput,
} from '@afldb/derived';

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
 *    are NULL: no committed source maps provider team ids to clubs (the settle itself leaves
 *    `club_id` NULL for the same reason), and a mapping must not be invented here.
 *  - leaderboard: ALWAYS `null`. The AFL API leaderboard has no staged table: migration 103's
 *    header (line 18) records that `afl_api.brownlow_leaderboard` gets no typed projection, and the
 *    leaderboard is reconciled in memory by the acquisition bundle. The comparison against the
 *    leaderboard is therefore reported as not supplied.
 *  - season state: `complete` iff the season is SEALED in the registry (plan R-022), else
 *    `in_progress`.
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
  readonly season: number;
  readonly registry: SeasonRegistry;
  /** ISO-8601 UTC instant supplied by the caller. */
  readonly generatedAt: string;
  /** Omit for the reconciliation's default (`unrecorded`). */
  readonly eligibilityRule?: BrownlowEligibilityRule;
}

interface VoteRow {
  providerMatchId: string;
  providerPlayerId: string;
  providerTeamId: string;
  apiRoundNumber: number | string;
  canonicalRoundNumber: number | string;
  votes: number | string;
  eligible: boolean;
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

  const input: BrownlowReconciliationInput = {
    season,
    seasonState: isSealedSeason(sealedSeasonsFrom(request.registry), season) ? 'complete' : 'in_progress',
    generatedAt: request.generatedAt,
    matchVotes: groupMatchVotes(voteRows),
    leaderboard: null,
    storedTotals,
    matchContext,
  };
  return request.eligibilityRule === undefined ? input : { ...input, eligibilityRule: request.eligibilityRule };
}
