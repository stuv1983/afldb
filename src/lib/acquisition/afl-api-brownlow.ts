/**
 * AFLDB-ISSUE-228 S7 (§10) — the AFL.com.au Brownlow settle engine.
 *
 * Composes pieces S1-S6 already built and proved, generalised to nothing new:
 *
 *   acquired bfawards bundle (S3 emitters, `afl-api-bundle.ts`, unchanged)
 *     -> persistSourceObservation()                      (spine, shared, per match vote-set)
 *     -> match identity (via the ALREADY-SETTLED staging.afl_api_match row)
 *     -> resolveAflApiMatch() / resolveAflApiPlayer()     (S6-D1/D2, shared, unchanged)
 *     -> translateAflApiBrownlowRound()                   (S1, `afl-api-rounds.ts`, extended)
 *     -> applyCanonicalUnit() x3, one savepoint per MATCH  (shared; brownlow_round_votes target)
 *     -> reconcileBrownlowLeaderboard()                   (S3, pure, unchanged)
 *
 * WHAT IS DIFFERENT FROM THE MATCH/PLAYER SETTLE (`settle-afl-api.ts`), AND WHY:
 *
 *   - **Match-grain atomicity, not player-grain.** §10: "a match's vote set is
 *     one unit, all-or-none, mirroring the match family" — but the votes
 *     TARGET is `brownlow_round_votes`, a PLAYER-keyed row
 *     (`(season, player_id, round_number)`), so this is not the match
 *     family's own atomicity (one `matches` row) nor the AFL Tables player
 *     family's per-player independence. `applyBrownlowVoteSet()` therefore
 *     wraps its three `applyCanonicalUnit()` calls in ONE extra
 *     `tx.savepoint()` layer and rolls the whole thing back if any of the
 *     three does not land cleanly (§10, §14 "no partial 3 or 2 or 1 vote
 *     rows").
 *   - **Match resolution never creates.** Brownlow votes never establish a
 *     `matches` row (§10: "it never touches matches/player_match_stats").
 *     The bfawards feed carries only `matchId` and `roundNumber` — no
 *     home/away/date to render a `match_key` from — so this module resolves
 *     a vote's match through the ALREADY-PROJECTED `staging.afl_api_match`
 *     row for the same provider id (written by the match family's own S6
 *     settle, independent of which source owns the canonical row), rather
 *     than re-parsing a bundle. No row there is `unknown_match` (§10 fault
 *     scenario), never a guess.
 *   - **No promotion_candidates queue.** The human-reviewed path is
 *     unimplemented project-wide (`promotion-review.ts:719`); this stage
 *     does not add one for Brownlow. A vote set that would change a
 *     canonical row but is not auto-applied (`--apply` without
 *     `--auto-apply`, or `--observe-only`) is counted (`wouldAutoApply`) and
 *     left unwritten — visible in the run's counters, not silently dropped.
 *   - **`staging.afl_api_brownlow_vote` (migration 103) IS populated (S7
 *     typed-projection closure, AFLDB-ISSUE-228).** `projectAflApiBrownlowVoteSet()`
 *     upserts one row per vote for every fully-resolved (`planned`) set,
 *     mirroring `settle-afl-api.ts`'s `projectAflApiMatch()`/
 *     `projectAflApiPlayerMatch()` exactly: written whenever the set resolves,
 *     independent of `--auto-apply`, skipped only under `--observe-only`
 *     (whose own established contract limits every write to the spine
 *     observation). `canonical_applications`/`brownlow_round_votes` still key
 *     off `staging.source_record_versions` for provenance (unchanged — that FK
 *     is the ledger's own identity, not a design gap), but the canonical
 *     write's PROPOSED vote value is read back from the just-written
 *     projection row in the same transaction (`unitInputFor()`'s
 *     `projectedVotes` parameter), not re-read from the in-memory payload a
 *     second time — see `projectAflApiBrownlowVoteSet()`'s own doc comment for
 *     the exact boundary of that dependency and why match/round/player
 *     resolution itself is not re-derived from the projection.
 *   - **Leaderboard reconciliation runs from parsed records, not the spine.**
 *     `brownlow_leaderboard`'s `promotion_policy` is `'never'` and
 *     `reconcileBrownlowLeaderboard()` (`afl-api-bundle.ts`) is a pure,
 *     already-proven comparison; persisting the leaderboard family's own
 *     per-player spine records is deferred for the same reason as the
 *     projection table above.
 *   - **Independently enable/disableable, default OFF (§10 "Operational
 *     enablement").** `isAflApiBrownlowEnabled()` gates both this stage's
 *     CLIs before they touch the network or a database; the guard exists so
 *     nothing wires Brownlow polling into the nightly match-settle chain (or
 *     against the live endpoint) before an operator explicitly turns it on
 *     for the count.
 */
import type postgres from 'postgres';

import { asImportBatchId, type ImportBatchId } from '../import-batch-id';
import {
  reconcileBrownlowLeaderboard,
  type AflApiBrownlowLeaderboardRecord,
  type AflApiBrownlowMatchVoteRecord,
  type AflApiIdentities,
} from './afl-api-bundle';
import { resolveAflApiMatchViaFixtureObservation } from './afl-api-fixture-identity';
import { resolveAflApiSourceId } from './afl-api-match-identity';
import {
  resolveAflApiMatch,
  type AflApiMatchIdentity,
} from './afl-api-match-resolver';
import { resolveAflApiPlayer } from './afl-api-player-resolver';
import {
  translateAflApiBrownlowRound,
  AflRoundTranslationError,
} from './afl-api-rounds';
import {
  applyCanonicalUnit,
  type CanonicalApplyTargetInput,
  type CanonicalApplyUnitInput,
} from './canonical-apply';
import { NO_MATCH_REKEY_SCOPE } from './match-rekey';
import type { JsonValue } from './observations';
import { persistSourceObservation, type PersistObservationResult } from './observation-store';
import { baselineCanonicalHash } from './promotion-review';
import {
  emptySettleCounters,
  renderMatchKey,
  settleIssueKey,
  writeSettleDataIssue,
  type SettleCounters,
} from './settle-core';
import { getSourceFamily, type SourceFamilyRegistry } from './source-families';

