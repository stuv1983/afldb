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
 *     row for the same provider id, rather than re-parsing a bundle. No row
 *     there is `unknown_match` (§10 fault scenario), never a guess.
 *
 *     AFLDB-ISSUE-244 I244-F006 — WHAT THAT ROW IS AND IS NOT. The match
 *     family's settle (`settle-afl-api.ts`) writes `staging.afl_api_match`
 *     only for a match it PLANS (an `afl_api`-owned match or a new one). A
 *     provider match that merely corroborates an existing FOREIGN-owned
 *     canonical match (e.g. `afltables`, which owns most home-and-away
 *     matches of an in-progress season) is observed on the spine and counted
 *     `corroboratedForeignOwned`, but never receives a typed row — so the
 *     table is NOT a mirror of every provider match. (Real 2026 evidence,
 *     not an invariant: 217 source match heads, 4 typed rows.) A Brownlow
 *     vote set for a corroborated match therefore has no staged identity BY
 *     DESIGN and resolves only through the opt-in canonical fixture-identity
 *     fallback (`--use-fixture-identity`). `assessAflApiBrownlowMatchIdentityCoverage()`
 *     measures exactly that population from the Brownlow records themselves,
 *     and the CLI refuses a write-capable run that would need the fallback
 *     without the flag — the fallback is never enabled implicitly.
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
import { recomputeBrownlowCoverage } from '../../db/queries/player-derived';
import {
  emptySettleCounters,
  finalizeSettleImportBatch,
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
/** AFLDB-ISSUE-244 I244-F007: `match_id` joined `played`/`votes` as a rendered,
 * proposable field once the canonical match resolver's identity started being
 * carried into the proposal (`unitInputFor()`, `proposedBrownlowMatchId()`
 * below) — `readFreshTarget()`/`writeBrownlowRoundVotes()` (`canonical-apply.ts`)
 * need no change at all: both already derive their field set from
 * `Object.keys(target.proposedValues)`, so a new proposed key is diffed,
 * gated and written by the SAME generic machinery every other field uses. */
const BROWNLOW_ROUND_VOTES_FIELDS = ['played', 'votes', 'match_id'] as const;

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
   * `player_identity_ambiguous`, and (AFLDB-ISSUE-244 I244-F007, refused at
   * apply time, before any write, AFTER the set was counted in
   * `voteSetsPlanned`) `match_identity_conflict` — by reason. */
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
  /** AFLDB-ISSUE-244 I244-F002: AFL-API-owned canonical recipients of a match's
   * PREVIOUS vote set who are absent from the corrected set, demoted to
   * `played = true, votes = 0` inside that set's own savepoint. Each demotion
   * is also one `canonicalRowsUpdated` and one `canonicalApplicationsLogged`
   * (it is an ordinary ledgered UPDATE); this counter is the only place a
   * recipient replacement is distinguishable from an ordinary tally change.
   * AFLDB-ISSUE-244 I244-F007: a CURRENT recipient's temporary release to 0
   * (the two-phase update of a vote permutation, `applyAflApiBrownlowVoteSet()`)
   * is NOT a stale demotion and never counted here — it appears only in
   * `canonicalRowsUpdated` / `canonicalApplicationsLogged`, which therefore
   * rise by 1 per released recipient. */
  staleRecipientsDemoted: number;
  /** AFLDB-ISSUE-244 I244-F007: 1 when this run's Brownlow canonical writes
   * (any `applied` vote set — an insert, a votes correction, a demotion or a
   * bare `match_id` heal) changed durable state and `recomputeBrownlowCoverage()`
   * therefore ran once, inside the SAME transaction, for `options.season`; 0
   * when every vote set was refused, a no-op or never attempted
   * (`--observe-only`, planned-only). A `--dry-run` (`apply: false`) that DID
   * reach the recompute still reports it here — `result.applied` is what
   * tells the caller whether anything, including this, was actually
   * committed (§21: dry-run rolls the WHOLE transaction back, coverage
   * recompute included). */
  coverageRecomputeRuns: number;
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
    staleRecipientsDemoted: 0,
    coverageRecomputeRuns: 0,
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
 * (the match-family settle never planned that match — either it has not run
 * yet, or the match only CORROBORATES a foreign-owned canonical match and so
 * never receives a typed row by design, AFLDB-ISSUE-244 I244-F006) is
 * retried against the fixture-only observation spine — see
 * `afl-api-fixture-identity.ts` for why that path never touches
 * `staging.afl_api_match` and can never re-own or duplicate a canonical
 * match. Omitting this parameter keeps the resolver itself byte-identical:
 * the fallback never runs unless a caller explicitly opts in by supplying
 * it. The Brownlow CLI does NOT supply it implicitly; it refuses a
 * write-capable run that needs it and lacks the operator's explicit
 * `--use-fixture-identity` (see `assessAflApiBrownlowMatchIdentityCoverage()`).
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
 * AFLDB-ISSUE-244 I244-F006 — match-identity coverage of a Brownlow
 * snapshot, and the explicit-fallback requirement it implies.
 *
 * `staging.afl_api_match` is a typed projection of the matches the match-
 * family settle PLANS (`afl_api`-owned or new). It is not a mirror of every
 * provider match: a match that only corroborates a foreign-owned canonical
 * match has no typed row by design (see the module doc comment). This
 * measures, from the Brownlow records that actually need a match, which of
 * them have a typed identity and which can only be resolved through the
 * canonical fixture-identity fallback. It deliberately does NOT compare
 * source-match and staging-row counts — that difference is expected — and it
 * reuses `resolveAflApiBrownlowMatch()` rather than re-implementing any
 * resolution. SELECT-only.
 * ------------------------------------------------------------------ */

export type AflApiBrownlowMatchIdentityCoverage = {
  /** Vote sets examined (one per `matchVotes[]` entry). */
  voteSetsChecked: number;
  /** Vote sets whose provider match id has a typed `staging.afl_api_match` row. */
  withStagedIdentity: number;
  /** Provider match ids with NO typed row that the fixture-identity fallback
   * resolves to exactly one existing canonical match — these resolve ONLY
   * with `--use-fixture-identity`. */
  fixtureIdentityRequired: readonly string[];
  /** Vote sets with no typed row that the fallback cannot resolve either
   * (no fixture observation, ambiguity, unmapped club, ...). Unchanged by the
   * flag: they stay per-set refusals in the run itself. */
  unresolvableEvenWithFixtureIdentity: number;
};

export async function assessAflApiBrownlowMatchIdentityCoverage(
  sql: ReadOnlySql,
  matchVotes: readonly AflApiBrownlowMatchVoteRecord[],
  fixtureIdentityFallback: AflApiFixtureIdentityFallback,
): Promise<AflApiBrownlowMatchIdentityCoverage> {
  const sourceId = await resolveAflApiSourceId(sql);
  let withStagedIdentity = 0;
  let unresolvable = 0;
  const fixtureIdentityRequired: string[] = [];
  for (const { providerMatchId } of matchVotes) {
    if ((await readStagedMatch(sql, sourceId, providerMatchId)) !== null) {
      withStagedIdentity += 1;
      continue;
    }
    const viaFixture = await resolveAflApiBrownlowMatch(sql, sourceId, providerMatchId, fixtureIdentityFallback);
    if (viaFixture.outcome === 'resolved') fixtureIdentityRequired.push(providerMatchId);
    else unresolvable += 1;
  }
  return {
    voteSetsChecked: matchVotes.length,
    withStagedIdentity,
    fixtureIdentityRequired,
    unresolvableEvenWithFixtureIdentity: unresolvable,
  };
}

const FIXTURE_IDENTITY_ID_SAMPLE = 10;

/**
 * The operator-facing explanation shared by the refusal and the observe-only
 * advisory. Safe facts only: counts, the exact flag, a bounded sample of
 * provider match ids (never a payload, DSN or credential). Wording is
 * deliberately not "staging is incomplete" — the absence is expected.
 */
export function describeAflApiBrownlowFixtureIdentityRequirement(
  coverage: AflApiBrownlowMatchIdentityCoverage,
): string {
  const ids = coverage.fixtureIdentityRequired;
  const sample = ids.slice(0, FIXTURE_IDENTITY_ID_SAMPLE).join(', ')
    + (ids.length > FIXTURE_IDENTITY_ID_SAMPLE ? `, ... (+${ids.length - FIXTURE_IDENTITY_ID_SAMPLE} more)` : '');
  return (
    `${ids.length} of ${coverage.voteSetsChecked} Brownlow vote set(s) have no typed staging.afl_api_match `
    + 'identity but resolve to exactly one existing canonical match through canonical fixture identity '
    + `(provider match ids: ${sample}). This is expected by design: staging.afl_api_match holds only the matches `
    + 'the AFL API settle plans (afl_api-owned or new); a match that merely corroborates an existing '
    + 'foreign-owned canonical match (for example an afltables-owned home-and-away match) has no typed row. '
    + `${coverage.withStagedIdentity} vote set(s) have a typed row; `
    + `${coverage.unresolvableEvenWithFixtureIdentity} could not be resolved by either path.`
  );
}

/**
 * Thrown by the Brownlow CLI, before any write, when a write-capable run
 * needs canonical fixture identity to resolve part of the snapshot and the
 * operator did not pass `--use-fixture-identity`. The flag is never enabled
 * implicitly: an operator must ask for the canonical-fixture fallback.
 */
export class AflApiBrownlowFixtureIdentityRequiredError extends Error {
  constructor(
    public readonly mode: 'apply' | 'dry-run',
    public readonly coverage: AflApiBrownlowMatchIdentityCoverage,
  ) {
    super(
      `Brownlow --${mode} refused before any write: ${describeAflApiBrownlowFixtureIdentityRequirement(coverage)} `
      + 'Re-run with --use-fixture-identity if canonical fixture identity is the intended fallback '
      + '(it is never enabled automatically). Nothing was written.',
    );
    this.name = 'AflApiBrownlowFixtureIdentityRequiredError';
  }
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
  /** `rowsUpdated` INCLUDES `recipientsDemoted` (each stale-recipient demotion is an ordinary
   * ledgered UPDATE) AND every temporary positive-slot release (I244-F007 two-phase update, see
   * `applyAflApiBrownlowVoteSet()`) — `recipientsDemoted` alone counts the stale recipients
   * (players no longer in the current 3/2/1 set), never a current recipient's temporary release. */
  | { status: 'applied'; rowsInserted: number; rowsUpdated: number; recipientsDemoted: number }
  | { status: 'no_op' }
  /** AFLDB-ISSUE-244 I244-F007 — the whole vote set was refused BEFORE any write: an existing
   * row this set would mutate already carries a non-null `match_id` that differs from the match
   * this provider set resolved to. Nothing was demoted, released, claimed or healed. */
  | {
    status: 'refused'; reason: typeof BROWNLOW_MATCH_IDENTITY_CONFLICT;
    resolvedMatchId: number; conflicts: readonly BrownlowMatchIdentityConflict[];
  }
  | { status: 'failed'; reason: string };

type BrownlowRoundVoteRow = { played: boolean; votes: number; match_id: number | null };

/** The `voteSetsRefused` key / data-issue reason for {@link BrownlowMatchIdentityConflict}. */
export const BROWNLOW_MATCH_IDENTITY_CONFLICT = 'match_identity_conflict' as const;

/**
 * AFLDB-ISSUE-244 I244-F007 — one existing `brownlow_round_votes` row the current provider
 * vote set would mutate, whose non-null `match_id` contradicts the canonical match the set
 * resolved to.
 *
 * `scope` mirrors I244-F002's own split: `current` is a row of a player in the current 3/2/1
 * set; `stale` is an AFL-API-owned positive row of THIS provider match whose player the
 * corrected set no longer contains and which the set would therefore demote. `aflApiOwned` is
 * `false` only for a `current` recipient whose row belongs to another source: such a row would
 * also be refused by `canonical-apply.ts`'s ownership gate, but its contradicting identity is
 * the more specific fact and it must never reach the match_id proposal.
 */
export type BrownlowMatchIdentityConflict = {
  playerId: number;
  votes: number;
  existingMatchId: number;
  resolvedMatchId: number;
  scope: 'current' | 'stale';
  aflApiOwned: boolean;
};

/** One existing row of a player this vote set is about to write (current OR stale recipient). */
export type BrownlowExistingSetRow = {
  playerId: number;
  votes: number;
  matchId: number | null;
  aflApiOwned: boolean;
};

/**
 * AFLDB-ISSUE-244 I244-F007 blocker 2 — the pure identity preflight decision. Given the existing
 * rows of every player the set would write (`applyAflApiBrownlowVoteSet()` reads them before its
 * first write) and the canonical match this provider set resolved to, returns every row whose
 * non-null `match_id` differs from `resolvedMatchId`. Empty means safe: every row is either
 * absent, `match_id IS NULL` (NULL -> resolved healing, F007's whole job) or already equal
 * (idempotent replay).
 *
 * A non-empty result refuses the ENTIRE set before any write. Correcting X -> Y is I244-F010's
 * question, never answered here.
 */
export function brownlowMatchIdentityConflicts(
  rows: readonly BrownlowExistingSetRow[],
  currentPlayerIds: ReadonlySet<number>,
  resolvedMatchId: number,
): BrownlowMatchIdentityConflict[] {
  const conflicts: BrownlowMatchIdentityConflict[] = [];
  for (const row of rows) {
    if (row.matchId === null || row.matchId === resolvedMatchId) continue;
    conflicts.push({
      playerId: row.playerId,
      votes: row.votes,
      existingMatchId: row.matchId,
      resolvedMatchId,
      scope: currentPlayerIds.has(row.playerId) ? 'current' : 'stale',
      aflApiOwned: row.aflApiOwned,
    });
  }
  return conflicts.sort((a, b) => a.playerId - b.playerId);
}

/**
 * AFLDB-ISSUE-244 I244-F007 blocker 1 — which CURRENT recipients must temporarily release their
 * positive vote slot before the final 3/2/1 is claimed.
 *
 * `ux_brownlow_round_votes_match_value` (migration 094) is `UNIQUE (match_id, votes) WHERE
 * match_id IS NOT NULL AND votes > 0`, and F007 populates `match_id` on every write. Rewriting
 * recipients one at a time can therefore collide with a row that has not been rewritten yet:
 * A3 B2 C1 -> A2 B3 C1 writing A first attempts (M, 2) while B still holds it, and NO row order
 * fixes every permutation. Every current recipient that already holds a POSITIVE value which
 * differs from its target is released to 0 first (a published zero is outside the index), so by
 * the time any final value is claimed no slot the target permutation needs is still occupied.
 *
 * A recipient with no row, an existing zero (holds no slot) or an existing value already equal to
 * its target is never released — the identical-replay case stays a no-op. Returned in ascending
 * player id so the ledger order is deterministic.
 */
export function planBrownlowPositiveSlotReleases(
  existingVotesByPlayer: ReadonlyMap<number, number>,
  targetVotesByPlayer: ReadonlyMap<number, number>,
): number[] {
  const releases: number[] = [];
  for (const [playerId, target] of targetVotesByPlayer) {
    const existing = existingVotesByPlayer.get(playerId);
    if (existing !== undefined && existing > 0 && existing !== target) releases.push(playerId);
  }
  return releases.sort((a, b) => a - b);
}

/** Thrown inside the vote set's savepoint so the (write-free) preflight refusal unwinds it structurally. */
class BrownlowMatchIdentityConflictError extends Error {
  constructor(
    public readonly resolvedMatchId: number,
    public readonly conflicts: readonly BrownlowMatchIdentityConflict[],
  ) {
    super(`${BROWNLOW_MATCH_IDENTITY_CONFLICT}: ${conflicts.length} existing row(s) carry a match_id other than ${resolvedMatchId}`);
  }
}

async function currentBrownlowRoundVote(
  sql: Tx, season: number, playerId: number, roundNumber: number,
): Promise<BrownlowRoundVoteRow | null> {
  const [row] = await sql<BrownlowRoundVoteRow[]>`
    SELECT played, votes, match_id FROM brownlow_round_votes
     WHERE season = ${season} AND player_id = ${playerId} AND round_number = ${roundNumber}
  `;
  return row ?? null;
}

/**
 * AFLDB-ISSUE-244 I244-F007 — what `match_id` to PROPOSE for one player's
 * `brownlow_round_votes` row, given the canonical match THIS run resolved
 * (`resolvedMatchId`, from `planAflApiBrownlowMatchSet()` — staged identity
 * and the `--use-fixture-identity` fallback both terminate in the same
 * `AflApiBrownlowMatchSetPlan.matchId`, so this function does not know or
 * care which one produced it) and whatever `match_id` the row already
 * carries (`currentMatchId`, or `null`/`undefined` for a brand-new row).
 *
 *   - no existing row, or an existing row with `match_id IS NULL`
 *     -> propose the resolved id. This is F007's whole job: a fresh insert
 *        carries it from the start, and a pre-F007 row (votes already
 *        written, `match_id` never populated) is healed on its next replay
 *        with no vote change required.
 *   - an existing row whose `match_id` already equals the resolved id
 *     -> propose the same id back. An ordinary idempotent no-op, exactly
 *        like proposing an unchanged `votes` value.
 *   - an existing row whose `match_id` is a DIFFERENT non-null value
 *     -> THROWS. This is an identity-bearing correction (non-null match X
 *        -> different match Y), I244-F010's territory, not F007's. It is
 *        NOT a safe proposal and there is no "pin the current id and let
 *        the other fields update" fallback: that pinned `match_id = X`
 *        while `votes` and `source_record_id` moved to a provider match
 *        that resolves to Y — a canonical row contradicting itself. The
 *        caller (`applyAflApiBrownlowVoteSet()`) must therefore have
 *        refused the WHOLE vote set (`brownlowMatchIdentityConflicts()`,
 *        `match_identity_conflict`) BEFORE any write; this throw is the
 *        structural backstop that makes reaching here a defect rather than
 *        a silent decision, and it rolls the vote set's savepoint back.
 */
export function proposedBrownlowMatchId(
  resolvedMatchId: number, currentMatchId: number | null | undefined,
): number {
  if (currentMatchId === null || currentMatchId === undefined) return resolvedMatchId;
  if (currentMatchId === resolvedMatchId) return resolvedMatchId;
  throw new Error(
    `${BROWNLOW_MATCH_IDENTITY_CONFLICT}: refusing to propose match_id ${resolvedMatchId} for a row that `
    + `already carries match_id ${currentMatchId} (X -> Y correction is I244-F010, never written by F007).`,
  );
}

/**
 * Exported for DB-free coverage (`tests/afl-api-brownlow.test.ts`) of the
 * AFLDB-ISSUE-244 I244-F007 proposal wiring: this function itself opens no
 * connection and awaits nothing, so a synthetic `currentValues` is enough to
 * prove `proposedBrownlowMatchId()`'s decision actually reaches
 * `CanonicalApplyUnitInput.targets[0].proposedValues.match_id`, the exact
 * shape `applyCanonicalUnit()` (`canonical-apply.ts`) reads.
 */
export function unitInputFor(
  sourceId: number, sourceKeysById: ReadonlyMap<number, string>, batchId: ImportBatchId,
  inProgressSeasons: readonly number[], providerMatchId: string, sourceVersionSeq: number,
  season: number, canonicalRoundNumber: number, playerId: number,
  currentValues: Readonly<BrownlowRoundVoteRow> | null,
  proposedVotes: number,
  resolvedMatchId: number,
): CanonicalApplyUnitInput {
  // AFLDB-ISSUE-228 S7 typed-projection closure: for a CURRENT recipient the
  // proposed vote value is the one just written to (and read back from)
  // staging.afl_api_brownlow_vote — see projectAflApiBrownlowVoteSet()'s doc
  // comment — never a second, independent read of unit.votes. For a stale
  // recipient (AFLDB-ISSUE-244 I244-F002) it is the literal 0: the projection
  // holds no row for a departed recipient in the current version, and its
  // `votes IN (1, 2, 3)` CHECK could not hold a 0 anyway.
  const proposedValues: Readonly<Record<string, JsonValue>> = {
    played: true,
    votes: proposedVotes,
    match_id: proposedBrownlowMatchId(resolvedMatchId, currentValues === null ? null : currentValues.match_id),
  };
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
    playerId,
    brownlowRoundNumber: canonicalRoundNumber,
    targets: [target],
  };
}

/** Input of `applyAflApiBrownlowVoteSet()`; see its doc comment for the contract. */
export type AflApiBrownlowApplyInput = {
  sourceId: number;
  sourceKeysById: ReadonlyMap<number, string>;
  batchId: ImportBatchId;
  inProgressSeasons: readonly number[];
  providerMatchId: string;
  sourceVersionSeq: number;
  season: number;
  canonicalRoundNumber: number;
  /** AFLDB-ISSUE-244 I244-F007 — the canonical match this whole provider
   * match's vote set resolved to (`AflApiBrownlowMatchSetPlan.matchId`,
   * `planAflApiBrownlowMatchSet()`). One provider match, one resolved
   * canonical match: every unit below — the three current recipients AND
   * any demoted stale recipient — proposes THIS SAME id, never a per-player
   * re-resolution. A row that already carries a DIFFERENT non-null id refuses
   * the whole set before any write (`brownlowMatchIdentityConflicts()`). */
  matchId: number;
  units: readonly AflApiBrownlowVoteUnit[];
  projectedVotes: ReadonlyMap<string, number>;
};

/**
 * One `applyCanonicalUnit()` call for one player's `brownlow_round_votes` row,
 * returning what it wrote. Anything other than `applied` or the idempotent
 * `nothing_to_write` refusal throws (caught by the caller's savepoint), so the
 * whole vote set rolls back.
 */
async function applyBrownlowRoundVote(
  scope: Tx, input: AflApiBrownlowApplyInput, playerId: number, proposedVotes: number,
): Promise<{ applied: boolean; rowsInserted: number; rowsUpdated: number }> {
  const currentValues = await currentBrownlowRoundVote(
    scope, input.season, playerId, input.canonicalRoundNumber,
  );
  const unitInput = unitInputFor(
    input.sourceId, input.sourceKeysById, input.batchId, input.inProgressSeasons,
    input.providerMatchId, input.sourceVersionSeq, input.season, input.canonicalRoundNumber,
    playerId, currentValues, proposedVotes, input.matchId,
  );
  const outcome = await applyCanonicalUnit(scope, unitInput);
  if (outcome.failure !== null) {
    throw new Error(`brownlow_round_votes write failed for player ${playerId}: ${outcome.failure.message}`);
  }
  let applied = false;
  let rowsInserted = 0;
  let rowsUpdated = 0;
  for (const result of outcome.results) {
    if (result.applied) {
      applied = true;
      rowsInserted += result.rowsInserted;
      rowsUpdated += result.rowsUpdated;
    } else if (result.refusal !== 'nothing_to_write') {
      throw new Error(`brownlow_round_votes refused for player ${playerId}: ${result.refusal}`);
    }
  }
  return { applied, rowsInserted, rowsUpdated };
}

/**
 * AFLDB-ISSUE-244 I244-F002 — the AFL-API-owned recipients of THIS provider
 * match's earlier vote set that the current set no longer contains.
 *
 * The identity boundary is PROVENANCE, all of: this season, this canonical
 * round, `source_id` = the AFL API source, `source_record_id` = this provider
 * match id, `votes > 0`, `player_id` not a current recipient. Deliberately NOT
 * season + round alone (a round holds several matches whose rows must never be
 * touched), and not club/name/fuzzy evidence. Still keyed on
 * `source_record_id`, not `brownlow_round_votes.match_id`, even after
 * AFLDB-ISSUE-244 I244-F007 started populating that column: `source_record_id`
 * is provenance identity — which provider observation wrote the row — and
 * stays correct for a row F007 has not yet healed (`match_id` still NULL) on
 * this very replay, whereas `match_id` alone could not distinguish a
 * not-yet-healed row from one that was never this provider match's at all.
 *
 * `votes > 0` is what makes the correction idempotent: a recipient already at 0
 * is never work again. Rows owned by anyone else (manual, AFL Tables, NULL
 * `source_id`) or carrying another match's `source_record_id` do not satisfy
 * the predicate and are never demoted here.
 */
async function staleAflApiBrownlowRecipients(
  scope: Tx, input: AflApiBrownlowApplyInput, currentPlayerIds: readonly number[],
): Promise<number[]> {
  const rows = await scope<{ playerId: number }[]>`
    SELECT player_id::int AS "playerId"
      FROM brownlow_round_votes
     WHERE season = ${input.season}
       AND round_number = ${input.canonicalRoundNumber}
       AND source_id = ${input.sourceId}
       AND source_record_id = ${input.providerMatchId}
       AND votes > 0
       AND NOT (player_id = ANY(${[...currentPlayerIds]}::int[]))
     ORDER BY player_id
  `;
  return rows.map((row) => row.playerId);
}

/**
 * AFLDB-ISSUE-244 I244-F007 — the existing `brownlow_round_votes` row of each given player for
 * this season and canonical round, read (never written) before the vote set's first write. The
 * caller passes exactly the players it is about to write: the current recipients and the stale
 * recipients `staleAflApiBrownlowRecipients()` returned. It is deliberately NOT a scan of the
 * round, the season or a player's other rows, so a row that belongs to another provider match
 * (which the write never touches) can neither block this set nor be read here.
 */
async function existingBrownlowSetRows(
  scope: Tx, input: AflApiBrownlowApplyInput, playerIds: readonly number[],
): Promise<BrownlowExistingSetRow[]> {
  const rows = await scope<{ playerId: number; votes: number; matchId: number | null; aflApiOwned: boolean }[]>`
    SELECT player_id::int AS "playerId", votes::int AS votes, match_id::int AS "matchId",
           COALESCE(source_id = ${input.sourceId}, false) AS "aflApiOwned"
      FROM brownlow_round_votes
     WHERE season = ${input.season}
       AND round_number = ${input.canonicalRoundNumber}
       AND player_id = ANY(${[...playerIds]}::int[])
     ORDER BY player_id
  `;
  return rows;
}

/**
 * AFLDB-ISSUE-244 I244-F002 post-condition, inside the vote set's savepoint:
 * the positive `brownlow_round_votes` rows carrying THIS provider match's
 * provenance must equal the current recipients exactly — same players, same
 * votes (so, given the emitter's {3, 2, 1} validation, three rows summing to
 * 6). A mismatch means canonical state would keep a stale AFL-API-owned
 * recipient (or lack a current one); it throws so the set rolls back and is
 * reported as `voteSetsApplyFailed` + a data issue rather than tolerated.
 */
async function assertBrownlowProviderMatchPositiveSet(
  scope: Tx, input: AflApiBrownlowApplyInput, expected: ReadonlyMap<number, number>,
): Promise<void> {
  const rows = await scope<{ playerId: number; votes: number }[]>`
    SELECT player_id::int AS "playerId", votes::int AS votes
      FROM brownlow_round_votes
     WHERE season = ${input.season}
       AND round_number = ${input.canonicalRoundNumber}
       AND source_id = ${input.sourceId}
       AND source_record_id = ${input.providerMatchId}
       AND votes > 0
     ORDER BY player_id
  `;
  const actual = new Map(rows.map((row) => [row.playerId, row.votes]));
  const matches = actual.size === expected.size
    && [...expected].every(([playerId, votes]) => actual.get(playerId) === votes);
  if (!matches) {
    const render = (m: ReadonlyMap<number, number>): string => JSON.stringify(
      [...m].sort((a, b) => a[0] - b[0]).map(([playerId, votes]) => ({ playerId, votes })),
    );
    throw new Error(
      `brownlow_round_votes post-condition failed for match ${input.providerMatchId}: the AFL API's `
      + `positive rows are ${render(actual)} but the current vote set is ${render(expected)}.`,
    );
  }
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
 *
 * AFLDB-ISSUE-244 I244-F002 — RECIPIENT REPLACEMENT. The set is the canonical
 * unit, so a provider correction that swaps a recipient (A3 B2 C1 -> A3 B2 D1)
 * must also retire C. AFLDB-ISSUE-244 I244-F007 adds the match-identity
 * preflight and the two-phase positive-slot release (below). The apply
 * therefore does, in the SAME savepoint and in this order:
 *
 *   0. resolve every current recipient's projected vote UP FRONT (a missing
 *      projection refuses the whole set before any write);
 *   1. PREFLIGHT match identity (`brownlowMatchIdentityConflicts()`, read-only):
 *      read the existing row of every player this set would write — current
 *      recipients and the stale recipients of step 2 — and refuse the ENTIRE
 *      set (`match_identity_conflict`) if any carries a non-null `match_id`
 *      other than `input.matchId`. Nothing has been written yet, so a refusal
 *      leaves no demotion, release, claim, heal or ledger row;
 *   2. demote every stale recipient (`staleAflApiBrownlowRecipients()`) to
 *      `played = true, votes = 0` through `applyCanonicalUnit()` — ownership,
 *      manual-authority, stale-baseline gates, provenance and the
 *      `canonical_applications` ledger all apply exactly as for any write;
 *   3. RELEASE (phase 1 of the two-phase update): write `votes = 0` for every
 *      CURRENT recipient whose existing positive value differs from its target
 *      (`planBrownlowPositiveSlotReleases()`);
 *   4. CLAIM (phase 2): write the current three recipients' final 3/2/1;
 *   5. prove the post-condition (`assertBrownlowProviderMatchPositiveSet()`):
 *      the AFL-API-owned positive rows of THIS provider match are exactly the
 *      current recipients with exactly the projected votes.
 *
 * WHY TWO PHASES. `ux_brownlow_round_votes_match_value` (migration 094) is
 * `UNIQUE (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0`, and
 * F007 proposes `match_id` on every write (demotions and releases included,
 * via the SAME `input.matchId` every `applyBrownlowRoundVote()` call in this
 * savepoint carries). Stale demotion first (step 2) keeps a REPLACEMENT safe
 * (were D written before C's demotion, C and D would both briefly hold
 * `(X, 1)`), but it cannot keep a PERMUTATION of the same recipients safe:
 * A3 B2 C1 -> A2 B3 C1 writing A first claims (M, 2) while B still holds it,
 * and no row order resolves every permutation (C3 A2 B1 is a 3-cycle). Step 3
 * empties every slot the target permutation needs before step 4 claims any of
 * them; a published zero is outside the partial index.
 *
 * COUNTER / LEDGER SEMANTICS. Releases are ordinary ledgered UPDATEs: each is
 * one `rowsUpdated` (so `canonicalRowsUpdated` / `canonicalApplicationsLogged`
 * report the truthful, higher two-phase count) but NEVER a `recipientsDemoted`
 * — A and B in the swap above are still current recipients, and
 * `staleRecipientsDemoted` stays specific to players who left the positive set.
 * The run-level "something changed" flag (`anyCanonicalBrownlowChange`, which
 * gates the coverage recompute) is set by the caller only from an `applied`
 * outcome, i.e. after this savepoint completed — a temporary release inside a
 * savepoint that later rolls back can never set it.
 *
 * Any refusal, failure or post-condition mismatch throws, rolling back the
 * demotions, releases AND claims together: never C = 0 with D missing, nor
 * A = 0 with B = 0 and nothing claimed. The post-condition also runs when
 * nothing was written, so a vote set left stale by a pre-F002 run heals on its
 * next replay.
 */
export async function applyAflApiBrownlowVoteSet(
  tx: Tx,
  input: AflApiBrownlowApplyInput,
): Promise<AflApiBrownlowApplyOutcome> {
  try {
    let rowsInserted = 0;
    let rowsUpdated = 0;
    let recipientsDemoted = 0;
    let anyWrite = false;
    const record = (written: { applied: boolean; rowsInserted: number; rowsUpdated: number }): boolean => {
      if (!written.applied) return false;
      rowsInserted += written.rowsInserted;
      rowsUpdated += written.rowsUpdated;
      anyWrite = true;
      return true;
    };
    await tx.savepoint(async (sp) => {
      const scope = sp as Tx;

      // 0. Every current recipient's projected vote, before anything is read or written.
      const expected = new Map<number, number>();
      for (const unit of input.units) {
        const projected = input.projectedVotes.get(unit.providerPlayerId);
        if (projected === undefined) {
          throw new Error(
            `staging.afl_api_brownlow_vote carries no projected row for player `
            + `${unit.providerPlayerId} in match ${input.providerMatchId} — refusing to apply `
            + 'brownlow_round_votes from an unprojected vote.',
          );
        }
        expected.set(unit.playerId, projected);
      }
      const currentPlayerIds = [...expected.keys()];

      const stale = await staleAflApiBrownlowRecipients(scope, input, currentPlayerIds);

      // 1. Match-identity preflight — read-only, before ANY write.
      const existing = await existingBrownlowSetRows(scope, input, [...currentPlayerIds, ...stale]);
      const conflicts = brownlowMatchIdentityConflicts(existing, new Set(currentPlayerIds), input.matchId);
      if (conflicts.length > 0) throw new BrownlowMatchIdentityConflictError(input.matchId, conflicts);

      // 2. True stale recipients (players leaving the positive set).
      for (const playerId of stale) {
        if (record(await applyBrownlowRoundVote(scope, input, playerId, 0))) recipientsDemoted += 1;
      }

      // 3. Phase 1 — release the positive slots a permutation of the CURRENT recipients needs.
      const existingVotes = new Map(existing.map((row) => [row.playerId, row.votes]));
      for (const playerId of planBrownlowPositiveSlotReleases(existingVotes, expected)) {
        record(await applyBrownlowRoundVote(scope, input, playerId, 0));
      }

      // 4. Phase 2 — claim the final 3/2/1.
      for (const unit of input.units) {
        record(await applyBrownlowRoundVote(scope, input, unit.playerId, expected.get(unit.playerId) as number));
      }

      await assertBrownlowProviderMatchPositiveSet(scope, input, expected);
    });
    return anyWrite
      ? { status: 'applied', rowsInserted, rowsUpdated, recipientsDemoted }
      : { status: 'no_op' };
  } catch (error) {
    if (error instanceof BrownlowMatchIdentityConflictError) {
      return {
        status: 'refused', reason: BROWNLOW_MATCH_IDENTITY_CONFLICT,
        resolvedMatchId: error.resolvedMatchId, conflicts: error.conflicts,
      };
    }
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

  // I244-F008: a pure comparison of the two acquired feeds, needing no
  // database. Computed BEFORE the transaction so the leaderboard counters are
  // final when the batch's `validation_result` is stamped inside it — the
  // batch must not say 0 compared while the returned counters say otherwise.
  const reconciliation = reconcileAflApiBrownlowSeason(options.matchVotes, options.leaderboard, options.leaderboardStatus);
  counters.leaderboardPlayersCompared = reconciliation.compared;
  counters.leaderboardMismatches = reconciliation.mismatches.length;

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
      // AFLDB-ISSUE-244 I244-F007 §9/§10: recompute coverage AT MOST once for
      // this run, and only if some Brownlow canonical write actually changed
      // durable state (an insert, a votes correction, a demotion or a bare
      // `match_id` heal) — never merely because a vote set was observed,
      // planned or left stale by `--observe-only`/no `--auto-apply`.
      let anyCanonicalBrownlowChange = false;

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
          season: plan.season, canonicalRoundNumber: plan.canonicalRoundNumber, matchId: plan.matchId,
          units: plan.units, projectedVotes,
        });
        if (outcome.status === 'applied') {
          counters.canonicalRowsInserted += outcome.rowsInserted;
          counters.canonicalRowsUpdated += outcome.rowsUpdated;
          counters.canonicalApplicationsLogged += outcome.rowsInserted + outcome.rowsUpdated;
          counters.staleRecipientsDemoted += outcome.recipientsDemoted;
          anyCanonicalBrownlowChange = true;
        } else if (outcome.status === 'no_op') {
          counters.voteSetsNoOp += 1;
        } else if (outcome.status === 'refused') {
          // AFLDB-ISSUE-244 I244-F007: refused BEFORE any write (an existing row this set would
          // mutate carries a non-null match_id other than the resolved one). Deliberately NOT
          // `anyCanonicalBrownlowChange` (nothing changed, so no coverage recompute is owed) and
          // NOT `voteSetsApplyFailed` (no write was attempted). One data issue per provider match,
          // keyed exactly like the other Brownlow findings so a replay refreshes it in place.
          recordRefusal(counters, outcome.reason);
          await writeSettleDataIssue(tx, {
            entityType: BROWNLOW_VOTE_TARGET,
            entityId: null,
            issueType: SETTLE_ISSUE_TYPE,
            issueKey: settleIssueKey(SETTLE_SOURCE_KEY, BROWNLOW_MATCH_VOTES_FAMILY, record.providerMatchId, BROWNLOW_VOTE_TARGET),
            severity: 'error',
            description: `afl_api Brownlow match '${record.providerMatchId}' vote set refused: ${outcome.reason} — `
              + `an existing brownlow_round_votes row already carries a different match_id than the resolved `
              + `match ${outcome.resolvedMatchId}; nothing was written (correction is I244-F010).`,
            details: {
              owner: SETTLE_ISSUE_OWNER, source_key: SETTLE_SOURCE_KEY,
              provider_match_id: record.providerMatchId, source_record_id: record.providerMatchId,
              reason: outcome.reason, resolved_match_id: outcome.resolvedMatchId,
              conflicts: outcome.conflicts.map((c) => ({
                player_id: c.playerId, votes: c.votes, existing_match_id: c.existingMatchId,
                resolved_match_id: c.resolvedMatchId, scope: c.scope, afl_api_owned: c.aflApiOwned,
              })),
            },
          }, counters);
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

      // AFLDB-ISSUE-244 I244-F007 §9/§10: part of the SAME transaction as the
      // vote/match_id writes above — a `--dry-run` (`apply: false`) throws
      // `DryRunRollback()` immediately below and rolls this back together
      // with everything else; a mid-run failure elsewhere in this callback
      // rolls it back too, `postgres.js`'s `sql.begin()` own guarantee. Uses
      // the EXISTING recompute helper (`admin-brownlow.ts` calls the same
      // function, the same way, after its own committed vote writes) — no
      // duplicated coverage logic.
      if (anyCanonicalBrownlowChange) {
        await recomputeBrownlowCoverage(tx, options.season);
        counters.coverageRecomputeRuns += 1;
      }

      // I244-F008: close the batch in THIS transaction, after every vote-set
      // write, refusal record and the coverage recompute above. An
      // observe-only run that commits its spine observations is a committed
      // batch and is closed exactly like an applying one. A dry-run finalises
      // too (real UPDATE, real privileges) and is then rolled back below; a
      // finalisation failure fails the transaction, never leaving committed
      // votes beside a `running` batch.
      await finalizeSettleImportBatch(tx, batchId, counters);

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

  return { applied, batchId: applied ? batchIdText : null, counters, reconciliation, halt };
}
