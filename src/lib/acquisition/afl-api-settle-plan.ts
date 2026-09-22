/**
 * AFLDB-ISSUE-228 S6 — the READ-ONLY settle planner.
 *
 * This is the milestone this module completes: compose the already-
 * validated bundle emitter (S3/S6-B), the settle-record envelopes (S6-C),
 * the match/player identity context (`afl-api-match-identity.ts`) and the
 * two provider-id-first resolvers (S6-D1/D2) into one coherent read path:
 *
 *   acquired AFL API bundle
 *     -> settle records (§7.2/§7.3, bundle-v2 deferral)
 *     -> match identity context (§6.1, §11.1)
 *     -> match resolution (§6.1) + player resolution (§6.3)
 *     -> a complete canonical settle PLAN: planned / deferred / refused / HALT
 *
 * It never writes canonical data, never persists an observation, never
 * touches `staging.*`, and never calls `applyCanonicalUnit()`. Every
 * function here issues `SELECT`s only. The plan it produces is deliberately
 * a PREVIEW for a later writer stage (S6's own settle CLI, not built here):
 * per-row canonical ownership for `match_period_scores` and
 * `player_match_stats` is intentionally NOT pre-computed, because Decision
 * E's ownership gates are already re-read inside the applier's own savepoint
 * at write time (`canonical-apply.ts`'s gates E1-E6) — a value read here
 * could simply be stale by the time a write happens, and duplicating that
 * re-read is not a preview, it is a second, weaker copy of the same gate.
 * What the match family's OWN ownership/corroboration classification below
 * buys, that a per-row precompute would not, is exactly what §7.5 (Q1) is
 * about: knowing WHICH canonical match (if any) this AFL API match unit
 * even is — the identity question every dependent family's write hangs off.
 *
 * §7.3 (T3) deferral stays exactly as S6-B/S6-C left it: a deferred settle
 * record contributes no plan beyond `{status: 'deferred', reason, detail}`
 * — never misclassified as a refusal or an exception.
 */
import type postgres from 'postgres';

import {
  type AflApiDeferralReason,
  type AflApiMatchBundle,
  type AflApiPlayerMatchStatsProjection,
  type AflApiSettleFamily,
  type AflApiSettleRecord,
} from './afl-api-bundle';
import {
  buildAflApiMatchIdentity,
  AflApiMatchIdentityError,
} from './afl-api-match-identity';
import {
  resolveAflApiMatch,
  type AflApiMatchIdentity,
} from './afl-api-match-resolver';
import { resolveAflApiPlayer } from './afl-api-player-resolver';
import {
  findPlausibleCanonicalFixtures,
  POSSIBLE_EXISTING_MATCH,
  type MatchRetirementEvidence,
  type PlausibleCanonicalFixture,
} from './match-rekey';
import {
  classifyCorroboration,
  evaluateTargetOwnership,
  type CorroborationReport,
  type ProviderClaim,
  type TargetOwnership,
} from './reconciliation';
import {
  areCoSources,
  findSourceFamily,
  getSourceFamily,
  type SourceFamilyRegistry,
} from './source-families';

type Sql = postgres.Sql | postgres.TransactionSql;

/** The one source key every plan in this module settles for. */
const AFL_API_SOURCE_KEY = 'afl_api';

/**
 * A genuine invariant violation — never a modelled §6/§7 outcome. Thrown,
 * never returned as a plan status: e.g. the resolver just returned a
 * `matches.id` this module's own follow-up read cannot find, which can only
 * mean a concurrent write raced this read-only pass (this module never
 * takes a lock, by design).
 */
export class AflApiSettlePlanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AflApiSettlePlanError';
  }
}

/**
 * §7.5/§13.2 precedent (`CORROBORATED_MATCH_FIELDS` in `settle-afltables.ts`),
 * narrowed to the fields an `afl_api` match proposal actually carries: it
 * never proposes `attendance` (§11.1, Q2), so that field is never a member —
 * `classifyCorroboration()` only ever compares fields present in BOTH the
 * proposed values and a claim, so omitting it here has the identical effect
 * to declaring and then never populating it, without the dead declaration.
 */