type Tx = postgres.TransactionSql;
/**
 * `resolveAflApiBrownlowMatch()` and its helpers only ever SELECT — never a
 * write, never a `.savepoint()` — so they accept either a bare connection or
 * a transaction, exactly like `afl-api-match-resolver.ts`'s own `Sql` union.
 * This is what lets the read-only canonical-equality audit tool
 * (`tools/current-season/audit-afl-api-brownlow-canonical-equality.ts`) call
 * the SAME production match-resolution function outside any transaction,
 * rather than reimplementing it.
 */
type ReadOnlySql = postgres.Sql | postgres.TransactionSql;

export const SETTLE_SOURCE_KEY = 'afl_api';
export const SETTLE_BATCH_TOOL = 'settle-afl-api-brownlow.ts';
export const SETTLE_ISSUE_TYPE = 'afl_api_brownlow_settle';
export const SETTLE_ISSUE_OWNER = 'settle-afl-api-brownlow.ts';

const BROWNLOW_MATCH_VOTES_FAMILY = 'brownlow_match_votes';
const BROWNLOW_VOTE_TARGET = 'brownlow_round_votes';
const BROWNLOW_ROUND_VOTES_FIELDS = ['played', 'votes'] as const;

/* ------------------------------------------------------------------ *
 * §10 "Operational enablement" — default OFF, independent of the
 * match-family settle's own timer/flag.
 * ------------------------------------------------------------------ */

export const BROWNLOW_ENABLE_ENV = 'AFLDB_AFL_API_BROWNLOW_ENABLED';

/** Anything other than the literal string `'true'` is disabled — never a truthy-string guess. */
export function isAflApiBrownlowEnabled(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  return env[BROWNLOW_ENABLE_ENV] === 'true';
}

/* ------------------------------------------------------------------ *
 * §10 follow-up (2026-09-20) — the completed-season Brownlow backtest
 * authority. It narrows exactly ONE gate: canonical-apply.ts's E2
 * (`season_not_in_progress`), and only for THIS run's brownlow_round_votes
 * write. Every other gate (identity, ownership, vote-set atomicity, round
 * translation, finals exclusion, ...) is untouched — see
 * `backtestInProgressSeasons()` below, the only place the authority is
 * consulted. Obtaining it requires a LIVE `current_database()` read against
 * the connection that will perform the write — never the DSN string, never
 * a hostname guess (the established `tools/db/promotion-check.ts`
 * `gateIdentity` convention). Any other database HARD REFUSES here, before
 * any canonical write is attempted.
 * ------------------------------------------------------------------ */

export const BROWNLOW_BACKTEST_DATABASE = 'afldb_test' as const;

export type AflApiBrownlowCompletedSeasonBacktestAuthority = {
  readonly kind: 'allow-completed-season-backtest';
  readonly verifiedDatabase: typeof BROWNLOW_BACKTEST_DATABASE;
};

/**
 * The only way to obtain {@link AflApiBrownlowCompletedSeasonBacktestAuthority}.
 * Refuses (throws, before any canonical write) unless the live connection's
 * own `current_database()` is exactly `afldb_test` — `afldb_dev`, production
 * and every other name are refused identically, regardless of DSN or host.
 */
export async function requireAflApiBrownlowBacktestDatabase(
  sql: postgres.Sql,
): Promise<AflApiBrownlowCompletedSeasonBacktestAuthority> {
  const [row] = await sql<{ name: string }[]>`SELECT current_database() AS name`;
  const connected = row?.name ?? 'unknown';
  if (connected !== BROWNLOW_BACKTEST_DATABASE) {
    throw new Error(
      `--allow-completed-season-backtest refused: connected database is '${connected}', not `
      + `'${BROWNLOW_BACKTEST_DATABASE}'. The completed-season Brownlow backtest bypass is `
      + `authorised for '${BROWNLOW_BACKTEST_DATABASE}' only.`,
    );
  }
  return { kind: 'allow-completed-season-backtest', verifiedDatabase: BROWNLOW_BACKTEST_DATABASE };
}

/**
 * E2's own gate is `unit.inProgressSeasons.includes(unit.season)`
 * (`canonical-apply.ts`). Widening the array by exactly this run's resolved
 * `season` — only when the authority above was proven — reproduces "in
 * progress" for that one check without touching `canonical-apply.ts`, without
 * mutating `data/reference/seasons.json`, and without affecting the match or
 * player-stats families, which never call this function.
 */
function backtestInProgressSeasons(
  inProgressSeasons: readonly number[], season: number,
): readonly number[] {
  return inProgressSeasons.includes(season) ? inProgressSeasons : [...inProgressSeasons, season];
}

/* ------------------------------------------------------------------ *
 * Counters
 * ------------------------------------------------------------------ */

export type AflApiBrownlowSettleCounters = SettleCounters & {
  /** One per `matchVotes[]` entry acquired (§10: exactly one 3-row set each). */
  voteSetsSeen: number;
  /** §10: match/round/player all resolved, 3-2-1 well-formed — ready to apply. */
  voteSetsPlanned: number;
  /** Planned but `--apply`/`--auto-apply` was not both given (or `--observe-only`): counted, never written. */
  voteSetsWouldAutoApply: number;
  /** The whole 3-row set was refused — `unknown_match`, `round_unmapped`,
   * `brownlow_round_not_home_and_away`, `unresolved_identity`,
   * `player_identity_ambiguous` — by reason. */
  voteSetsRefused: Record<string, number>;
  /** A vote set's canonical write rolled back inside its own savepoint (§10 atomicity). */
  voteSetsApplyFailed: number;
  /** §10 idempotency: every one of a set's three targets came back `nothing_to_write`. */
  voteSetsNoOp: number;
  /** AFLDB-ISSUE-228 S7 correction (2026-09-20): a planned set whose resolved
   * canonical match round differs from the Brownlow feed's own translated
   * round — a legitimate reschedule (proven by match identity, never a
   * guess), always written under the canonical match's round. Counted, not
   * hidden — §10's "do not silently hide mismatches". */
  voteSetsRescheduledRound: number;
  leaderboardPlayersCompared: number;
  leaderboardMismatches: number;
};

export function emptyAflApiBrownlowCounters(): AflApiBrownlowSettleCounters {
  return {
    ...emptySettleCounters(),
    voteSetsSeen: 0,
    voteSetsPlanned: 0,
    voteSetsWouldAutoApply: 0,
    voteSetsRefused: {},
    voteSetsApplyFailed: 0,
    voteSetsNoOp: 0,
    voteSetsRescheduledRound: 0,
    leaderboardPlayersCompared: 0,
    leaderboardMismatches: 0,
  };
}

function recordRefusal(counters: AflApiBrownlowSettleCounters, reason: string): void {
  counters.voteSetsRefused[reason] = (counters.voteSetsRefused[reason] ?? 0) + 1;
}

/* ------------------------------------------------------------------ *
 * HALT (§14) — the one Brownlow-specific HALT condition: a provider id
 * whose already-canonicalised identity contradicts itself. Never thrown
 * for an ordinary refusal (unknown match, unresolved player, ...), which
 * are per-vote-set outcomes, not run-level.
 * ------------------------------------------------------------------ */

export class AflApiBrownlowSettleHalt extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail: Readonly<Record<string, unknown>>,
  ) {
    super(`AFL API Brownlow settle HALT: ${reason}`);
    this.name = 'AflApiBrownlowSettleHalt';
  }
}

class DryRunRollback extends Error {}

/* ------------------------------------------------------------------ *
 * Match identity, resolved from the ALREADY-PROJECTED match family
 * (`staging.afl_api_match`) rather than a freshly parsed bundle — see the
 * module doc comment. Never creates; a miss is `unknown_match`.
 * ------------------------------------------------------------------ */

export type AflApiBrownlowMatchResolution =
  | {
    outcome: 'resolved';
    matchId: number;
    isFinal: boolean;
    season: number;
    /**
     * AFLDB-ISSUE-228 S7 correction (2026-09-20) — the resolved canonical
     * `matches` row's OWN `round_number`, read fresh from `matches` for this
     * `matchId`. This is what `brownlow_round_votes.round_number` must be
     * written from, never `translateAflApiBrownlowRound()`'s translated
     * provider round: `admin-fixtures.ts` (`rescheduleFixture()`) only ever
     * moves a fixture's date/time, never its round — a round change is the
     * separate, audited `changeFixtureRound()` — so a match's `round_number`
     * is a stable identity fact a reschedule never touches, while the
     * Brownlow feed's own round groups a postponed match's votes under
     * whichever week it was actually played (§ the operator's 2025 Round-24
     * evidence: two Gold Coast postponed/rescheduled matches, one Opening
     * Round fixture played in Round 24's week). `null` only when `isFinal`
     * is `true` (`matches_is_final_ck`); a Brownlow vote never reaches a
     * final match's round in practice (defensively refused one step
     * earlier by `isFinal` in `planAflApiBrownlowMatchSet()`, stated here
     * rather than asserted away with `as number`).
     */
    roundNumber: number | null;
  }
  | {
    outcome: 'refused';
    reason: 'unknown_match' | 'provider_id_ambiguous' | 'rekey_ambiguous' | 'rekey_would_merge'
      // Fixture-only identity fallback refusals (S7 follow-up, 2026-09-20) —
      // only reachable when a `fixtureIdentityFallback` is supplied AND
      // `staging.afl_api_match` has no row for this provider match id.
      | 'fixture_identity_ambiguous' | 'unmapped_club_hist' | 'fixture_observation_invalid'
      | 'match_date_unavailable';
  }
  | {
    outcome: 'halt';
    reason: 'provider_identity_contradiction';
    targetId: number;
    observed: { season: number; homeClubId: number; awayClubId: number };
    incoming: { season: number; homeClubId: number; awayClubId: number };
  };

/**
 * Optional fixture-only identity evidence (S7 follow-up, 2026-09-20):
 * when supplied, a vote set whose match has no `staging.afl_api_match` row
 * yet (the normal match-family settle never ran for that match) is retried
 * against the fixture-only observation spine — see
 * `afl-api-fixture-identity.ts` for why that path never touches
 * `staging.afl_api_match` and can never re-own or duplicate a canonical
 * match. Omitting this parameter keeps every existing caller's behaviour
 * byte-identical: the fallback never runs unless a caller explicitly opts
 * in by supplying it.
 */
export type AflApiFixtureIdentityFallback = {
  registry: SourceFamilyRegistry;
  identities: AflApiIdentities;
};

type StagedMatchRow = {
  season: number;
  roundCode: string;
  matchDate: string;
  homeClubId: number;
  awayClubId: number;
  isFinal: boolean;
};

async function readStagedMatch(sql: ReadOnlySql, sourceId: number, providerMatchId: string): Promise<StagedMatchRow | null> {
  const [row] = await sql<StagedMatchRow[]>`
    SELECT season, round_code AS "roundCode", match_date::text AS "matchDate",
           home_club_id AS "homeClubId", away_club_id AS "awayClubId", is_final AS "isFinal"
      FROM staging.afl_api_match
     WHERE source_id = ${sourceId} AND family = 'match' AND external_record_id = ${providerMatchId}
  `;
  return row ?? null;
}

/**
 * The single source of truth for `brownlow_round_votes.round_number`: the
 * resolved canonical `matches` row's OWN round, read fresh rather than
 * carried from `staging.afl_api_match` (which can predate an admin's later
 * `changeFixtureRound()`/rekey) or derived from the Brownlow feed's own
 * round (§ AflApiBrownlowMatchResolution.roundNumber doc comment above).
 * `null` only for a final (`matches_is_final_ck`).
 */
async function readMatchRoundNumber(sql: ReadOnlySql, matchId: number): Promise<number | null> {
  const [row] = await sql<{ roundNumber: number | null }[]>`
    SELECT round_number AS "roundNumber" FROM matches WHERE id = ${matchId}
  `;
  if (!row) {
    throw new Error(`Brownlow match resolution: matches.id=${matchId} vanished immediately after being resolved.`);
  }
  return row.roundNumber;
}

/**
 * §6.1's provider-id-first / `match_key` resolution, driven by the match
 * family's own already-settled staging projection rather than a fresh
 * bundle (the bfawards feed carries nothing to build one from). Never
 * proposes `new_target` — Brownlow never creates a match (§10).
 */