const AFL_API_CORROBORATED_MATCH_FIELDS = ['home_score', 'away_score'] as const;

// ---------------------------------------------------------------------------
// Match family
// ---------------------------------------------------------------------------

export type AflApiMatchFamilyPlan =
  | { status: 'deferred'; reason: AflApiDeferralReason; detail: string }
  | {
    status: 'halt';
    reason: 'provider_identity_contradiction';
    targetId: number;
    observed: { season: number; homeClubId: number; awayClubId: number };
    incoming: { season: number; homeClubId: number; awayClubId: number };
  }
  | {
    status: 'refused';
    reason: string;
    detail?: string;
    candidateIds?: readonly number[];
    /**
     * I244-F030 (`possible_existing_match` only): the bounded diagnostic list of
     * canonical rows that may already be this fixture, and the rendering the
     * provider would have INSERTed. Evidence for a human — never a target.
     */
    candidates?: readonly PlausibleCanonicalFixture[];
    providerMatchKey?: string;
  }
  | { status: 'planned'; mode: 'new_target'; targetId: null; matchKey: string; identity: AflApiMatchIdentity }
  | {
    status: 'planned';
    mode: 'update_owned';
    targetId: number;
    matchKey: string;
    ownerSourceKey: string | null;
    identity: AflApiMatchIdentity;
  }
  | {
    status: 'corroborated';
    targetId: number;
    matchKey: string;
    ownerSourceKey: string;
    corroboration: CorroborationReport;
    identity: AflApiMatchIdentity;
  };

type MatchOwnerRow = {
  sourceKey: string | null;
  homeScore: number;
  awayScore: number;
};

async function readMatchOwnerAndScores(sql: Sql, matchId: number): Promise<MatchOwnerRow> {
  const rows = await sql<MatchOwnerRow[]>`
    SELECT s.key AS "sourceKey",
           m.home_score AS "homeScore",
           m.away_score AS "awayScore"
      FROM matches m
      LEFT JOIN sources s ON s.id = m.source_id
     WHERE m.id = ${matchId}
  `;
  if (rows.length === 0) {
    throw new AflApiSettlePlanError(
      'match_row_missing', `matches.id = ${matchId} was not found (the resolver returned a stale id).`,
    );
  }
  return rows[0];
}

/**
 * §7.5 (Q1): a foreign-owned row that IS a declared co-source is
 * CORROBORATED, never refused and never re-owned. A foreign-owned row that
 * is NOT a declared co-source is the ordinary exception,
 * `foreign_owned_collision`. `evaluateTargetOwnership()` (`reconciliation.ts`,
 * source-neutral, unweakened) makes that first cut; this function only adds
 * the co-source classification on its `foreign_owned_collision` branch,
 * exactly as §19.1(d) requires ("the co-source classification is applied by
 * the settle core AFTER that verdict").
 */