export async function resolveAflApiBrownlowMatch(
  sql: ReadOnlySql, sourceId: number, providerMatchId: string,
  fixtureIdentityFallback?: AflApiFixtureIdentityFallback,
): Promise<AflApiBrownlowMatchResolution> {
  const staged = await readStagedMatch(sql, sourceId, providerMatchId);
  if (staged === null) {
    if (!fixtureIdentityFallback) return { outcome: 'refused', reason: 'unknown_match' };
    const fallback = await resolveAflApiMatchViaFixtureObservation(
      sql, sourceId, providerMatchId, fixtureIdentityFallback.registry, fixtureIdentityFallback.identities,
    );
    if (fallback.outcome === 'refused') {
      // `no_fixture_observation` collapses into the same `unknown_match`
      // the primary path already reports for "nothing to resolve against" —
      // both mean the operator has not yet staged this match's identity by
      // any path. Every other fixture-identity refusal reason is a genuine,
      // distinct fact (an ambiguity, a mapping gap, an invalid observation)
      // and is surfaced as its own reason, never collapsed.
      const reason = fallback.reason === 'no_fixture_observation' ? 'unknown_match' : fallback.reason;
      return { outcome: 'refused', reason };
    }
    const roundNumber = await readMatchRoundNumber(sql, fallback.matchId);
    return {
      outcome: 'resolved', matchId: fallback.matchId, isFinal: fallback.isFinal, season: fallback.season, roundNumber,
    };
  }

  const [clubs] = await sql<{ homeName: string; awayName: string }[]>`
    SELECT h.name AS "homeName", a.name AS "awayName"
      FROM clubs h, clubs a
     WHERE h.id = ${staged.homeClubId} AND a.id = ${staged.awayClubId}
  `;
  if (!clubs) return { outcome: 'refused', reason: 'unknown_match' };

  const identity: AflApiMatchIdentity = {
    sourceId,
    providerId: providerMatchId,
    season: staged.season,
    roundCode: staged.roundCode,
    matchDate: staged.matchDate,
    homeClubId: staged.homeClubId,
    awayClubId: staged.awayClubId,
    matchKey: renderMatchKey(staged.season, staged.roundCode, staged.matchDate, clubs.homeName, clubs.awayName),
  };

  const resolution = await resolveAflApiMatch(sql, identity, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE });

  if (resolution.outcome === 'halt') {
    return {
      outcome: 'halt', reason: resolution.reason, targetId: resolution.targetId,
      observed: resolution.observed, incoming: resolution.incoming,
    };
  }
  if (resolution.outcome === 'unresolved') return { outcome: 'refused', reason: 'unknown_match' };
  if (resolution.outcome === 'refused') return { outcome: 'refused', reason: resolution.reason };
  const roundNumber = await readMatchRoundNumber(sql, resolution.targetId);
  return {
    outcome: 'resolved', matchId: resolution.targetId, isFinal: staged.isFinal, season: staged.season, roundNumber,
  };
}

/* ------------------------------------------------------------------ *
 * One match's vote-set plan (§10)
 * ------------------------------------------------------------------ */

export type AflApiBrownlowVoteUnit = {
  providerPlayerId: string;
  providerTeamId: string;
  playerId: number;
  votes: number;
  eligible: boolean;
};

export type AflApiBrownlowMatchSetPlan =
  | { status: 'refused'; providerMatchId: string; reason: string; detail?: string }
  | {
    status: 'planned';
    providerMatchId: string;
    /** The resolved canonical match's id — AFLDB-ISSUE-228 S7 typed-projection
     * closure: carried so the whole set's rows can be written to
     * `staging.afl_api_brownlow_vote` (migration 103) with real `match_id`
     * identity, matching Option B's "resolved when resolvable" intent. */
    matchId: number;
    season: number;
    /** The resolved canonical match's OWN round_number — see the doc comment
     * on `AflApiBrownlowMatchResolution.roundNumber`. This is what gets
     * written to `brownlow_round_votes.round_number`, never
     * `providerTranslatedRound`. */
    canonicalRoundNumber: number;
    /** The Brownlow feed's own round, translated by
     * `translateAflApiBrownlowRound()` — retained for observability, never
     * written anywhere. Equal to `canonicalRoundNumber` for the overwhelming
     * majority of matches; differs only for a rescheduled/postponed fixture
     * (`rescheduled` below), never hidden. */
    providerTranslatedRound: number;
    /** `true` when `providerTranslatedRound !== canonicalRoundNumber` — a
     * legitimate reschedule, proven by the independently-resolved canonical
     * match identity (`resolveAflApiBrownlowMatch()`), never a guess from
     * dates. Surfaced so a run's counters make every such vote set
     * observable (§10 follow-up 2026-09-20: AFLDB-ISSUE-228), never silently
     * folded into the ordinary case. */
    rescheduled: boolean;
    units: readonly AflApiBrownlowVoteUnit[];
  };

/**
 * Resolves match, round and all three players for one `matchVotes[]` entry.
 * §10: match/round refusal and ANY player refusal (unresolved or ambiguous)
 * refuse the WHOLE set — "the other two votes of the match still apply? No."
 * Finals are excluded both by the feed (never observed) and defensively
 * here, twice over: the round-vocabulary translation refuses a non-H&A
 * round, and the resolved match's OWN `is_final` is checked independently.
 */