async function classifyResolvedMatch(
  sql: Sql,
  registry: SourceFamilyRegistry,
  identity: AflApiMatchIdentity,
  bundleMatch: { homeScore: number; awayScore: number },
  targetId: number,
  currentMatchKey: string,
): Promise<AflApiMatchFamilyPlan> {
  const owner = await readMatchOwnerAndScores(sql, targetId);
  const ownership: TargetOwnership = owner.sourceKey === null
    ? { state: 'unowned' }
    : { state: 'owned', sourceKey: owner.sourceKey };
  const decision = evaluateTargetOwnership(ownership, AFL_API_SOURCE_KEY);

  if (decision.verdict === 'ok') {
    return {
      status: 'planned',
      mode: 'update_owned',
      targetId,
      matchKey: currentMatchKey,
      ownerSourceKey: owner.sourceKey,
      identity,
    };
  }

  // foreign_owned_collision — owner.sourceKey is non-null here (an unowned
  // row is always 'ok' above), so it is safe to classify against it.
  const ownerSourceKey = owner.sourceKey as string;
  if (!areCoSources(registry, ownerSourceKey, AFL_API_SOURCE_KEY)) {
    return { status: 'refused', reason: 'foreign_owned_collision', detail: ownerSourceKey };
  }

  const ownerContract = findSourceFamily(registry, ownerSourceKey, 'match');
  if (!ownerContract) {
    // A declared co-source with no 'match' family contract cannot be
    // corroborated against — fail closed rather than fabricate a claim.
    return { status: 'refused', reason: 'foreign_owned_collision', detail: `${ownerSourceKey}:no_match_contract` };
  }

  const ownContract = getSourceFamily(registry, AFL_API_SOURCE_KEY, 'match');
  const proposedValues: Record<string, number> = {};
  for (const field of AFL_API_CORROBORATED_MATCH_FIELDS) {
    proposedValues[field] = field === 'home_score' ? bundleMatch.homeScore : bundleMatch.awayScore;
  }
  const claim: ProviderClaim = {
    contract: ownerContract,
    values: { home_score: owner.homeScore, away_score: owner.awayScore },
  };
  const corroboration = classifyCorroboration(ownContract, proposedValues, [claim]);

  return {
    status: 'corroborated',
    targetId,
    matchKey: currentMatchKey,
    ownerSourceKey,
    corroboration,
    identity,
  };
}

/**
 * §6.1's full match-family classification: identity construction ->
 * resolution -> ownership/corroboration. Never called for a deferred record
 * — the caller (`planAflApiMatchUnit`) checks that first.
 */
async function planMatchFamily(
  sql: Sql,
  registry: SourceFamilyRegistry,
  sourceId: number,
  bundle: AflApiMatchBundle,
  evidence: MatchRetirementEvidence,
): Promise<AflApiMatchFamilyPlan> {
  let identity: AflApiMatchIdentity;
  try {
    identity = await buildAflApiMatchIdentity(sql, sourceId, bundle);
  } catch (err) {
    if (err instanceof AflApiMatchIdentityError) {
      return { status: 'refused', reason: err.code, detail: err.message };
    }
    throw err;
  }

  const resolution = await resolveAflApiMatch(sql, identity, evidence);

  if (resolution.outcome === 'halt') {
    return {
      status: 'halt',
      reason: resolution.reason,
      targetId: resolution.targetId,
      observed: resolution.observed,
      incoming: resolution.incoming,
    };
  }
  if (resolution.outcome === 'refused') {
    return { status: 'refused', reason: resolution.reason, candidateIds: resolution.candidateIds };
  }
  if (resolution.outcome === 'unresolved') {
    // §6.1 step 4 says only that no SUPPORTED identity resolution succeeded:
    // not by provider id, not by the exact match_key, not as a proven-retired
    // identity. It does NOT say no canonical fixture exists — a row another
    // source owns cannot be found by an afl_api provider id, and a one-component
    // round/date disagreement renders a different match_key, so both lookups miss
    // for precisely the fixture that already has a row (AFLDB-ISSUE-244 I244-F030).
    //
    // So the question that decides whether an automatic INSERT is safe is asked
    // here, once, before `new_target` is offered. Any hit refuses; the candidates
    // are diagnostics for a human and NEVER become `targetId` — no first, no
    // closest, no newest, no link, no rekey, no ownership change. The applier
    // asks the same question again inside its savepoint (`canonical-apply.ts`),
    // because this read is READ COMMITTED and binds nothing.
    const plausible = await findPlausibleCanonicalFixtures(sql, identity);
    if (plausible.length > 0) {
      return {
        status: 'refused',
        reason: POSSIBLE_EXISTING_MATCH,
        detail: `matches.id ${plausible.map((row) => row.id).join(', ')}`,
        candidateIds: plausible.map((row) => row.id),
        candidates: plausible,
        providerMatchKey: identity.matchKey,
      };
    }
    // Zero plausible fixtures: `afl_api` naturally becomes the owner of a row
    // first promoted from it (§7.5) — the writer's job, never this planner's.
    return { status: 'planned', mode: 'new_target', targetId: null, matchKey: identity.matchKey, identity };
  }

  return classifyResolvedMatch(
    sql, registry, identity,
    { homeScore: bundle.match.homeScore, awayScore: bundle.match.awayScore },
    resolution.targetId, resolution.currentMatchKey,
  );
}