export async function planAflApiBrownlowMatchSet(
  sql: Tx, sourceId: number, registry: SourceFamilyRegistry,
  record: AflApiBrownlowMatchVoteRecord,
  fixtureIdentityFallback?: AflApiFixtureIdentityFallback,
): Promise<AflApiBrownlowMatchSetPlan> {
  const { providerMatchId } = record;

  const matchResolution = await resolveAflApiBrownlowMatch(sql, sourceId, providerMatchId, fixtureIdentityFallback);
  if (matchResolution.outcome === 'halt') {
    throw new AflApiBrownlowSettleHalt(matchResolution.reason, {
      providerMatchId, targetId: matchResolution.targetId,
      observed: matchResolution.observed, incoming: matchResolution.incoming,
    });
  }
  if (matchResolution.outcome === 'refused') {
    return { status: 'refused', providerMatchId, reason: matchResolution.reason };
  }
  if (matchResolution.isFinal) {
    return { status: 'refused', providerMatchId, reason: 'brownlow_final_match_excluded' };
  }
  const season = matchResolution.season;

  // §6.4/§10 source validation ONLY: proves `record.apiRoundNumber` is a
  // declared, home-and-away provider round (refusing finals vocabulary and
  // an undeclared round exactly as before). Its RESULT is never written to
  // `brownlow_round_votes.round_number` any more — see
  // `AflApiBrownlowMatchResolution.roundNumber`'s doc comment for why the
  // resolved canonical match's own round is the only correct target value,
  // and the AFLDB-ISSUE-228 S7 correction (2026-09-20) that made this so.
  let providerTranslatedRound: number;
  try {
    const canonical = translateAflApiBrownlowRound(registry, season, record.apiRoundNumber);
    if (canonical.roundNumber === null) {
      // Unreachable in practice (translateAflApiBrownlowRound already refuses
      // a non-home_and_away roundType), stated defensively rather than
      // asserted away with `as number`.
      return { status: 'refused', providerMatchId, reason: 'brownlow_round_not_home_and_away' };
    }
    providerTranslatedRound = canonical.roundNumber;
  } catch (error) {
    if (error instanceof AflRoundTranslationError) {
      // §6.4: no declared vocabulary for the season at all is a run-level
      // HALT before any further work — never a per-vote-set refusal, which
      // would silently keep settling later matches with no round table to
      // translate against.
      if (error.code === 'round_vocabulary_missing') {
        throw new AflApiBrownlowSettleHalt(error.code, { providerMatchId, season, detail: error.message });
      }
      return { status: 'refused', providerMatchId, reason: error.code, detail: error.message };
    }
    throw error;
  }

  if (matchResolution.roundNumber === null) {
    // Unreachable: `matchResolution.isFinal` was already checked `false`
    // above, and `matches_is_final_ck` (migration 003) ties `is_final` to
    // `round_type <> 'home_and_away'`, which `matches_round_number_ck` in
    // turn ties to `round_number IS NOT NULL`. Stated defensively rather
    // than asserted away with `as number`, matching this function's own
    // style just above.
    return { status: 'refused', providerMatchId, reason: 'brownlow_round_not_home_and_away' };
  }
  const canonicalRoundNumber = matchResolution.roundNumber;
  const rescheduled = providerTranslatedRound !== canonicalRoundNumber;

  const units: AflApiBrownlowVoteUnit[] = [];
  for (const vote of record.votes) {
    const resolution = await resolveAflApiPlayer(sql, sourceId, vote.providerPlayerId);
    if (resolution.outcome !== 'resolved') {
      return {
        status: 'refused', providerMatchId,
        reason: resolution.outcome === 'refused' ? resolution.reason : 'unresolved_identity',
        detail: vote.providerPlayerId,
      };
    }
    units.push({
      providerPlayerId: vote.providerPlayerId,
      providerTeamId: vote.providerTeamId,
      playerId: resolution.playerId,
      votes: vote.votes,
      eligible: vote.eligible,
    });
  }

  const distinctPlayers = new Set(units.map((u) => u.playerId));
  if (distinctPlayers.size !== units.length) {
    return { status: 'refused', providerMatchId, reason: 'duplicate_player_canonical_identity' };
  }

  return {
    status: 'planned', providerMatchId, matchId: matchResolution.matchId,
    season, canonicalRoundNumber, providerTranslatedRound, rescheduled, units,
  };
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-228 S7 typed-projection closure — `staging.afl_api_brownlow_vote`
 * (migration 103). Mirrors `projectAflApiMatch()`/`projectAflApiPlayerMatch()`
 * in `settle-afl-api.ts` exactly: one upsert per resolved row, keyed on the
 * spine's own `(source_id, family, external_record_id)` plus, here,
 * `provider_player_id` (the projection's grain is one row per vote — the
 * migration's own PRIMARY KEY). Written only for a fully PLANNED set (match,
 * round and all three players resolved) — exactly the same condition under
 * which the sibling match-family projections are written (`settle-afl-api.ts`
 * only calls `projectAflApiMatch`/`projectAflApiPlayerMatch` once identity has
 * resolved) — never for a refused set, which is documented, not silent:
 * Option B's nullable match_id/player_id/club_id exists for the OBSERVED-but-
 * not-yet-canonically-resolvable case a settle run can encounter, but this
 * settle never observes a vote without simultaneously attempting its full
 * resolution, so there is no intermediate "observed, partially resolved" state
 * for this particular writer to persist; `club_id` is left NULL throughout —
 * no club (provider-team-to-club) resolution exists anywhere in this module,
 * and Option B explicitly allows it (§10 explicit column list: "club_id
 * NULL").
 *
 * `RETURNING votes` feeds `unitInputFor()` below: the canonical write's
 * proposed vote value is read back from the JUST-WRITTEN projection row in
 * the SAME transaction, not re-derived from the in-memory bundle a second
 * time — a real (if narrow) dependency, rather than the projection being a
 * parallel, ignored side-write. See `applyAflApiBrownlowVoteSet()`'s own doc
 * comment for why this stops short of making canonical planning itself
 * (match/round/player resolution, the all-or-none refusal) re-read the
 * projection: that logic is already proven and `settle-afl-api.ts` documents
 * the identical choice (canonical apply "never reads them back" for the match
 * family either) — re-deriving proven resolution logic from a staging table
 * would be a redesign, not a fix, and risks a second, divergent
 * implementation of the same gates.
 * ------------------------------------------------------------------ */

async function projectAflApiBrownlowVoteSet(
  tx: Tx,
  input: {
    sourceId: number;
    batchId: ImportBatchId;
    providerMatchId: string;
    versionSeq: number;
    season: number;
    apiRoundNumber: number;
    canonicalRoundNumber: number;
    matchId: number;
    units: readonly AflApiBrownlowVoteUnit[];
  },
): Promise<ReadonlyMap<string, number>> {
  const votesByProviderPlayerId = new Map<string, number>();
  for (const unit of input.units) {
    const [row] = await tx<{ votes: number }[]>`
      INSERT INTO staging.afl_api_brownlow_vote (
        source_id, family, external_record_id, version_seq,
        provider_match_id, provider_player_id, provider_team_id,
        season, api_round_number, canonical_round_number,
        votes, eligible, match_id, player_id, club_id,
        projected_by_batch_id
      ) VALUES (
        ${input.sourceId}, 'brownlow_match_votes', ${input.providerMatchId}, ${input.versionSeq},
        ${input.providerMatchId}, ${unit.providerPlayerId}, ${unit.providerTeamId},
        ${input.season}, ${input.apiRoundNumber}, ${input.canonicalRoundNumber},
        ${unit.votes}, ${unit.eligible}, ${input.matchId}, ${unit.playerId}, ${null},
        ${input.batchId}
      )
      ON CONFLICT (source_id, family, external_record_id, provider_player_id) DO UPDATE SET
        version_seq = EXCLUDED.version_seq,
        provider_team_id = EXCLUDED.provider_team_id,
        season = EXCLUDED.season,
        api_round_number = EXCLUDED.api_round_number,
        canonical_round_number = EXCLUDED.canonical_round_number,
        votes = EXCLUDED.votes,
        eligible = EXCLUDED.eligible,
        match_id = EXCLUDED.match_id,
        player_id = EXCLUDED.player_id,
        projected_by_batch_id = EXCLUDED.projected_by_batch_id,
        projected_at = now()
      RETURNING votes
    `;
    if (!row) {
      throw new Error(
        `staging.afl_api_brownlow_vote upsert returned no row for player ${unit.providerPlayerId} `
        + `in match ${input.providerMatchId}.`,
      );
    }
    votesByProviderPlayerId.set(unit.providerPlayerId, row.votes);
  }
  return votesByProviderPlayerId;
}

/* ------------------------------------------------------------------ *
 * Atomic apply — one savepoint per match's whole 3-row vote set (§10, §14).
 * ------------------------------------------------------------------ */

export type AflApiBrownlowApplyOutcome =
  | { status: 'applied'; rowsInserted: number; rowsUpdated: number }
  | { status: 'no_op' }
  | { status: 'failed'; reason: string };

async function currentBrownlowRoundVote(
  sql: Tx, season: number, playerId: number, roundNumber: number,
): Promise<{ played: boolean; votes: number } | null> {
  const [row] = await sql<{ played: boolean; votes: number }[]>`
    SELECT played, votes FROM brownlow_round_votes
     WHERE season = ${season} AND player_id = ${playerId} AND round_number = ${roundNumber}
  `;
  return row ?? null;
}

function unitInputFor(
  sourceId: number, sourceKeysById: ReadonlyMap<number, string>, batchId: ImportBatchId,
  inProgressSeasons: readonly number[], providerMatchId: string, sourceVersionSeq: number,
  season: number, canonicalRoundNumber: number, unit: AflApiBrownlowVoteUnit,
  currentValues: Readonly<Record<string, JsonValue>> | null,
  projectedVotes: number,
): CanonicalApplyUnitInput {
  // AFLDB-ISSUE-228 S7 typed-projection closure: the proposed vote value is
  // the one just written to (and read back from) staging.afl_api_brownlow_vote
  // — see projectAflApiBrownlowVoteSet()'s doc comment — never a second,
  // independent read of unit.votes.
  const proposedValues: Readonly<Record<string, JsonValue>> = { played: true, votes: projectedVotes };
  const target: CanonicalApplyTargetInput = {
    targetTable: BROWNLOW_VOTE_TARGET,
    invitation: 'candidate',
    proposedValues,
    renderedFields: [...BROWNLOW_ROUND_VOTES_FIELDS],
    renderedBaselineCanonicalHash: currentValues === null
      ? null
      : baselineCanonicalHash([...BROWNLOW_ROUND_VOTES_FIELDS], currentValues),
    sourceVersionSeq,
  };
  return {
    family: BROWNLOW_MATCH_VOTES_FAMILY,
    externalRecordId: providerMatchId,
    season,
    sourceId,
    sourceKey: SETTLE_SOURCE_KEY,
    sourceKeysById,
    batchId,
    inProgressSeasons,
    completionProven: true,
    matchKey: providerMatchId,
    matchRekey: null,
    playerId: unit.playerId,
    brownlowRoundNumber: canonicalRoundNumber,
    targets: [target],
  };
}

/**
 * Applies one match's whole vote set inside ONE savepoint nested under the
 * caller's transaction: any of the three `applyCanonicalUnit()` calls
 * landing on anything other than `applied` or the idempotent
 * `nothing_to_write` refusal throws, rolling the WHOLE set back — §10's "no
 * partial 3 or 2 or 1 vote rows", enforced structurally rather than by
 * convention.
 *
 * `projectedVotes` (AFLDB-ISSUE-228 S7 typed-projection closure) must carry
 * one entry per `input.units[].providerPlayerId`, written by
 * `projectAflApiBrownlowVoteSet()` in the SAME transaction immediately
 * before this call. A missing entry is a caller defect (the projection write
 * was skipped or failed silently) and refuses the whole set rather than
 * falling back to the unprojected value — the canonical write must never
 * proceed from a vote this run did not just prove it staged.
 */
export async function applyAflApiBrownlowVoteSet(
  tx: Tx,
  input: {
    sourceId: number;
    sourceKeysById: ReadonlyMap<number, string>;
    batchId: ImportBatchId;
    inProgressSeasons: readonly number[];
    providerMatchId: string;
    sourceVersionSeq: number;
    season: number;
    canonicalRoundNumber: number;
    units: readonly AflApiBrownlowVoteUnit[];
    projectedVotes: ReadonlyMap<string, number>;
  },
): Promise<AflApiBrownlowApplyOutcome> {
  try {
    let rowsInserted = 0;
    let rowsUpdated = 0;
    let anyWrite = false;
    await tx.savepoint(async (sp) => {
      const scope = sp as Tx;
      for (const unit of input.units) {
        const projected = input.projectedVotes.get(unit.providerPlayerId);
        if (projected === undefined) {
          throw new Error(
            `staging.afl_api_brownlow_vote carries no projected row for player `
            + `${unit.providerPlayerId} in match ${input.providerMatchId} — refusing to apply `
            + 'brownlow_round_votes from an unprojected vote.',
          );
        }
        const currentValues = await currentBrownlowRoundVote(
          scope, input.season, unit.playerId, input.canonicalRoundNumber,
        );
        const unitInput = unitInputFor(
          input.sourceId, input.sourceKeysById, input.batchId, input.inProgressSeasons,
          input.providerMatchId, input.sourceVersionSeq, input.season, input.canonicalRoundNumber,
          unit, currentValues, projected,
        );
        const outcome = await applyCanonicalUnit(scope, unitInput);
        if (outcome.failure !== null) {
          throw new Error(
            `brownlow_round_votes write failed for player ${unit.playerId}: ${outcome.failure.message}`,
          );
        }
        for (const result of outcome.results) {
          if (result.applied) {
            rowsInserted += result.rowsInserted;
            rowsUpdated += result.rowsUpdated;
            anyWrite = true;
          } else if (result.refusal !== 'nothing_to_write') {
            throw new Error(
              `brownlow_round_votes refused for player ${unit.playerId}: ${result.refusal}`,
            );
          }
        }
      }
    });
    return anyWrite ? { status: 'applied', rowsInserted, rowsUpdated } : { status: 'no_op' };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Leaderboard reconciliation (§10: "advisory during the count, blocking at
 * the end") — pure comparison, no spine write in this pass (module doc).
 * ------------------------------------------------------------------ */

export type AflApiBrownlowLeaderboardReconciliation = {
  compared: number;
  mismatches: readonly { providerPlayerId: string; reconstructedTotal: number; leaderboardTotal: number }[];
  blocking: boolean;
};

export function reconcileAflApiBrownlowSeason(
  matchVotes: readonly AflApiBrownlowMatchVoteRecord[],
  leaderboard: readonly AflApiBrownlowLeaderboardRecord[],
  leaderboardStatus: string | null,
): AflApiBrownlowLeaderboardReconciliation {
  const mismatches = reconcileBrownlowLeaderboard(matchVotes, leaderboard);
  return {
    compared: leaderboard.length,
    mismatches,
    // §10: advisory during the live count, blocking once the provider itself
    // reports the count concluded.
    blocking: mismatches.length > 0 && leaderboardStatus === 'CONCLUDED',
  };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export type AflApiBrownlowSettleRunOptions = {
  registry: SourceFamilyRegistry;
  season: number;
  matchVotes: readonly AflApiBrownlowMatchVoteRecord[];
  leaderboard: readonly AflApiBrownlowLeaderboardRecord[];
  leaderboardStatus: string | null;
  inProgressSeasons: readonly number[];
  /** Commits the batch/spine observations. Without it, the whole run rolls back (matching settle-afl-api.ts). */
  apply: boolean;
  /** The automatic canonical-write switch. Without it, a planned set is counted (`voteSetsWouldAutoApply`) and left unwritten. */
  autoApply: boolean;
  /** §10: fetch/parse/validate/log only — spine observations are still persisted, but no canonical write is ever attempted, regardless of `apply`/`autoApply`. */
  observeOnly: boolean;
  observedAt?: string;
  /** S7 follow-up (2026-09-20): optional fixture-only identity fallback,
   * consulted only when `staging.afl_api_match` has no row for a vote set's
   * match. Omit to keep this run's behaviour byte-identical to before this
   * fallback existed. */
  fixtureIdentityFallback?: AflApiFixtureIdentityFallback;
  /** AFLDB-ISSUE-228 §10 follow-up: narrows E2 (`season_not_in_progress`) to
   * "in progress" for THIS run's resolved season, for the
   * brownlow_round_votes write only. Obtain via
   * `requireAflApiBrownlowBacktestDatabase()` — never construct this value
   * any other way. Omit to keep this run's behaviour byte-identical to
   * before this authority existed. */
  completedSeasonBacktestAuthority?: AflApiBrownlowCompletedSeasonBacktestAuthority;
};

export type AflApiBrownlowSettleRunResult = {
  applied: boolean;
  batchId: string | null;
  counters: AflApiBrownlowSettleCounters;
  reconciliation: AflApiBrownlowLeaderboardReconciliation;
  halt: { reason: string; detail: Readonly<Record<string, unknown>> } | null;
};

export async function runSettleAflApiBrownlow(
  sql: postgres.Sql, options: AflApiBrownlowSettleRunOptions,
): Promise<AflApiBrownlowSettleRunResult> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const counters = emptyAflApiBrownlowCounters();
  const contract = getSourceFamily(options.registry, SETTLE_SOURCE_KEY, BROWNLOW_MATCH_VOTES_FAMILY);

  let batchIdText: string | null = null;
  let applied = false;
  let halt: { reason: string; detail: Readonly<Record<string, unknown>> } | null = null;

  try {
    await sql.begin(async (tx) => {
      const sourceId = await resolveAflApiSourceId(tx);
      const sources = await tx<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
      const sourceKeysById = new Map(sources.map((row) => [row.id, row.key]));

      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
        VALUES (
          ${sourceId}, ${SETTLE_BATCH_TOOL}, 'staging.source_record_versions',
          ${options.matchVotes.length},
          ${`AFLDB-ISSUE-228 S7 Brownlow settle; season=${options.season}; `
            + `mode=${options.apply ? 'apply' : 'dry-run'}`
            + `${options.autoApply ? '; auto-apply' : ''}${options.observeOnly ? '; observe-only' : ''}`}
        )
        RETURNING id
      `;
      const batchId = asImportBatchId(batch.id);
      batchIdText = batch.id;

      for (const record of options.matchVotes) {
        counters.voteSetsSeen += 1;

        const action: PersistObservationResult = await persistSourceObservation(
          tx,
          {
            contract, sourceId, externalRecordId: record.providerMatchId,
            scopeKey: `season=${options.season}`, payload: record as unknown as JsonValue,
          },
          batchId, observedAt,
        );
        counters.observationsSeen += 1;
        if (action === 'version_inserted') {
          counters.versionsAppended += 1;
          counters.payloadsCreated += 1;
        } else {
          counters.observationsUnchanged += 1;
        }
        const [head] = await tx<{ versionSeq: number }[]>`
          SELECT current_version_seq AS "versionSeq" FROM staging.source_records
           WHERE source_id = ${sourceId} AND family = ${BROWNLOW_MATCH_VOTES_FAMILY}
             AND external_record_id = ${record.providerMatchId}
        `;
        if (!head) {
          throw new Error(
            `staging.source_records has no head for brownlow_match_votes '${record.providerMatchId}' `
            + 'immediately after persisting it.',
          );
        }

        // §10 "observe-only": fetch/parse/validate/log only. Planning (match/
        // round/player resolution, the 3-2-1 all-or-none classification)
        // still runs and is still counted — "validate" is not optional — but
        // no diagnostic write (data_issues/import_rejections) and no
        // canonical-write attempt happens; only the spine observation above
        // is persisted.
        const plan = await planAflApiBrownlowMatchSet(
          tx, sourceId, options.registry, record, options.fixtureIdentityFallback,
        );
        if (plan.status === 'refused') {
          recordRefusal(counters, plan.reason);
          if (options.observeOnly) continue;
          await writeSettleDataIssue(tx, {
            entityType: BROWNLOW_VOTE_TARGET,
            entityId: null,
            issueType: SETTLE_ISSUE_TYPE,
            issueKey: settleIssueKey(SETTLE_SOURCE_KEY, BROWNLOW_MATCH_VOTES_FAMILY, record.providerMatchId, BROWNLOW_VOTE_TARGET),
            severity: 'error',
            description: `afl_api Brownlow match '${record.providerMatchId}' vote set refused: ${plan.reason}.`,
            details: {
              owner: SETTLE_ISSUE_OWNER, source_key: SETTLE_SOURCE_KEY,
              provider_match_id: record.providerMatchId, reason: plan.reason, detail: plan.detail ?? null,
            },
          }, counters);
          await tx`
            INSERT INTO import_rejections (import_batch_id, source_record_id, reason, payload)
            VALUES (${batchId}, ${record.providerMatchId}, ${`brownlow_round_votes: ${plan.reason}`}, ${tx.json(record as never)})
          `;
          continue;
        }

        counters.voteSetsPlanned += 1;
        if (plan.rescheduled) counters.voteSetsRescheduledRound += 1;

        // AFLDB-ISSUE-228 S7 typed-projection closure: staging.afl_api_brownlow_vote
        // (migration 103) is populated for every fully-resolved set — independent
        // of --auto-apply, exactly as the match family's own read-audit
        // projections are written "whenever the match family itself resolved and
        // projected, independent of whether this run wrote (or even proposed) a
        // canonical change this time" (settle-afl-api.ts). §10's "observe-only:
        // fetch/parse/validate/log, no ... write" is the one exception — that
        // mode's own established contract limits every write to the spine
        // observation above, so the projection is skipped there, matching how
        // this same block already skips data_issues/import_rejections for it.
        const projectedVotes = options.observeOnly
          ? null
          : await projectAflApiBrownlowVoteSet(tx, {
            sourceId, batchId, providerMatchId: record.providerMatchId, versionSeq: head.versionSeq,
            season: plan.season, apiRoundNumber: record.apiRoundNumber,
            canonicalRoundNumber: plan.canonicalRoundNumber, matchId: plan.matchId, units: plan.units,
          });

        if (options.observeOnly || !options.autoApply) {
          counters.voteSetsWouldAutoApply += 1;
          continue;
        }
        if (projectedVotes === null) {
          // Unreachable: observeOnly === false here (the branch above already
          // returned for observeOnly), so projectedVotes was always assigned
          // from the awaited call. Stated defensively rather than asserted
          // away with `as ReadonlyMap<...>`, matching this module's own style.
          throw new Error(
            `AFL API Brownlow vote set for match '${record.providerMatchId}' reached the apply `
            + 'step with no typed projection — this indicates a control-flow defect, not a data issue.',
          );
        }

        const inProgressSeasonsForApply = options.completedSeasonBacktestAuthority
          ? backtestInProgressSeasons(options.inProgressSeasons, plan.season)
          : options.inProgressSeasons;

        const outcome = await applyAflApiBrownlowVoteSet(tx, {
          sourceId, sourceKeysById, batchId, inProgressSeasons: inProgressSeasonsForApply,
          providerMatchId: record.providerMatchId, sourceVersionSeq: head.versionSeq,
          season: plan.season, canonicalRoundNumber: plan.canonicalRoundNumber, units: plan.units,
          projectedVotes,
        });
        if (outcome.status === 'applied') {
          counters.canonicalRowsInserted += outcome.rowsInserted;
          counters.canonicalRowsUpdated += outcome.rowsUpdated;
          counters.canonicalApplicationsLogged += outcome.rowsInserted + outcome.rowsUpdated;
        } else if (outcome.status === 'no_op') {
          counters.voteSetsNoOp += 1;
        } else {
          counters.voteSetsApplyFailed += 1;
          await writeSettleDataIssue(tx, {
            entityType: BROWNLOW_VOTE_TARGET,
            entityId: null,
            issueType: SETTLE_ISSUE_TYPE,
            issueKey: settleIssueKey(SETTLE_SOURCE_KEY, BROWNLOW_MATCH_VOTES_FAMILY, record.providerMatchId, BROWNLOW_VOTE_TARGET),
            severity: 'error',
            description: `afl_api Brownlow match '${record.providerMatchId}' vote set write failed and `
              + 'was rolled back in full.',
            details: {
              owner: SETTLE_ISSUE_OWNER, source_key: SETTLE_SOURCE_KEY,
              provider_match_id: record.providerMatchId, error: outcome.reason,
            },
          }, counters);
        }
      }

      if (!options.apply) throw new DryRunRollback();
      applied = true;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      batchIdText = null;
    } else if (error instanceof AflApiBrownlowSettleHalt) {
      halt = { reason: error.reason, detail: error.detail };
      batchIdText = null;
      applied = false;
    } else {
      throw error;
    }
  }

  const reconciliation = reconcileAflApiBrownlowSeason(options.matchVotes, options.leaderboard, options.leaderboardStatus);
  counters.leaderboardPlayersCompared = reconciliation.compared;
  counters.leaderboardMismatches = reconciliation.mismatches.length;

  return { applied, batchId: applied ? batchIdText : null, counters, reconciliation, halt };
}