// ---------------------------------------------------------------------------
// Dependent-family target resolution — shared by match_roster and
// player_match_stats, both of which need "does the match family have a
// writable target at all, and if so which id (or 'not yet created')".
// ---------------------------------------------------------------------------

type MatchTarget =
  | { blocked: true }
  | { blocked: false; targetId: number | null; identity: AflApiMatchIdentity };

function matchTargetOf(matchPlan: AflApiMatchFamilyPlan): MatchTarget {
  switch (matchPlan.status) {
    case 'deferred':
    case 'halt':
    case 'refused':
      return { blocked: true };
    case 'planned':
    case 'corroborated':
      return { blocked: false, targetId: matchPlan.targetId, identity: matchPlan.identity };
    default: {
      const exhaustive: never = matchPlan;
      throw new AflApiSettlePlanError('unreachable_match_plan_status', `Unhandled match plan: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// match_roster family (§11.2 target: match_period_scores)
// ---------------------------------------------------------------------------

export type AflApiRosterFamilyPlan =
  | { status: 'deferred'; reason: AflApiDeferralReason; detail: string }
  /** The match family itself did not resolve to a writable target (refused
   * or HALTed) — this family has nothing to attach period scores to yet. */
  | { status: 'blocked' }
  /** `targetMatchId` is `null` exactly when the match family plan is
   * `new_target` — the writer creates the match row first, in the same
   * unit, before this family can attach to it. */
  | { status: 'planned'; targetMatchId: number | null };

function planRosterFamily(
  rosterRecord: AflApiSettleRecord,
  matchPlan: AflApiMatchFamilyPlan,
): AflApiRosterFamilyPlan {
  if (rosterRecord.deferral) {
    return { status: 'deferred', reason: rosterRecord.deferral.reason, detail: rosterRecord.deferral.detail };
  }
  const target = matchTargetOf(matchPlan);
  if (target.blocked) return { status: 'blocked' };
  return { status: 'planned', targetMatchId: target.targetId };
}

// ---------------------------------------------------------------------------
// player_match_stats family (§6.3, §11.3)
// ---------------------------------------------------------------------------

export type AflApiPlayerUnitPlan =
  | { status: 'deferred'; providerPlayerId: string; reason: AflApiDeferralReason; detail: string }
  | { status: 'blocked'; providerPlayerId: string }
  | {
    status: 'refused';
    providerPlayerId: string;
    reason: 'unresolved_identity' | 'player_identity_ambiguous' | 'provider_team_id_unknown';
    candidateIds?: readonly number[];
  }
  | {
    status: 'planned';
    providerPlayerId: string;
    targetMatchId: number | null;
    playerId: number;
    clubId: number;
    jumperNumber: number | null;
  };

async function planPlayerUnit(
  sql: Sql,
  sourceId: number,
  matchPlan: AflApiMatchFamilyPlan,
  bundleMatch: { homeTeamProviderId: string; awayTeamProviderId: string },
  statRecord: AflApiSettleRecord,
): Promise<AflApiPlayerUnitPlan> {
  const stat = statRecord.projection as AflApiPlayerMatchStatsProjection | null;
  const providerPlayerId = stat?.providerPlayerId ?? statRecord.externalRecordId.split('|').at(-1) ?? statRecord.externalRecordId;

  if (statRecord.deferral) {
    return { status: 'deferred', providerPlayerId, reason: statRecord.deferral.reason, detail: statRecord.deferral.detail };
  }
  const target = matchTargetOf(matchPlan);
  if (target.blocked) {
    return { status: 'blocked', providerPlayerId };
  }
  // `stat` is non-null whenever there is no deferral (§7.3/S6-C exclusivity).
  const row = stat as AflApiPlayerMatchStatsProjection;

  const clubId = row.providerTeamId === bundleMatch.homeTeamProviderId
    ? target.identity.homeClubId
    : row.providerTeamId === bundleMatch.awayTeamProviderId
      ? target.identity.awayClubId
      : undefined;
  if (clubId === undefined) {
    return { status: 'refused', providerPlayerId: row.providerPlayerId, reason: 'provider_team_id_unknown' };
  }

  const resolution = await resolveAflApiPlayer(sql, sourceId, row.providerPlayerId);
  if (resolution.outcome === 'resolved') {
    return {
      status: 'planned',
      providerPlayerId: row.providerPlayerId,
      targetMatchId: target.targetId,
      playerId: resolution.playerId,
      clubId,
      jumperNumber: row.jumperNumber,
    };
  }
  if (resolution.outcome === 'unresolved') {
    // §6.3: unresolved is unresolved — this player unit is a refusal
    // candidate; the match unit still applies (never blocks the match).
    return { status: 'refused', providerPlayerId: row.providerPlayerId, reason: 'unresolved_identity' };
  }
  return {
    status: 'refused',
    providerPlayerId: row.providerPlayerId,
    reason: 'player_identity_ambiguous',
    candidateIds: resolution.candidateIds,
  };
}

// ---------------------------------------------------------------------------
// The full unit plan
// ---------------------------------------------------------------------------

export type AflApiMatchUnitPlan = {
  providerMatchId: string;
  match: AflApiMatchFamilyPlan;
  roster: AflApiRosterFamilyPlan;
  players: readonly AflApiPlayerUnitPlan[];
};

function familyOf(records: readonly AflApiSettleRecord[], family: AflApiSettleFamily): AflApiSettleRecord {
  const record = records.find((r) => r.family === family);
  if (!record) throw new Error(`buildAflApiSettleRecords() produced no '${family}' record — this is a caller bug.`);
  return record;
}

/**
 * The full S6 read-only plan for one AFL API match unit: bundle -> settle
 * records -> match identity/resolution -> player resolution -> plan. Takes
 * the bundle and its settle records as already built by
 * `buildAflApiMatchBundle()`/`buildAflApiSettleRecords()` (S6-B/S6-C, this
 * module never re-derives them) plus a caller-resolved `sourceId` (§6.1
 * convention, matching both resolvers) and the run's `MatchRetirementEvidence`
 * (§6.1 step 3, `match-rekey.ts`).
 *
 * Never writes. Never HALTs the caller directly — a `status: 'halt'` match
 * plan is data for the caller to act on (stop the run, write nothing), not
 * a thrown exception, so a batch caller can still decide how many other
 * units' plans to compute before stopping.
 */
export async function planAflApiMatchUnit(
  sql: Sql,
  registry: SourceFamilyRegistry,
  sourceId: number,
  bundle: AflApiMatchBundle,
  settleRecords: readonly AflApiSettleRecord[],
  evidence: MatchRetirementEvidence,
): Promise<AflApiMatchUnitPlan> {
  const matchRecord = familyOf(settleRecords, 'match');
  const rosterRecord = familyOf(settleRecords, 'match_roster');
  const statRecords = settleRecords.filter((r) => r.family === 'player_match_stats');

  const matchPlan: AflApiMatchFamilyPlan = matchRecord.deferral
    ? { status: 'deferred', reason: matchRecord.deferral.reason, detail: matchRecord.deferral.detail }
    : await planMatchFamily(sql, registry, sourceId, bundle, evidence);

  const rosterPlan = planRosterFamily(rosterRecord, matchPlan);

  const players: AflApiPlayerUnitPlan[] = [];
  for (const statRecord of statRecords) {
    players.push(await planPlayerUnit(
      sql, sourceId, matchPlan,
      { homeTeamProviderId: bundle.match.homeTeamProviderId, awayTeamProviderId: bundle.match.awayTeamProviderId },
      statRecord,
    ));
  }

  return { providerMatchId: bundle.match.sourceRecordId, match: matchPlan, roster: rosterPlan, players };
}
