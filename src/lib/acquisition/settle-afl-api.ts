/**
 * AFLDB-ISSUE-228 S6 — the `afl_api` settle writer.
 *
 * Composes the already-built, already-validated S1-S6 pieces into the write
 * path the runbook's §16 S6 row and §7.4 name:
 *
 *   acquired snapshot (files, DB-free)
 *     -> buildAflApiMatchBundle() / buildAflApiSettleRecords()  (S3/S6-B/S6-C)
 *     -> persistSourceObservation()                              (spine, shared)
 *     -> planAflApiMatchUnit()                                   (S6-D, identity/ownership/corroboration)
 *     -> applyCanonicalUnit() / applyAttendanceEnrichment()       (shared, S5/§7.5)
 *
 * WHAT THIS MODULE DOES NOT DO, DELIBERATELY (documented, not silent):
 *
 *   - It does not use `reconcile()` for the `match` family's ownership or
 *     corroboration decision. `data/reference/source-families.json`'s own
 *     annotation on the `afl_api.match` family states that `areCoSources()`
 *     "already exempts co-source disagreement between afltables and afl_api
 *     from any veto at the reconciliation layer" — `afl-api-settle-plan.ts`
 *     IS that layer for this family (provider-id-first resolution + Q1
 *     corroboration), replacing `reconcile()`'s generic ownership gate rather
 *     than sitting behind it. `reconcile()` never imports `areCoSources`, so
 *     routing a foreign-owned-by-co-source match through it would
 *     reintroduce exactly the veto §7.5 (Q1) exists to remove.
 *   - It does not implement the AFLDB-ISSUE-131 retired-identity SEARCH scope
 *     for afl_api (`MatchRekeyScope`): every call passes
 *     `NO_MATCH_REKEY_SCOPE`, so step 3 of §6.1 ("the retired-identity
 *     search") never finds a candidate. Steps 1 (provider id) and 2
 *     (`match_key`) are unaffected; only the narrow case of an `afl_api` row
 *     whose OWN provider id was never linked and whose natural key has since
 *     been retired is out of scope for this milestone.
 *   - It never INSERTs a `matches` row for a fixture some canonical row of ANY
 *     owner may already be (AFLDB-ISSUE-244 I244-F030): an unresolved provider
 *     record whose season and oriented clubs match a canonical row that differs
 *     in at most one of round/date is refused (`possible_existing_match`) by the
 *     planner AND again inside the applier's savepoint. Nothing is linked,
 *     rekeyed or re-owned; a human decides. "Unresolved" here means no supported
 *     identity resolution succeeded, not that no canonical fixture exists.
 *   - It does not implement an absence sweep for `afl_api` records.
 *   - Promotion candidates are drafted with a direct INSERT rather than
 *     through `draftCandidate()`, which requires a full `ReconciliationOutcome`
 *     this module never constructs (see above). The row shape and the
 *     `ON CONFLICT` upsert are identical to `settle-afltables.ts`'s own
 *     candidate write.
 *   - Attendance co-source enrichment (§7.5 Q2) is triggered FROM THIS
 *     module, reading AFL Tables' own typed projection
 *     (`staging.afltables_match`) read-only, rather than from
 *     `settle-afltables.ts`, which is proven and tested by a suite this pass
 *     cannot run (CLAUDE.md §9) and is left byte-identical.
 *     `applyAttendanceEnrichment()` takes the enriching source as a
 *     parameter for exactly this reason (operator-confirmed design decision,
 *     2026-09-20).
 *
 * PLAYER UNITS AND A CORROBORATED MATCH. `planAflApiMatchUnit()`'s own
 * `matchTargetOf()` does NOT block a player unit when the match family is
 * `corroborated` (only `deferred`/`halt`/`refused` block) — a player-match
 * row is its own canonical target with its own `source_id`, gated
 * independently by `applyCanonicalUnit()`'s E3 re-read. So this writer
 * processes player units for a corroborated match too: `afl_api` may still
 * be the FIRST source to publish a given player's stats even when
 * `afltables` already owns the match row, and Q1 ("never re-owned") applies
 * to the `matches` target only.
 */
import postgres from 'postgres';

import { assessSourceCompleteness, type SourceCompletenessVerdict } from './source-completeness';
import {
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
  recomputeSeasonMetadata,
} from '../../db/queries/player-derived';

import {
  AFL_API_BUNDLE_CONTRACT_VERSION,
  buildAflApiMatchBundle,
  buildAflApiSettleRecords,
  type AflApiIdentities,
  type AflApiMatchBundle,
  type AflApiPeriodScore,
  type AflApiPlayerMatchStatsProjection,
  type AflApiSettleRecord,
} from './afl-api-bundle';
import { resolveAflApiSourceId } from './afl-api-match-identity';
import {
  planAflApiMatchUnit,
  type AflApiPlayerUnitPlan,
} from './afl-api-settle-plan';
import {
  applyAttendanceEnrichment,
  applyCanonicalUnit,
  areCoSources,
  type CanonicalApplyTargetInput,
  type CanonicalApplyUnitInput,
  type CanonicalApplyUnitResult,
} from './canonical-apply';
import { asImportBatchId, type ImportBatchId } from '../import-batch-id';
import { loadManualAuthority } from './manual-authority';
import {
  NO_MATCH_REKEY_SCOPE,
  POSSIBLE_EXISTING_MATCH,
  type PlausibleCanonicalFixture,
} from './match-rekey';
import { canonicalJson, type JsonValue } from './observations';
import { persistSourceObservation } from './observation-store';
import { baselineCanonicalHash } from './promotion-review';
import { diffFields } from './reconciliation';
import {
  automaticProposal,
  CANONICAL_APPLY_ISSUE_OWNER,
  CANONICAL_APPLY_ISSUE_TYPE,
  PLAYER_MATCH_STAT_COLUMNS,
} from './settle-afltables';
import {
  affectedPlayerIds,
  APPLY_FINDING_RESOLUTION,
  canonicalApplyIssueKey,
  clearMatchIdentityFinding,
  clearSeasonGateFinding,
  closeApplyFindingIfOpen,
  describeApplyRefusal,
  disagreementSeverity,
  emptyDerivedScope,
  emptySettleCounters,
  finalizeSettleImportBatch,
  newApplyFindingLedger,
  recordApplyOutcomeFindings,
  recordDeferral,
  recordMatchIdentityFinding,
  renderMatchKey,
  resolveApplyFinding,
  resolveRestoredDisagreements,
  settleIssueKey,
  splitMatchIdentityChange,
  writeSettleDataIssue,
  type ApplyFindingLedger,
  type ApplyFindingScope,
  type DerivedScope,
  type MatchIdentitySplit,
  type SettleCounters,
} from './settle-core';
import {
  getSourceFamily,
  type SourceFamilyRegistry,
} from './source-families';

type Tx = postgres.TransactionSql;
type Sql = postgres.Sql | Tx;

export const SETTLE_SOURCE_KEY = 'afl_api';
export const SETTLE_BATCH_TOOL = 'settle-afl-api.ts';
/** Groups this settle's own findings the same way `settle-report.ts` groups AFL Tables'. */
export const SETTLE_ISSUE_TYPE = 'afl_api_settle';
export const SETTLE_ISSUE_OWNER = 'settle-afl-api.ts';
const MATCH_IDENTITY_ISSUE_TYPE = 'afl_api_match_identity_refusal';
/** I244-F003: a resolved, `afl_api`-owned (or new) match whose provider venue
 * identity did not resolve to a `venues` row — either the `CD_V` itself is
 * unmapped, or its mapped `legacy_name` has no matching row. Distinct from
 * `MATCH_IDENTITY_ISSUE_TYPE`, which is a match-resolution refusal; this
 * finding is opened on an otherwise-resolved match and is expected to
 * self-heal (resolve) the run after the map/venues row is corrected. */
const VENUE_IDENTITY_ISSUE_TYPE = 'afl_api_venue_unmapped';

/* ------------------------------------------------------------------ *
 * Bundle assembly (DB-free) — S3/S6-B/S6-C, offline, before any connection.
 * ------------------------------------------------------------------ */

export type AflApiSettleUnitSource = {
  fixtureRaw: unknown;
  rosterRaw: unknown;
  playerStatsRaw: unknown;
};

export type AflApiBuildFailure = { providerMatchId: string | null; error: string };

export type AflApiSettleUnit = {
  bundle: AflApiMatchBundle;
  settleRecords: readonly AflApiSettleRecord[];
};

export type AflApiSettleBundle = {
  snapshotLabel: string;
  season: number;
  bundleContractVersion: number;
  units: readonly AflApiSettleUnit[];
  /** A unit whose bundle failed to build at all — a genuine contract
   * violation caught DB-free, before any connection opens. Never silently
   * dropped: counted and reported by the CLI. */
  buildFailures: readonly AflApiBuildFailure[];
};

function providerIdOf(fixtureRaw: unknown): string | null {
  if (fixtureRaw === null || typeof fixtureRaw !== 'object') return null;
  const value = (fixtureRaw as Record<string, unknown>).providerId;
  return typeof value === 'string' ? value : null;
}

/**
 * Build every match's bundle and settle records, DB-free. A single match's
 * contract violation (a bad payload, a mapping refusal) never aborts the
 * whole snapshot — it is recorded in `buildFailures` and every other match
 * still settles.
 */
export function buildAflApiSettleBundle(input: {
  season: number;
  snapshotLabel: string;
  sources: readonly AflApiSettleUnitSource[];
  registry: SourceFamilyRegistry;
  identities: AflApiIdentities;
}): AflApiSettleBundle {
  const units: AflApiSettleUnit[] = [];
  const buildFailures: AflApiBuildFailure[] = [];
  for (const source of input.sources) {
    try {
      const bundle = buildAflApiMatchBundle(
        source.fixtureRaw, source.rosterRaw, source.playerStatsRaw, input.registry, input.identities,
      );
      const settleRecords = buildAflApiSettleRecords(
        bundle, source.fixtureRaw, source.rosterRaw, source.playerStatsRaw, input.registry,
      );
      units.push({ bundle, settleRecords });
    } catch (error) {
      buildFailures.push({
        providerMatchId: providerIdOf(source.fixtureRaw),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    snapshotLabel: input.snapshotLabel,
    season: input.season,
    bundleContractVersion: AFL_API_BUNDLE_CONTRACT_VERSION,
    units,
    buildFailures,
  };
}

/* ------------------------------------------------------------------ *
 * Counters
 * ------------------------------------------------------------------ */

export type AflApiSettleCounters = SettleCounters & {
  snapshotMatches: number;
  snapshotPlayerMatchRows: number;
  buildFailures: number;
  /** I244-F003: the provider's own `CD_V` is absent from
   * `afl-api-identities.json.venues` — a stronger claim than `venueUnmapped`
   * (which means the identity map DID resolve a `legacy_name` but no
   * `venues` row carries it). Both leave `venue_id` NULL; only this counter
   * distinguishes "AFLDB has never heard of this venue" from "AFLDB knows
   * the venue but its `venues` row is missing/misspelled". */
  venueProviderUnmapped: number;
};

function emptyAflApiCounters(): AflApiSettleCounters {
  return {
    ...emptySettleCounters(), snapshotMatches: 0, snapshotPlayerMatchRows: 0, buildFailures: 0,
    venueProviderUnmapped: 0,
  };
}

/* ------------------------------------------------------------------ *
 * HALT (§14) — a run-level stop, never a per-record refusal.
 * ------------------------------------------------------------------ */

export class AflApiSettleHalt extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail: Readonly<Record<string, unknown>>,
  ) {
    super(`AFL API settle HALT: ${reason} — ${JSON.stringify(detail)}`);
    this.name = 'AflApiSettleHalt';
  }
}

class DryRunRollback extends Error {
  constructor() { super('afl_api settle dry-run: rolling back deliberately'); this.name = 'DryRunRollback'; }
}

/* ------------------------------------------------------------------ *
 * Run options / result
 * ------------------------------------------------------------------ */

export type AflApiSettleRunOptions = {
  bundle: AflApiSettleBundle;
  registry: SourceFamilyRegistry;
  /** `false` runs the full write path and rolls it back (the `--dry-run` pattern). */
  apply: boolean;
  /** ISSUE-122 S6 parity: without this, every promotable proposal is a candidate, never a canonical write. */
  autoApply: boolean;
  /** Refuse the whole transaction when the acquired source cannot be shown complete. */
  requireCompleteSource?: boolean;
  /** `data/reference/seasons.json.in_progress_seasons` — E2, re-evaluated at
   * the write exactly as `settle-afltables.ts` does; never inherited from
   * anything computed before the transaction opened. */
  inProgressSeasons: readonly number[];
  observedAt?: string;
};

export type AflApiSettleRunResult = {
  applied: boolean;
  /** The `import_batches` id, decimal text, or null when nothing committed (a HALT). */
  batchId: string | null;
  counters: AflApiSettleCounters;
  /** Non-null exactly when the run HALTed: nothing in this batch is committed. */
  halt: { reason: string; detail: Readonly<Record<string, unknown>> } | null;
  /** Why the transaction deliberately rolled back, distinct from a HALT. */
  rollbackReason: 'dry_run' | 'require_complete_source' | null;
  /** The verdict evaluated inside the transaction when completeness was required. */
  sourceCompleteness: SourceCompletenessVerdict | null;
};

/* ------------------------------------------------------------------ *
 * Reference data loaded once per run
 * ------------------------------------------------------------------ */

type AflApiRefs = {
  sourceId: number;
  afltablesSourceId: number | null;
  sourceKeysById: ReadonlyMap<number, string>;
  /** I244-F009: per-run state for automatic-apply refusal findings. Holds no
   * database state until the first automatic-apply healing check reads it. */
  applyFindings: ApplyFindingLedger;
};

async function loadRefs(tx: Tx): Promise<AflApiRefs> {
  const sources = await tx<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
  const sourceId = await resolveAflApiSourceId(tx);
  const afltables = sources.find((row) => row.key === 'afltables');
  return {
    sourceId,
    afltablesSourceId: afltables?.id ?? null,
    sourceKeysById: new Map(sources.map((row) => [row.id, row.key])),
    applyFindings: newApplyFindingLedger(),
  };
}

/**
 * I244-F009: the ownership scope of every automatic-apply finding this settle
 * writes and may close — the same `canonical_apply_failed` type and owner stamp
 * the failure finding and AFL Tables' rekey refusals use, narrowed to this
 * source by `source_key`, so this writer can never close AFL Tables' findings.
 */
const APPLY_FINDING_SCOPE: ApplyFindingScope = {
  issueType: CANONICAL_APPLY_ISSUE_TYPE,
  issueOwner: CANONICAL_APPLY_ISSUE_OWNER,
  sourceKey: SETTLE_SOURCE_KEY,
};

/**
 * I244-F009 self-heal for a target the automatic path did not even offer to the
 * applier because it no longer differs from canonical state (the source and the
 * canonical row now agree, or a human corrected the row). The earlier refusal is
 * moot; it is closed rather than left falsely open.
 */
async function closeMootApplyFinding(
  tx: Tx, refs: AflApiRefs, family: string, externalRecordId: string, targetTable: string,
  counters: AflApiSettleCounters,
): Promise<void> {
  await closeApplyFindingIfOpen(
    tx, APPLY_FINDING_SCOPE, refs.applyFindings,
    canonicalApplyIssueKey(SETTLE_SOURCE_KEY, family, externalRecordId, targetTable),
    APPLY_FINDING_RESOLUTION.notNeeded, counters,
  );
}

/** The same double-encoding hazard `canonical-apply.ts` documents: bind
 * through `sql.json()` over `canonicalJson()`'s parsed output. */
function jsonbOf(sp: Sql, value: JsonValue): postgres.Parameter<unknown> {
  return sp.json(JSON.parse(canonicalJson(value)) as never);
}

/* ------------------------------------------------------------------ *
 * Promotion candidates — a direct INSERT (see the module doc comment for
 * why `draftCandidate()` is not used here).
 * ------------------------------------------------------------------ */

const CANDIDATE_TARGETS = new Set(['matches', 'match_period_scores', 'player_match_stats']);
type CandidateVerbLike = 'new' | 'corrected' | 'unresolved_identity' | 'foreign_owned_collision';

async function writePromotionCandidate(
  tx: Tx,
  input: {
    sourceId: number;
    family: string;
    independenceGroup: string;
    externalRecordId: string;
    sourceVersionSeq: number;
    verb: CandidateVerbLike;
    season: number;
    targetTable: string;
    targetId: number | null;
    targetKey: Readonly<Record<string, unknown>>;
    fields: readonly string[];
    proposedValues: Readonly<Record<string, JsonValue>>;
    currentValues: Readonly<Record<string, JsonValue>> | null;
    agreeingGroups: readonly string[];
    disagreeingGroups: readonly string[];
    batchId: ImportBatchId;
  },
  counters: AflApiSettleCounters,
): Promise<void> {
  if (!CANDIDATE_TARGETS.has(input.targetTable)) {
    throw new Error(`'${input.targetTable}' is not a target this settle can draft a candidate for.`);
  }
  const isNew = input.verb === 'new';
  const targetId = isNew ? null : input.targetId;
  const baselineCanonicalHashValue = targetId === null || input.fields.length === 0
    ? null
    : baselineCanonicalHash(input.fields, input.currentValues ?? {});

  const [written] = await tx<{ inserted: boolean }[]>`
    INSERT INTO promotion_candidates (
      source_id, family, external_record_id, source_version_seq, verb, season,
      target_table, target_id, proposed_fields, baseline_canonical_hash,
      agreeing_groups, disagreeing_groups, created_by_batch_id
    ) VALUES (
      ${input.sourceId}, ${input.family}, ${input.externalRecordId},
      ${input.sourceVersionSeq}, ${input.verb}, ${input.season},
      ${input.targetTable}, ${targetId},
      ${jsonbOf(tx, input.proposedValues)}, ${baselineCanonicalHashValue},
      ${[...input.agreeingGroups]}::text[],
      ${[...input.disagreeingGroups]}::text[],
      ${input.batchId}
    )
    ON CONFLICT (source_id, family, external_record_id, target_table)
      WHERE status = 'pending'
      DO UPDATE SET
        source_version_seq = EXCLUDED.source_version_seq,
        verb = EXCLUDED.verb,
        target_id = EXCLUDED.target_id,
        proposed_fields = EXCLUDED.proposed_fields,
        baseline_canonical_hash = EXCLUDED.baseline_canonical_hash,
        agreeing_groups = EXCLUDED.agreeing_groups,
        disagreeing_groups = EXCLUDED.disagreeing_groups
    RETURNING (xmax = 0) AS inserted
  `;
  if (written?.inserted) counters.candidatesCreated += 1;
  else counters.candidatesRefreshed += 1;
}

/**
 * Match-identity refusals with no candidate verb (`provider_id_ambiguous`,
 * `rekey_ambiguous`, `rekey_would_merge`, `unmapped_club_hist`,
 * `unproved_match_date`, `team_identity_drift`, ...) — recorded as a
 * `data_issues` finding, matching the existing rekey-refusal precedent
 * (`writeRekeyRefusalIssue` in `settle-afltables.ts`), never forced into
 * `promotion_candidates`, whose verb CHECK does not admit them.
 */
async function writeMatchIdentityIssue(
  tx: Tx,
  input: {
    externalRecordId: string; reason: string; detail?: string;
    /** I244-F030 (`possible_existing_match`): the bounded candidate list and the rendering the provider would INSERT. */
    candidates?: readonly PlausibleCanonicalFixture[]; providerMatchKey?: string;
  },
  counters: AflApiSettleCounters,
): Promise<void> {
  const possibleExisting = input.reason === POSSIBLE_EXISTING_MATCH;
  await writeSettleDataIssue(tx, {
    entityType: 'matches',
    entityId: null,
    issueType: MATCH_IDENTITY_ISSUE_TYPE,
    issueKey: settleIssueKey(SETTLE_SOURCE_KEY, 'match', input.externalRecordId, 'matches'),
    severity: 'error',
    description: possibleExisting
      ? `afl_api match '${input.externalRecordId}' was not inserted: ${input.reason} — `
        + `${describeApplyRefusal(input.reason).explanation}. Nothing canonical was written.`
      : `afl_api match '${input.externalRecordId}' could not be resolved: ${input.reason}.`,
    details: {
      owner: SETTLE_ISSUE_OWNER,
      source_key: SETTLE_SOURCE_KEY,
      external_record_id: input.externalRecordId,
      reason: input.reason,
      detail: input.detail ?? null,
      // Additive and F030-only, so every other reason's finding keeps its shape. Bounded: at most
      // `PLAUSIBLE_FIXTURE_LIMIT` (id, match_key, source_id) triples — no payload, no proposed values.
      ...(possibleExisting
        ? {
          provider_match_key: input.providerMatchKey ?? null,
          candidates: (input.candidates ?? []).map((row) => ({
            match_id: row.id, match_key: row.matchKey, source_id: row.sourceId,
          })),
          issue: 'AFLDB-ISSUE-244 I244-F030',
        }
        : {}),
    },
  }, counters);
}

/**
 * I244-F030 self-heal for `afl_api_match_identity_refusal`, which had no
 * resolved-path healing at all.
 *
 * Called once a provider match record has produced a plan that is neither
 * deferred, HALTed nor refused — i.e. it now RESOLVES normally (an update of an
 * afl_api-owned row, a corroborated foreign-owned row, or a genuinely new
 * fixture with no plausible existing row). Any earlier match-identity finding
 * for that same record is then stale, and is closed as `match_identity_resolved`.
 *
 * SCOPE, stated because it is wider than `possible_existing_match` alone: the
 * finding key is `(afl_api, 'match', <provider match id>, 'matches')` under the
 * one issue type, so this also closes an open `unmapped_club_hist`,
 * `unproved_match_date`, `provider_id_ambiguous` or `rekey_*` refusal for the
 * same record. That is correct rather than incidental: every one of those
 * refusals is raised BEFORE a plan exists, so a current plan proves the
 * identity builder and the resolver both succeeded now. A player-level
 * refusal (`writeMatchIdentityIssue` for a player unit) is keyed on the
 * player's composite record id and is never touched here.
 *
 * Safety is `resolveApplyFinding()`'s own: only an UNRESOLVED row carrying this
 * writer's `owner` stamp is updated, so a finding a super admin already resolved
 * is never rewritten and another writer's finding is never closed. Same
 * transaction as the run (a dry-run or a HALT rolls the heal back with it).
 */
async function healMatchIdentityRefusal(
  tx: Tx, externalRecordId: string, counters: AflApiSettleCounters,
): Promise<void> {
  counters.dataIssuesResolved += await resolveApplyFinding(
    tx, MATCH_IDENTITY_ISSUE_TYPE, SETTLE_ISSUE_OWNER,
    settleIssueKey(SETTLE_SOURCE_KEY, 'match', externalRecordId, 'matches'),
    APPLY_FINDING_RESOLUTION.identityResolved,
  );
}

/**
 * I244-F003: opened whenever a `planned` match's provider venue identity did
 * not resolve — `CD_V` absent from `afl-api-identities.json.venues`
 * ('provider_unmapped'), or its mapped `legacy_name` matched no `venues` row
 * ('legacy_name_unresolved'). `entityId` is null for a `new_target` match
 * (the row does not exist yet) and the canonical id for `update_owned`.
 * Callers resolve this finding (via `resolveRestoredDisagreements`) the run
 * a mapping/venues fix makes the identity resolve again — see §10/§11.4 of
 * I244-F003: a corrected map must self-heal an existing afl_api-owned match.
 */
async function writeVenueIdentityIssue(
  tx: Tx,
  input: {
    externalRecordId: string;
    targetId: number | null;
    venueProviderId: string;
    venueRaw: string;
    venueLegacyName: string | null;
    reason: 'provider_unmapped' | 'legacy_name_unresolved';
  },
  counters: AflApiSettleCounters,
): Promise<void> {
  await writeSettleDataIssue(tx, {
    entityType: 'matches',
    entityId: input.targetId,
    issueType: VENUE_IDENTITY_ISSUE_TYPE,
    issueKey: settleIssueKey(SETTLE_SOURCE_KEY, 'match', input.externalRecordId, 'venue_id'),
    severity: 'warning',
    description: input.reason === 'provider_unmapped'
      ? `afl_api match '${input.externalRecordId}' venue '${input.venueRaw}' (provider `
        + `${input.venueProviderId}) is not in afl-api-identities.json.venues.`
      : `afl_api match '${input.externalRecordId}' venue '${input.venueRaw}' (provider `
        + `${input.venueProviderId}, legacy_name '${input.venueLegacyName}') does not resolve to `
        + 'a canonical venues row.',
    details: {
      owner: SETTLE_ISSUE_OWNER,
      source_key: SETTLE_SOURCE_KEY,
      family: 'match',
      external_record_id: input.externalRecordId,
      target_table: 'matches',
      venue_provider_id: input.venueProviderId,
      venue_raw: input.venueRaw,
      venue_legacy_name: input.venueLegacyName,
      reason: input.reason,
    },
  }, counters);
}

async function writeImportRejection(
  tx: Tx, batchId: ImportBatchId, externalRecordId: string, reason: string, payload: unknown,
): Promise<void> {
  await tx`
    INSERT INTO import_rejections (import_batch_id, source_record_id, reason, payload)
    VALUES (${batchId}, ${externalRecordId}, ${reason}, ${tx.json((payload ?? {}) as never)})
  `;
}

/* ------------------------------------------------------------------ *
 * Cumulative period-score conversion (§7.2/§11.2/§16 S6 row).
 *
 * `AflApiPeriodScore.goals`/`.behinds`/`.totalScore` are the RAW per-period
 * deltas the roster emitter's `toCumulative()` deliberately preserves
 * (`afl-api-bundle.ts`); only `.cumulativeTotalScore` is derived there. The
 * canonical `match_period_scores` grain is cumulative-to-date goals, behinds
 * AND points (matching AFL Tables' own convention), so the running sum is
 * computed HERE, at settle time — exactly what migration 103's header names
 * as this stage's job. Each period's derived total is cross-checked against
 * the roster's own `cumulativeTotalScore` and refuses (fails closed) on a
 * mismatch rather than writing an inconsistent row.
 * ------------------------------------------------------------------ */
export type CumulativePeriod = { period: number; goals: number; behinds: number; points: number };

export function cumulativePeriodsOf(periods: readonly AflApiPeriodScore[]): CumulativePeriod[] {
  const sorted = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);
  let goals = 0;
  let behinds = 0;
  return sorted.map((p) => {
    goals += p.goals;
    behinds += p.behinds;
    const points = goals * 6 + behinds;
    if (points !== p.cumulativeTotalScore) {
      throw new Error(
        `afl_api period ${p.periodNumber}: derived cumulative points ${points} != the roster's own `
        + `cumulativeTotalScore ${p.cumulativeTotalScore}. Refusing rather than writing an `
        + 'inconsistent period-score row.',
      );
    }
    return { period: p.periodNumber, goals, behinds, points };
  });
}

/* ------------------------------------------------------------------ *
 * staging.afl_api_match / staging.afl_api_player_match — typed projections
 * (migration 103). Read-audit surfaces only; the canonical writer below
 * never reads them back — every proposed value comes from the DB-free
 * bundle, exactly as `readFreshTarget()` in canonical-apply.ts re-reads
 * canonical state itself rather than trusting a projection table.
 *
 * AFLDB-ISSUE-244 I244-F006 — CONTRACT: `staging.afl_api_match` is written
 * ONLY for a match this settle PLANS (`plan.match.status === 'planned'`:
 * an `afl_api`-owned match or a new one). A match that only corroborates an
 * existing foreign-owned canonical match (`corroborated`, e.g. an
 * `afltables`-owned home-and-away match) is observed on the spine and
 * counted `corroboratedForeignOwned` but gets NO typed row, so the table is
 * NOT one row per provider match (real 2026 evidence, not an invariant:
 * 217 source match heads, 4 typed rows). Consumers that need identity for a
 * corroborated match — Brownlow — use the canonical fixture-identity path
 * (`--use-fixture-identity`), never this table.
 * ------------------------------------------------------------------ */

async function projectAflApiMatch(
  tx: Tx, refs: AflApiRefs, unit: AflApiSettleUnit, versionSeq: number, batchId: ImportBatchId,
  identity: { venueId: number | null; homeClubId: number; awayClubId: number },
): Promise<void> {
  const { match, roster } = unit.bundle;
  const cumulative = roster.periodScores
    ? { home: cumulativePeriodsOf(roster.periodScores.home), away: cumulativePeriodsOf(roster.periodScores.away) }
    : null;
  const periodCol = (side: 'home' | 'away', period: number, field: 'goals' | 'behinds' | 'points'): number | null => {
    const row = cumulative?.[side].find((p) => p.period === period);
    return row ? row[field] : null;
  };
  const winnerClubId = match.result === 'draw' ? null : (match.result === 'home_win' ? identity.homeClubId : identity.awayClubId);

  await tx`
    INSERT INTO staging.afl_api_match (
      source_id, family, external_record_id, version_seq,
      provider_match_id, provider_season_id, provider_status,
      provider_home_team_id, provider_away_team_id, provider_venue_id,
      season, round_code, round_number, round_type, is_final,
      match_date, match_time, venue_id, venue_raw,
      home_club_id, away_club_id,
      home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
      result, winner_club_id, margin,
      attendance, attendance_status, attendance_source_id,
      home_q1_goals, home_q1_behinds, home_q1_points,
      home_q2_goals, home_q2_behinds, home_q2_points,
      home_q3_goals, home_q3_behinds, home_q3_points,
      home_q4_goals, home_q4_behinds, home_q4_points,
      away_q1_goals, away_q1_behinds, away_q1_points,
      away_q2_goals, away_q2_behinds, away_q2_points,
      away_q3_goals, away_q3_behinds, away_q3_points,
      away_q4_goals, away_q4_behinds, away_q4_points,
      projected_by_batch_id
    ) VALUES (
      ${refs.sourceId}, 'match', ${match.sourceRecordId}, ${versionSeq},
      ${match.sourceRecordId}, ${roster.competitionId}, ${match.status},
      ${match.homeTeamProviderId}, ${match.awayTeamProviderId}, ${match.venueProviderId},
      ${match.season}, ${match.roundCode}, ${match.roundNumber}, ${match.roundType}, ${match.isFinal},
      ${unit.bundle.localMatchDateTime?.matchDate ?? null}, ${unit.bundle.localMatchDateTime?.matchTime ?? null},
      ${identity.venueId}, ${match.venueRaw},
      ${identity.homeClubId}, ${identity.awayClubId},
      ${match.homeGoals}, ${match.homeBehinds}, ${match.homeScore},
      ${match.awayGoals}, ${match.awayBehinds}, ${match.awayScore},
      ${match.result}, ${winnerClubId}, ${match.margin},
      ${null}, ${'not_collected'}, ${null},
      ${periodCol('home', 1, 'goals')}, ${periodCol('home', 1, 'behinds')}, ${periodCol('home', 1, 'points')},
      ${periodCol('home', 2, 'goals')}, ${periodCol('home', 2, 'behinds')}, ${periodCol('home', 2, 'points')},
      ${periodCol('home', 3, 'goals')}, ${periodCol('home', 3, 'behinds')}, ${periodCol('home', 3, 'points')},
      ${periodCol('home', 4, 'goals')}, ${periodCol('home', 4, 'behinds')}, ${periodCol('home', 4, 'points')},
      ${periodCol('away', 1, 'goals')}, ${periodCol('away', 1, 'behinds')}, ${periodCol('away', 1, 'points')},
      ${periodCol('away', 2, 'goals')}, ${periodCol('away', 2, 'behinds')}, ${periodCol('away', 2, 'points')},
      ${periodCol('away', 3, 'goals')}, ${periodCol('away', 3, 'behinds')}, ${periodCol('away', 3, 'points')},
      ${periodCol('away', 4, 'goals')}, ${periodCol('away', 4, 'behinds')}, ${periodCol('away', 4, 'points')},
      ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET
      version_seq = EXCLUDED.version_seq,
      provider_season_id = EXCLUDED.provider_season_id, provider_status = EXCLUDED.provider_status,
      provider_home_team_id = EXCLUDED.provider_home_team_id, provider_away_team_id = EXCLUDED.provider_away_team_id,
      provider_venue_id = EXCLUDED.provider_venue_id,
      season = EXCLUDED.season, round_code = EXCLUDED.round_code, round_number = EXCLUDED.round_number,
      round_type = EXCLUDED.round_type, is_final = EXCLUDED.is_final,
      match_date = EXCLUDED.match_date, match_time = EXCLUDED.match_time,
      venue_id = EXCLUDED.venue_id, venue_raw = EXCLUDED.venue_raw,
      home_club_id = EXCLUDED.home_club_id, away_club_id = EXCLUDED.away_club_id,
      home_goals = EXCLUDED.home_goals, home_behinds = EXCLUDED.home_behinds, home_score = EXCLUDED.home_score,
      away_goals = EXCLUDED.away_goals, away_behinds = EXCLUDED.away_behinds, away_score = EXCLUDED.away_score,
      result = EXCLUDED.result, winner_club_id = EXCLUDED.winner_club_id, margin = EXCLUDED.margin,
      home_q1_goals = EXCLUDED.home_q1_goals, home_q1_behinds = EXCLUDED.home_q1_behinds, home_q1_points = EXCLUDED.home_q1_points,
      home_q2_goals = EXCLUDED.home_q2_goals, home_q2_behinds = EXCLUDED.home_q2_behinds, home_q2_points = EXCLUDED.home_q2_points,
      home_q3_goals = EXCLUDED.home_q3_goals, home_q3_behinds = EXCLUDED.home_q3_behinds, home_q3_points = EXCLUDED.home_q3_points,
      home_q4_goals = EXCLUDED.home_q4_goals, home_q4_behinds = EXCLUDED.home_q4_behinds, home_q4_points = EXCLUDED.home_q4_points,
      away_q1_goals = EXCLUDED.away_q1_goals, away_q1_behinds = EXCLUDED.away_q1_behinds, away_q1_points = EXCLUDED.away_q1_points,
      away_q2_goals = EXCLUDED.away_q2_goals, away_q2_behinds = EXCLUDED.away_q2_behinds, away_q2_points = EXCLUDED.away_q2_points,
      away_q3_goals = EXCLUDED.away_q3_goals, away_q3_behinds = EXCLUDED.away_q3_behinds, away_q3_points = EXCLUDED.away_q3_points,
      away_q4_goals = EXCLUDED.away_q4_goals, away_q4_behinds = EXCLUDED.away_q4_behinds, away_q4_points = EXCLUDED.away_q4_points,
      projected_by_batch_id = EXCLUDED.projected_by_batch_id,
      projected_at = now()
  `;
}

async function projectAflApiPlayerMatch(
  tx: Tx, refs: AflApiRefs, versionSeq: number, batchId: ImportBatchId,
  externalRecordId: string, season: number, matchKey: string,
  row: AflApiPlayerMatchStatsProjection, playerId: number, clubId: number,
): Promise<void> {
  await tx`
    INSERT INTO staging.afl_api_player_match (
      source_id, family, external_record_id, version_seq,
      provider_match_id, provider_team_id, provider_player_id,
      season, match_key, player_id, club_id, career_game_no, jumper_number,
      kicks, marks, handballs, disposals, goals, behinds, hitouts, tackles,
      rebounds, inside_50s, clearances, clangers, frees_for, frees_against,
      contested, uncontested, contested_marks, marks_inside_50, one_percenters,
      bounces, goal_assists, projected_by_batch_id
    ) VALUES (
      ${refs.sourceId}, 'player_match_stats', ${externalRecordId}, ${versionSeq},
      ${row.providerMatchId}, ${row.providerTeamId}, ${row.providerPlayerId},
      ${season}, ${matchKey}, ${playerId}, ${clubId}, ${null},
      ${row.jumperNumber === null ? null : String(row.jumperNumber)},
      ${row.kicks}, ${row.marks}, ${row.handballs}, ${row.disposals}, ${row.goals}, ${row.behinds}, ${row.hitouts}, ${row.tackles},
      ${row.rebounds}, ${row.inside50s}, ${row.clearances}, ${row.clangers}, ${row.freesFor}, ${row.freesAgainst},
      ${row.contested}, ${row.uncontested}, ${row.contestedMarks}, ${row.marksInside50}, ${row.onePercenters},
      ${row.bounces}, ${row.goalAssists}, ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET
      version_seq = EXCLUDED.version_seq,
      season = EXCLUDED.season, match_key = EXCLUDED.match_key,
      player_id = EXCLUDED.player_id, club_id = EXCLUDED.club_id, jumper_number = EXCLUDED.jumper_number,
      kicks = EXCLUDED.kicks, marks = EXCLUDED.marks, handballs = EXCLUDED.handballs, disposals = EXCLUDED.disposals,
      goals = EXCLUDED.goals, behinds = EXCLUDED.behinds, hitouts = EXCLUDED.hitouts, tackles = EXCLUDED.tackles,
      rebounds = EXCLUDED.rebounds, inside_50s = EXCLUDED.inside_50s, clearances = EXCLUDED.clearances,
      clangers = EXCLUDED.clangers, frees_for = EXCLUDED.frees_for, frees_against = EXCLUDED.frees_against,
      contested = EXCLUDED.contested, uncontested = EXCLUDED.uncontested, contested_marks = EXCLUDED.contested_marks,
      marks_inside_50 = EXCLUDED.marks_inside_50, one_percenters = EXCLUDED.one_percenters,
      bounces = EXCLUDED.bounces, goal_assists = EXCLUDED.goal_assists,
      projected_by_batch_id = EXCLUDED.projected_by_batch_id, projected_at = now()
  `;
}

/* ------------------------------------------------------------------ *
 * The `matches` (+ `match_period_scores`) proposal.
 *
 * §11.1/§19.2(f): afl_api NEVER proposes attendance. On an UPDATE the three
 * attendance fields are OMITTED from `proposedValues` entirely, so
 * `diffFields()` can never see them and an ordinary correction can never
 * claw back an AFL-Tables enrichment. On an INSERT they are INCLUDED, fixed
 * at `NULL / not_collected / NULL`, because `matches.attendance_status` is
 * `NOT NULL` with no default and the row must satisfy it from its first
 * write.
 * ------------------------------------------------------------------ */
function proposedAflApiMatchValues(
  bundle: AflApiMatchBundle, identity: { venueId: number | null; homeClubId: number; awayClubId: number },
  isInsert: boolean,
): Record<string, JsonValue> {
  const { match } = bundle;
  const winnerClubId = match.result === 'draw' ? null : (match.result === 'home_win' ? identity.homeClubId : identity.awayClubId);
  const values: Record<string, JsonValue> = {
    round_code: match.roundCode,
    round_number: match.roundNumber,
    round_type: match.roundType,
    is_final: match.isFinal,
    match_date: bundle.localMatchDateTime?.matchDate ?? null,
    match_time: bundle.localMatchDateTime?.matchTime ?? null,
    venue_id: identity.venueId,
    venue_raw: match.venueRaw,
    home_club_id: identity.homeClubId,
    away_club_id: identity.awayClubId,
    home_goals: match.homeGoals,
    home_behinds: match.homeBehinds,
    home_score: match.homeScore,
    away_goals: match.awayGoals,
    away_behinds: match.awayBehinds,
    away_score: match.awayScore,
    result: match.result,
    winner_club_id: winnerClubId,
    margin: match.margin,
  };
  if (isInsert) {
    values.attendance = null;
    values.attendance_status = 'not_collected';
    values.attendance_source_id = null;
  }
  return values;
}

/**
 * `PLAYER_MATCH_STAT_COLUMNS` (imported from `settle-afltables.ts`) names the
 * canonical `player_match_stats` columns in snake_case; `emitAflApiPlayerMatchStats()`'s
 * projection carries the SAME facts under different, camelCase property
 * names (§11.3's field-mapping table). An explicit map, not a same-name
 * lookup: `row['frees_for']` on a `{freesFor: ...}` object is `undefined`,
 * not the value, for seven of the twenty-one statistics — this was caught
 * before it could ship every afl_api player's frees, contested marks,
 * marks-inside-50, one-percenters, goal assists and inside-50s as silent
 * NULLs.
 */
function aflApiPlayerStatValues(row: AflApiPlayerMatchStatsProjection): Record<string, JsonValue> {
  return {
    kicks: row.kicks,
    marks: row.marks,
    handballs: row.handballs,
    disposals: row.disposals,
    goals: row.goals,
    behinds: row.behinds,
    hitouts: row.hitouts,
    tackles: row.tackles,
    rebounds: row.rebounds,
    inside_50s: row.inside50s,
    clearances: row.clearances,
    clangers: row.clangers,
    frees_for: row.freesFor,
    frees_against: row.freesAgainst,
    contested: row.contested,
    uncontested: row.uncontested,
    contested_marks: row.contestedMarks,
    marks_inside_50: row.marksInside50,
    one_percenters: row.onePercenters,
    bounces: row.bounces,
    goal_assists: row.goalAssists,
  };
}

function proposedPeriodScoreValues(
  periods: { home: readonly AflApiPeriodScore[]; away: readonly AflApiPeriodScore[] } | null,
  identity: { homeClubId: number; awayClubId: number },
): Record<string, JsonValue> | null {
  if (periods === null) return null;
  const rows = [
    ...cumulativePeriodsOf(periods.home).map((p) => ({ club_id: identity.homeClubId, ...p })),
    ...cumulativePeriodsOf(periods.away).map((p) => ({ club_id: identity.awayClubId, ...p })),
  ].sort((a, b) => (a.club_id - b.club_id) || (a.period - b.period));
  if (rows.length === 0) return null;
  return { period_scores: rows as unknown as JsonValue };
}

async function currentMatchValues(tx: Tx, matchId: number, fields: readonly string[]): Promise<Record<string, JsonValue>> {
  const [row] = await tx<Record<string, JsonValue>[]>`SELECT * FROM matches WHERE id = ${matchId}`;
  const values: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = row?.[field];
    values[field] = value === undefined || value === null
      ? null
      : (value instanceof Date ? value.toISOString().slice(0, 10) : value);
  }
  return values;
}

async function currentPeriodScoreValues(tx: Tx, matchId: number): Promise<Record<string, JsonValue> | null> {
  const rows = await tx<{ club_id: number; period: number; goals: number | null; behinds: number | null; points: number | null }[]>`
    SELECT club_id, period, goals, behinds, points FROM match_period_scores
     WHERE match_id = ${matchId} ORDER BY club_id, period
  `;
  if (rows.length === 0) return null;
  return { period_scores: rows as unknown as JsonValue };
}

async function currentPlayerMatchValues(
  tx: Tx, playerId: number, matchId: number,
): Promise<{ targetId: number; values: Record<string, JsonValue> } | null> {
  const [row] = await tx<Record<string, JsonValue>[]>`
    SELECT * FROM player_match_stats WHERE player_id = ${playerId} AND match_id = ${matchId}
  `;
  if (!row) return null;
  const values: Record<string, JsonValue> = {
    club_id: row.club_id ?? null,
    career_game_no: row.career_game_no ?? null,
    jumper_number: row.jumper_number ?? null,
  };
  for (const field of PLAYER_MATCH_STAT_COLUMNS) values[field] = row[field] ?? null;
  return { targetId: row.id as unknown as number, values };
}

/* ------------------------------------------------------------------ *
 * Attendance co-source enrichment sweep (§7.5 Q2). Read-only against
 * `staging.afltables_match` (AFL Tables' OWN typed projection); writes ONLY
 * through `applyAttendanceEnrichment()`, which re-checks every one of the
 * seven conditions itself, inside its own savepoint, against state re-read
 * there.
 * ------------------------------------------------------------------ */
async function sweepAttendanceEnrichment(
  tx: Tx, refs: AflApiRefs, registry: SourceFamilyRegistry, batchId: ImportBatchId,
  matchKeys: readonly string[], counters: AflApiSettleCounters,
): Promise<void> {
  if (refs.afltablesSourceId === null || matchKeys.length === 0) return;
  // `staging.afltables_match` (migration 076) carries NO `match_key` column,
  // and a canonical row's `matches.source_record_id` holds whichever ONE
  // source currently owns it (afl_api here) — never a cross-reference to
  // AFL Tables' own external id. So the correlation is rendered, not looked
  // up: `renderMatchKey()` over the staging row's OWN already-resolved
  // identity fields, exactly as step 2 of §6.1 resolves a `matches` target,
  // then filtered down to the match_keys THIS run actually owns.
  const ownedKeySet = new Set(matchKeys);
  const candidates = await tx<{
    season: number; roundCode: string; matchDate: string;
    homeClubName: string; awayClubName: string;
    attendance: number | null; versionSeq: number;
  }[]>`
    SELECT s.season, s.round_code AS "roundCode", s.match_date::text AS "matchDate",
           hc.name AS "homeClubName", ac.name AS "awayClubName",
           s.attendance, s.version_seq AS "versionSeq"
      FROM staging.afltables_match s
      JOIN clubs hc ON hc.id = s.home_club_id
      JOIN clubs ac ON ac.id = s.away_club_id
     WHERE s.family = 'match'
       AND s.attendance_status = 'complete'
  `;
  const afltablesSourceId = refs.afltablesSourceId;
  for (const candidate of candidates) {
    const matchKey = renderMatchKey(
      candidate.season, candidate.roundCode, candidate.matchDate,
      candidate.homeClubName, candidate.awayClubName,
    );
    if (!ownedKeySet.has(matchKey)) continue;
    const row = { matchKey, attendance: candidate.attendance, versionSeq: candidate.versionSeq };
    if (row.attendance === null) continue;
    const result = await applyAttendanceEnrichment(tx, {
      matchKey: row.matchKey,
      enrichingSourceId: afltablesSourceId,
      enrichingSourceKey: 'afltables',
      batchId,
      sourceVersionSeq: row.versionSeq,
      coSourceGroups: registry.coSourceGroups,
      attendance: row.attendance,
      attendanceSourceIdForZero: row.attendance === 0 ? afltablesSourceId : null,
    });
    if (result.applied) counters.attendanceEnrichmentsApplied += 1;
    // A refusal here is expected in the common case (already sourced, no
    // canonical row yet, an active override) and is not itself a finding —
    // it is exactly what `applyAttendanceEnrichment()`'s own gates are for.
  }
}

/* ------------------------------------------------------------------ *
 * One match unit
 * ------------------------------------------------------------------ */

/**
 * §9.1/known-gap-E (duplicate provider id / match_key collision blast
 * radius). `applyCanonicalUnit()` already isolates a write failure (a
 * constraint violation such as two distinct `afl_api` provider ids rendering
 * one `matches_match_key` collision) to its OWN savepoint — it rolls back to
 * that savepoint, releases it and returns `failure` non-null without
 * throwing, so the outer transaction and every other unit in this run are
 * unaffected (`canonical-apply.ts` §9.1/SC4). What was missing here is the
 * other half of that contract, already proven for AFL Tables
 * (`settle-afltables.ts`'s own `outcome.failure !== null` branch): a visible,
 * resolvable `canonical_apply_failed` finding per attempted target, so a
 * fail-closed refusal is never also a SILENT one. Same issue_type/owner as
 * AFL Tables (`canonical-apply.ts` is the shared writer; ISSUE-104's
 * dedup-index precondition is a DISTINCT issue_type from `SETTLE_ISSUE_TYPE`,
 * not a distinct one per source), a source-scoped issue_key so the two
 * sources' findings can never collide with each other or with a
 * `SETTLE_ISSUE_TYPE` row for the same record.
 *
 * I244-F009 — the other half for a REFUSAL. A target the applier declines
 * without rolling back (`foreign_source_owner`, `ownership_indeterminate`,
 * `manual_authority_*`, `stale_canonical_target`, `no_canonical_match`, ...) used
 * to leave only `canonicalApplyRefusals`, so after the run nobody could say WHICH
 * target was refused or why (the 31 DEV player-stat refusals were invisible).
 * It now opens or refreshes ONE finding per refused target under the same key and
 * type as the failure finding (`recordApplyOutcomeFindings()`, `settle-core.ts`,
 * which also states why `data_issues` rather than `promotion_candidates`), and
 * closes it the run the target applies or no longer needs applying. Same
 * transaction, no new counter, no `import_rejections` row, no canonical write.
 */
async function applyUnitOutcome(
  tx: Tx, refs: AflApiRefs, unitInput: CanonicalApplyUnitInput, outcome: CanonicalApplyUnitResult,
  counters: AflApiSettleCounters, derived: DerivedScope,
  targetIds: Readonly<Record<string, number | null>> = {},
): Promise<void> {
  for (const result of outcome.results) {
    if (result.applied) {
      counters.canonicalRowsInserted += result.rowsInserted;
      counters.canonicalRowsUpdated += result.rowsUpdated;
      counters.canonicalApplicationsLogged += 1;
    } else if (outcome.failure === null) {
      counters.canonicalApplyRefusals += 1;
    }
  }
  if (outcome.insertedMatchId !== null) derived.matchIds.add(outcome.insertedMatchId);
  if (outcome.failure === null) {
    await recordApplyOutcomeFindings(
      tx, APPLY_FINDING_SCOPE, refs.applyFindings, unitInput, outcome.results, targetIds, counters,
    );
    return;
  }
  counters.canonicalApplyFailures += 1;
  for (const target of unitInput.targets) {
    await writeSettleDataIssue(tx, {
      entityType: target.targetTable,
      entityId: null,
      issueType: CANONICAL_APPLY_ISSUE_TYPE,
      issueKey: canonicalApplyIssueKey(
        SETTLE_SOURCE_KEY, unitInput.family, unitInput.externalRecordId, target.targetTable,
      ),
      severity: 'error',
      description: `The automatic canonical application of ${target.targetTable} `
        + `'${unitInput.externalRecordId}' failed and was rolled back.`,
      details: {
        owner: CANONICAL_APPLY_ISSUE_OWNER,
        source_key: SETTLE_SOURCE_KEY,
        family: unitInput.family,
        external_record_id: unitInput.externalRecordId,
        target_table: target.targetTable,
        failed_target_table: outcome.failure.targetTable,
        source_version_seq: target.sourceVersionSeq,
        fields: [...target.renderedFields],
        error: outcome.failure.message,
      },
    }, counters);
  }
}

async function resolveVenueId(tx: Tx, venueLegacyName: string | null): Promise<number | null> {
  if (venueLegacyName === null) return null;
  const [row] = await tx<{ id: number }[]>`SELECT id FROM venues WHERE legacy_name = ${venueLegacyName}`;
  return row?.id ?? null;
}

/**
 * I244-F010: the targets the AUTOMATIC path may hand to `applyCanonicalUnit()`.
 *
 * Every target passes through unchanged except an existing row's `matches`
 * target (`identitySplit !== null`, i.e. not an INSERT), which is rebuilt
 * without any identity-bearing field: the proposal, the rendered field list and
 * the E5 baseline hash over that list all describe only what may be written.
 * The target is dropped when nothing but identity differs (`renderedFields`
 * empty — a baseline over no fields is refused by `baselineCanonicalPreimage()`
 * anyway). `currentValues` is non-null whenever `identitySplit` is.
 */
export function automaticApplyTargets(
  targets: readonly CanonicalApplyTargetInput[],
  identitySplit: MatchIdentitySplit | null,
  currentValues: Readonly<Record<string, JsonValue>> | null,
): CanonicalApplyTargetInput[] {
  const offered: CanonicalApplyTargetInput[] = [];
  for (const target of targets) {
    if (target.targetTable !== 'matches' || identitySplit === null) {
      offered.push(target);
      continue;
    }
    if (identitySplit.renderedFields.length === 0) continue;
    offered.push({
      ...target,
      proposedValues: identitySplit.proposedValues,
      renderedFields: identitySplit.renderedFields,
      renderedBaselineCanonicalHash: baselineCanonicalHash(identitySplit.renderedFields, currentValues),
    });
  }
  return offered;
}

async function settleMatchUnit(
  tx: Tx, refs: AflApiRefs, registry: SourceFamilyRegistry, batchId: ImportBatchId,
  observedAt: string, autoApply: boolean, inProgressSeasons: readonly number[],
  unit: AflApiSettleUnit, counters: AflApiSettleCounters, derived: DerivedScope,
  ownedMatchKeys: string[],
): Promise<void> {
  const { bundle, settleRecords } = unit;
  counters.snapshotMatches += 1;

  // 1. Spine — every settle record is observed, regardless of deferral.
  //
  //    `persistSourceObservation()` reports only 'version_inserted' /
  //    'head_refreshed', never the version number itself, but
  //    `canonical_applications.source_version_seq` (and `promotion_candidates`'
  //    own copy) carries a FOREIGN KEY to `staging.source_record_versions`
  //    (see `applyAttendanceEnrichment()`'s own doc comment in
  //    canonical-apply.ts) — a wrong or stale version_seq would fail closed at
  //    the INSERT, not silently misattribute. The current version is read
  //    back once per record, right after persisting it, into `versionSeqByKey`.
  const versionSeqByKey = new Map<string, number>();
  for (const record of settleRecords) {
    const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, record.family);
    const action = await persistSourceObservation(
      tx,
      {
        contract, sourceId: refs.sourceId, externalRecordId: record.externalRecordId,
        scopeKey: record.scopeKey, payload: record.payload as JsonValue,
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
       WHERE source_id = ${refs.sourceId} AND family = ${record.family}
         AND external_record_id = ${record.externalRecordId}
    `;
    if (!head) throw new Error(`staging.source_records has no head for ${record.family} '${record.externalRecordId}' immediately after persisting it.`);
    versionSeqByKey.set(`${record.family}|${record.externalRecordId}`, head.versionSeq);
  }
  const versionSeqOf = (family: string, externalRecordId: string): number => {
    const seq = versionSeqByKey.get(`${family}|${externalRecordId}`);
    if (seq === undefined) throw new Error(`No observed version_seq for ${family} '${externalRecordId}' — it was not persisted this unit.`);
    return seq;
  };

  const matchRecord = settleRecords.find((r) => r.family === 'match');
  const rosterRecord = settleRecords.find((r) => r.family === 'match_roster');
  const statRecords = settleRecords.filter((r) => r.family === 'player_match_stats');
  if (!matchRecord || !rosterRecord) {
    throw new Error(`afl_api unit ${bundle.match.sourceRecordId} carries no match/match_roster settle record.`);
  }
  counters.snapshotPlayerMatchRows += statRecords.length;

  // 2. §7.3 (T3) deferral.
  if (matchRecord.deferral) {
    recordDeferral(counters, matchRecord.deferral.reason);
    return;
  }
  if (rosterRecord.deferral) recordDeferral(counters, rosterRecord.deferral.reason);

  // 3. Plan — identity, ownership, corroboration (S6-D, afl-api-settle-plan.ts).
  const plan = await planAflApiMatchUnit(
    tx, registry, refs.sourceId, bundle, settleRecords,
    { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE },
  );

  if (plan.match.status === 'halt') {
    throw new AflApiSettleHalt(plan.match.reason, {
      targetId: plan.match.targetId, observed: plan.match.observed, incoming: plan.match.incoming,
      providerMatchId: bundle.match.sourceRecordId,
    });
  }

  // `planAflApiMatchUnit()`'s return type still admits `status: 'deferred'`
  // for `plan.match` — the function has no way to know THIS caller already
  // proved `matchRecord.deferral` false above (step 2). TypeScript cannot be
  // told that by a comment: without this explicit branch, `plan.match` stays
  // a 5-way union all the way to the `planned`/`corroborated` split below,
  // and `.mode`/`.identity`/`.targetId`/`.matchKey` are not accessible on a
  // `'deferred'` member. Reachability would itself be a genuine bug in the
  // step-2 precondition, so this is treated exactly like the top-of-function
  // deferral: informational, no canonical write, never an exception.
  if (plan.match.status === 'deferred') {
    recordDeferral(counters, plan.match.reason);
    return;
  }

  if (plan.match.status === 'refused') {
    if (plan.match.reason === 'foreign_owned_collision' || plan.match.reason === 'unresolved_identity') {
      const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, 'match');
      await writePromotionCandidate(tx, {
        sourceId: refs.sourceId, family: 'match',
        independenceGroup: contract.independence?.group ?? SETTLE_SOURCE_KEY,
        externalRecordId: bundle.match.sourceRecordId,
        sourceVersionSeq: versionSeqOf('match', bundle.match.sourceRecordId),
        verb: plan.match.reason, season: bundle.match.season, targetTable: 'matches',
        targetId: null, targetKey: { external_record_id: bundle.match.sourceRecordId },
        fields: [], proposedValues: {}, currentValues: null,
        agreeingGroups: [], disagreeingGroups: [], batchId,
      }, counters);
      if (plan.match.reason === 'foreign_owned_collision') counters.foreignOwnedCollision += 1;
      else counters.unresolvedIdentityMatch += 1;
    } else {
      await writeMatchIdentityIssue(
        tx,
        {
          externalRecordId: bundle.match.sourceRecordId, reason: plan.match.reason, detail: plan.match.detail,
          // I244-F030 only; both are undefined for every other refusal reason.
          candidates: plan.match.candidates, providerMatchKey: plan.match.providerMatchKey,
        },
        counters,
      );
      counters.unresolvedIdentityMatch += 1;
    }
    // A refused match writes NOTHING canonical, projects nothing typed and returns before any
    // player unit: `matchIdForPlayers` never leaves null, so no period or player row can land
    // against a fixture this run declined to create (I244-F030 covers `possible_existing_match`).
    await writeImportRejection(
      tx, batchId, bundle.match.sourceRecordId, `matches: ${plan.match.reason}`, matchRecord.payload,
    );
    return;
  }

  // I244-F030 self-heal: the record resolves normally this run, so an earlier
  // `afl_api_match_identity_refusal` for it is stale (scope: `healMatchIdentityRefusal()`).
  await healMatchIdentityRefusal(tx, bundle.match.sourceRecordId, counters);

  let matchIdForPlayers: number | null = null;
  let matchKeyForPlayers: string | null = null;
  // I244-F001/F012: only a unit that actually wrote `matches`/
  // `match_period_scores` this run belongs in the derived-recompute scope.
  // A corroborated match (never written, §8) and a `planned` match whose
  // diff is empty (already up to date) must NOT force the season/club/player
  // recompute below to run on a pure no-op replay.
  let matchWriteApplied = false;

  if (plan.match.status === 'corroborated') {
    counters.corroboratedForeignOwned += 1;
    const issueKey = settleIssueKey(SETTLE_SOURCE_KEY, 'match', bundle.match.sourceRecordId, 'matches');
    if (plan.match.corroboration.disagreeingGroups.length > 0) {
      const [ownerRow] = await tx<{ homeScore: number; awayScore: number }[]>`
        SELECT home_score AS "homeScore", away_score AS "awayScore" FROM matches WHERE id = ${plan.match.targetId}
      `;
      await writeSettleDataIssue(tx, {
        entityType: 'matches',
        entityId: plan.match.targetId,
        issueType: SETTLE_ISSUE_TYPE,
        issueKey,
        severity: disagreementSeverity(['home_score', 'away_score']),
        description: `afl_api disagrees with ${plan.match.ownerSourceKey} on the score for match `
          + `'${bundle.match.sourceRecordId}'.`,
        details: {
          owner: SETTLE_ISSUE_OWNER,
          source_key: SETTLE_SOURCE_KEY,
          family: 'match',
          external_record_id: bundle.match.sourceRecordId,
          target_table: 'matches',
          source_version_seq: null,
          agreeing_groups: [...plan.match.corroboration.agreeingGroups],
          disagreeing_groups: [...plan.match.corroboration.disagreeingGroups],
          conflicts: [{
            field: 'scores',
            afl_api: { home_score: bundle.match.homeScore, away_score: bundle.match.awayScore },
            [plan.match.ownerSourceKey]: ownerRow
              ? { home_score: ownerRow.homeScore, away_score: ownerRow.awayScore }
              : null,
          }],
        },
      }, counters);
    } else {
      await resolveRestoredDisagreements(tx, SETTLE_ISSUE_TYPE, SETTLE_ISSUE_OWNER, new Set([issueKey]));
    }
    // I244-F030: a corroborated (foreign-owned) match is never applied, so an
    // apply-time `canonical_apply_failed` refusal an earlier run left for its
    // `matches` / `match_period_scores` targets — the `possible_existing_match`
    // one included — no longer describes anything. The F009 healers above never
    // run on this branch, so it is closed here. Automatic path only, exactly
    // like every other apply-finding healing check.
    if (autoApply) {
      await closeMootApplyFinding(tx, refs, 'match', bundle.match.sourceRecordId, 'matches', counters);
      await closeMootApplyFinding(tx, refs, 'match', bundle.match.sourceRecordId, 'match_period_scores', counters);
    }
    // §19.1(a)/(c): never (re-)owned and never written, including attendance.
    matchIdForPlayers = plan.match.targetId;
    matchKeyForPlayers = plan.match.matchKey;
  } else {
    // plan.match.status === 'planned' — new_target or update_owned (by afl_api).
    const isInsert = plan.match.mode === 'new_target';
    const venueId = await resolveVenueId(tx, bundle.match.venueLegacyName);
    // I244-F003: `venueLegacyName === null` means the provider's own `CD_V`
    // is absent from afl-api-identities.json.venues — a map miss that the
    // old `bundle.match.venueLegacyName !== null && venueId === null` guard
    // could never see, so it silently reached `proposedAflApiMatchValues()`
    // as an ordinary NULL `venue_id`. Both branches below are now counted,
    // both open a durable finding, and neither is allowed to auto-apply
    // (see `venueIdentityUnresolved` gate further down) — a provider venue
    // identity miss is never treated as an ordinary nullable field.
    const venueProviderUnmapped = bundle.match.venueLegacyName === null;
    if (venueProviderUnmapped) counters.venueProviderUnmapped += 1;
    else if (venueId === null) counters.venueUnmapped += 1;
    const venueIdentityUnresolved = venueId === null;
    if (venueIdentityUnresolved) {
      await writeVenueIdentityIssue(tx, {
        externalRecordId: bundle.match.sourceRecordId,
        targetId: plan.match.targetId,
        venueProviderId: bundle.match.venueProviderId,
        venueRaw: bundle.match.venueRaw,
        venueLegacyName: bundle.match.venueLegacyName,
        reason: venueProviderUnmapped ? 'provider_unmapped' : 'legacy_name_unresolved',
      }, counters);
    } else {
      await resolveRestoredDisagreements(
        tx, VENUE_IDENTITY_ISSUE_TYPE, SETTLE_ISSUE_OWNER,
        new Set([settleIssueKey(SETTLE_SOURCE_KEY, 'match', bundle.match.sourceRecordId, 'venue_id')]),
      );
    }
    const matchIdentity = { venueId, homeClubId: plan.match.identity.homeClubId, awayClubId: plan.match.identity.awayClubId };

    const matchProposed = proposedAflApiMatchValues(bundle, matchIdentity, isInsert);
    const matchFields = Object.keys(matchProposed);
    const currentValues = isInsert ? null : await currentMatchValues(tx, plan.match.targetId as number, matchFields);
    const matchRenderedFields = diffFields(matchProposed, currentValues);
    // I244-F010: on an UPDATE the identity-bearing fields (`MATCH_IDENTITY_FIELDS`)
    // are never offered to the applier; see `splitMatchIdentityChange()`. An
    // INSERT defines the identity and is not split.
    const identitySplit = isInsert ? null : splitMatchIdentityChange(matchProposed, matchRenderedFields);

    const targets: CanonicalApplyTargetInput[] = [];
    if (matchRenderedFields.length > 0) {
      targets.push({
        targetTable: 'matches',
        invitation: 'candidate',
        proposedValues: matchProposed,
        renderedFields: matchRenderedFields,
        renderedBaselineCanonicalHash: currentValues === null ? null : baselineCanonicalHash(matchRenderedFields, currentValues),
        sourceVersionSeq: versionSeqOf('match', bundle.match.sourceRecordId),
      });
    }

    if (plan.roster.status === 'planned') {
      const periodProposed = proposedPeriodScoreValues(bundle.roster.periodScores, matchIdentity);
      if (periodProposed !== null) {
        const currentPeriods = plan.roster.targetMatchId === null ? null : await currentPeriodScoreValues(tx, plan.roster.targetMatchId);
        const periodFields = diffFields(periodProposed, currentPeriods);
        if (periodFields.length > 0) {
          targets.push({
            targetTable: 'match_period_scores',
            invitation: plan.roster.targetMatchId === null ? 'pending_match' : 'candidate',
            proposedValues: periodProposed,
            renderedFields: periodFields,
            renderedBaselineCanonicalHash: currentPeriods === null ? null : baselineCanonicalHash(periodFields, currentPeriods),
            // The unit's `family`/`externalRecordId` (below) are fixed at
            // 'match'/the match's own provider id, so — even though this
            // target's DATA comes from the roster record — the ledger FK
            // needs the MATCH family's own version_seq, not match_roster's.
            sourceVersionSeq: versionSeqOf('match', bundle.match.sourceRecordId),
          });
        }
      }
    } else if (plan.roster.status === 'deferred') {
      recordDeferral(counters, plan.roster.reason);
    }

    // I244-F010: what the AUTOMATIC path may act on. Identical to `targets`
    // except that an existing row's `matches` target carries no identity-bearing
    // field: its proposal, its rendered field list and the E5 baseline hash over
    // that list are all rebuilt without them, and the target is dropped when
    // nothing else differs. A review-first run keeps `targets` whole — every
    // promotable proposal, identity included, is a candidate for a human.
    const applyTargets = automaticApplyTargets(targets, identitySplit, currentValues);

    // I244-F010: a differing identity is withheld and made durable; an agreeing
    // one closes the record's earlier finding. Same transaction, same lifecycle
    // as the F009 refusal findings (its own key, so neither closes the other).
    // Automatic path only: a review-first run decides nothing about findings.
    if (autoApply && identitySplit !== null) {
      if (identitySplit.changedIdentityFields.length > 0) {
        counters.canonicalApplyRefusals += 1;
        await recordMatchIdentityFinding(tx, refs.applyFindings, {
          scope: APPLY_FINDING_SCOPE,
          family: 'match',
          externalRecordId: bundle.match.sourceRecordId,
          matchId: plan.match.targetId,
          sourceVersionSeq: versionSeqOf('match', bundle.match.sourceRecordId),
          changedFields: identitySplit.changedIdentityFields,
          proposedValues: matchProposed,
          currentValues: currentValues as Record<string, JsonValue>,
          canonicalMatchKey: plan.match.matchKey,
          providerMatchKey: plan.match.identity.matchKey,
        }, counters);
      } else {
        await clearMatchIdentityFinding(
          tx, APPLY_FINDING_SCOPE, refs.applyFindings, 'match', bundle.match.sourceRecordId, counters,
        );
      }
    }

    // I244-F009 self-heal: a target this automatic run evaluated and found to
    // agree with canonical state has nothing left to apply, so an earlier
    // refusal finding for it is moot. Evaluated only for a target the run could
    // actually assess (`matches` always; the period set only when the roster
    // plan was `planned`), and only on the automatic path — a review-first run
    // decides nothing about apply findings. `matches` is judged on what the
    // automatic path may write (`applyTargets`): a difference confined to
    // identity-bearing fields is F010's finding, not an F009 refusal.
    if (autoApply) {
      if (!applyTargets.some((target) => target.targetTable === 'matches')) {
        await closeMootApplyFinding(tx, refs, 'match', bundle.match.sourceRecordId, 'matches', counters);
      }
      if (
        plan.roster.status === 'planned'
        && !targets.some((target) => target.targetTable === 'match_period_scores')
      ) {
        await closeMootApplyFinding(
          tx, refs, 'match', bundle.match.sourceRecordId, 'match_period_scores', counters,
        );
      }
    }

    matchIdForPlayers = plan.match.targetId;
    matchKeyForPlayers = plan.match.matchKey;

    // I244-F010: the automatic path acts on `applyTargets`, a review-first run
    // on the whole `targets` (see above). Nothing else in this block changed.
    const routedTargets = autoApply ? applyTargets : targets;
    const routedMatchFields = routedTargets.find((target) => target.targetTable === 'matches')?.renderedFields ?? [];

    if (routedTargets.length > 0) {
      const matchAuthority = await loadManualAuthority(tx, bundle.match.season);
      // The authority question is asked under the match_key on BOTH paths,
      // including a `new_target` INSERT.
      //
      // `manualAuthorityVerdict()` answers `'indeterminate'` — which REFUSES —
      // for a `matches` query whose targetKey carries no `match_key`
      // (`manual-authority.ts`'s `matchKeyOf()` returns null, and unreadable is
      // never read as absent). An earlier draft passed `{}` on an insert, on the
      // reasoning that a row which does not exist yet cannot carry an override;
      // the effect was that EVERY new afl_api match was refused here and routed
      // to `promotion_candidates`, so the auto-apply path could never create a
      // match at all — and, because `matchIdForPlayers` is then null, no player
      // unit of a new match could be written or even projected either.
      //
      // `data_overrides.entity_key` for `matches` IS the match_key, so asking
      // under the incoming key is both well-defined and answerable before the
      // row exists. It is also exactly the question `applyCanonicalUnit()`'s own
      // E4 gate asks inside the savepoint: `readFreshTarget()` returns
      // `targetKey = { match_key: unit.matchKey }` for a new target as well as a
      // resolved one. This pre-check is therefore aligned with E4 rather than
      // being a second, weaker copy of it; E4 remains the binding gate, re-read
      // inside the savepoint, and nothing here weakens it.
      const authorityConflict = matchAuthority({
        entity: 'matches',
        targetKey: { match_key: plan.match.matchKey },
        fields: routedMatchFields.length > 0 ? routedMatchFields : ['period_scores'],
      }) !== 'clear';

      if (autoApply && !authorityConflict && !venueIdentityUnresolved) {
        const unitInput: CanonicalApplyUnitInput = {
          family: 'match',
          externalRecordId: bundle.match.sourceRecordId,
          season: bundle.match.season,
          sourceId: refs.sourceId,
          sourceKey: SETTLE_SOURCE_KEY,
          sourceKeysById: refs.sourceKeysById,
          batchId,
          inProgressSeasons,
          completionProven: true,
          matchKey: plan.match.matchKey,
          matchRekey: null,
          // I244-F030: the planner already refused a plausible existing fixture, but that read
          // binds nothing under READ COMMITTED. A NEW-target INSERT re-asks inside the savepoint
          // (`readFreshTarget()`); an UPDATE of a resolved row has no INSERT to guard.
          matchAmbiguity: isInsert
            ? {
              identity: {
                roundCode: plan.match.identity.roundCode, matchDate: plan.match.identity.matchDate,
                homeClubId: plan.match.identity.homeClubId, awayClubId: plan.match.identity.awayClubId,
              },
            }
            : null,
          playerId: null,
          brownlowRoundNumber: null,
          targets: routedTargets,
        };
        const outcome: CanonicalApplyUnitResult = await applyCanonicalUnit(tx, unitInput);
        await applyUnitOutcome(tx, refs, unitInput, outcome, counters, derived, {
          matches: plan.match.targetId,
          match_period_scores: plan.roster.status === 'planned' ? plan.roster.targetMatchId : null,
        });
        if (outcome.insertedMatchId !== null) matchIdForPlayers = outcome.insertedMatchId;
        matchWriteApplied = outcome.results.some((result) => result.applied);
      } else {
        if (authorityConflict) counters.manualAuthorityRefusals += 1;
        const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, 'match');
        for (const target of routedTargets) {
          await writePromotionCandidate(tx, {
            sourceId: refs.sourceId, family: 'match',
            independenceGroup: contract.independence?.group ?? SETTLE_SOURCE_KEY,
            externalRecordId: bundle.match.sourceRecordId, sourceVersionSeq: target.sourceVersionSeq,
            verb: isInsert ? 'new' : 'corrected', season: bundle.match.season,
            targetTable: target.targetTable, targetId: isInsert ? null : plan.match.targetId,
            targetKey: { match_key: plan.match.matchKey }, fields: [...target.renderedFields],
            proposedValues: target.proposedValues, currentValues,
            agreeingGroups: [], disagreeingGroups: [], batchId,
          }, counters);
        }
        // Not auto-applying (or an authority conflict): the match itself is
        // NOT written this run, so a new_target's dependent player rows have
        // nothing to attach to yet.
        if (isInsert) matchIdForPlayers = null;
      }
    }

    // Typed projection (migration 103) — written for every PLANNED match
    // (this `else` branch: afl_api-owned or new), independent of whether
    // this run wrote (or even proposed) a canonical change this time. A
    // `corroborated` match takes the branch above and is deliberately NOT
    // projected (I244-F006): ownership/corroboration semantics are unchanged.
    await projectAflApiMatch(
      tx, refs, unit, versionSeqOf('match', bundle.match.sourceRecordId), batchId, matchIdentity,
    );
  }

  if (matchIdForPlayers !== null && matchKeyForPlayers !== null) ownedMatchKeys.push(matchKeyForPlayers);

  // 4. Players — each its own atomicity unit (§9.1/S6): one unresolved
  //    debutant never blocks any other player's row, and a player unit is
  //    reachable even when the match is `corroborated` (see module doc
  //    comment): a player-match row is owned independently of its match.
  for (const playerPlan of plan.players) {
    await settlePlayerUnit(
      tx, refs, registry, batchId, bundle, playerPlan, matchIdForPlayers, matchKeyForPlayers,
      autoApply, inProgressSeasons, counters, derived, versionSeqOf,
    );
  }

  if (matchWriteApplied && matchIdForPlayers !== null) derived.matchIds.add(matchIdForPlayers);
}

async function settlePlayerUnit(
  tx: Tx, refs: AflApiRefs, registry: SourceFamilyRegistry, batchId: ImportBatchId,
  bundle: AflApiMatchBundle, playerPlan: AflApiPlayerUnitPlan,
  matchId: number | null, matchKey: string | null,
  autoApply: boolean, inProgressSeasons: readonly number[],
  counters: AflApiSettleCounters, derived: DerivedScope,
  versionSeqOf: (family: string, externalRecordId: string) => number,
): Promise<void> {
  const row = bundle.playerStats.find((s) => s.providerPlayerId === playerPlan.providerPlayerId);
  const externalRecordId = `${bundle.match.sourceRecordId}|${row?.providerTeamId ?? '?'}|${playerPlan.providerPlayerId}`;

  if (playerPlan.status === 'deferred') {
    recordDeferral(counters, playerPlan.reason);
    return;
  }
  if (playerPlan.status === 'blocked') return;

  if (playerPlan.status === 'refused') {
    const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, 'player_match_stats');
    if (playerPlan.reason === 'unresolved_identity') {
      await writePromotionCandidate(tx, {
        sourceId: refs.sourceId, family: 'player_match_stats',
        independenceGroup: contract.independence?.group ?? SETTLE_SOURCE_KEY,
        externalRecordId, sourceVersionSeq: versionSeqOf('player_match_stats', externalRecordId),
        verb: 'unresolved_identity', season: bundle.match.season,
        targetTable: 'player_match_stats', targetId: null, targetKey: {}, fields: [], proposedValues: {},
        currentValues: null, agreeingGroups: [], disagreeingGroups: [], batchId,
      }, counters);
      counters.unresolvedIdentityPlayer += 1;
      await writeImportRejection(tx, batchId, externalRecordId, 'player_match_stats: unresolved_identity', row ?? null);
    } else {
      await writeMatchIdentityIssue(tx, { externalRecordId, reason: playerPlan.reason }, counters);
      counters.unresolvedIdentityPlayer += 1;
    }
    return;
  }

  // playerPlan.status === 'planned'
  if (matchId === null || matchKey === null || !row) return; // the match itself did not land this run

  const proposed: Record<string, JsonValue> = {
    club_id: playerPlan.clubId,
    career_game_no: null,
    jumper_number: row.jumperNumber === null ? null : String(row.jumperNumber),
    ...aflApiPlayerStatValues(row),
  };
  const existing = await currentPlayerMatchValues(tx, playerPlan.playerId, matchId);
  const renderedFields = diffFields(proposed, existing?.values ?? null);

  // AFLDB-ISSUE-122 S6's derived-owned rule, reused rather than re-derived.
  //
  // `player_match_stats.career_game_no` has TWO writers: whatever a source
  // proposes, and `recomputePlayerDerivedStats()` — which this very module
  // runs at the end of every applying run (see `runSettleAflApi()`) and which
  // rewrites the column as the row number of the player's matches by date.
  // `afl_api` never sources it at all (§4.3: `playerStats.gamesPlayed` is
  // measured NULL on every row of every corpus sample 2022-2026, which is why
  // migration 103 calls the staging column "a recompute-owned candidate"), so
  // the proposal above carries a literal `null` for it.
  //
  // Left in the automatic proposal that is a guaranteed non-convergent loop,
  // and the identical-rerun proof is what finds it: run 1 inserts NULL and the
  // recompute immediately renumbers it to a real value; run 2 therefore sees a
  // target that "differs", writes NULL back, logs a second ledger row, and the
  // recompute renumbers it again — one canonical UPDATE per run, for ever.
  // `settle-afltables.ts` hit exactly this and answered it with
  // `DERIVED_OWNED_FIELDS`/`automaticProposal()`; that is the same helper,
  // imported, not a second copy that could drift from it.
  //
  // Scoped to the AUTOMATIC path only, exactly as the AFL Tables precedent
  // scopes it: the promotion candidate below still carries the FULL proposal,
  // so a source that one day does publish a career game number still surfaces
  // the difference to a human as a `corrected` candidate. And, as AFL Tables
  // does, the field is removed BEFORE the diff, the baseline hash and the
  // applier's own comparison, so all three see one field set.
  //
  // `matches` and `match_period_scores` have no `DERIVED_OWNED_FIELDS` entry,
  // so the match path above needs no equivalent split today; if one is ever
  // added, that path must gain the same treatment.
  const automatic = automaticProposal('player_match_stats', proposed);
  const automaticFields = diffFields(automatic, existing?.values ?? null);

  const contract = getSourceFamily(registry, SETTLE_SOURCE_KEY, 'player_match_stats');
  // Typed projection (migration 103) — a resolved, promotable row, whether
  // or not it changes this run.
  await projectAflApiPlayerMatch(
    tx, refs, versionSeqOf('player_match_stats', externalRecordId), batchId, externalRecordId,
    bundle.match.season, matchKey, row, playerPlan.playerId, playerPlan.clubId,
  );

  if (autoApply) {
    // The automatic path's own emptiness test: a row differing ONLY in a
    // derived-owned field has nothing this path may write.
    if (automaticFields.length === 0) {
      // I244-F009 self-heal: nothing left to apply, so an earlier refusal is moot.
      await closeMootApplyFinding(
        tx, refs, 'player_match_stats', externalRecordId, 'player_match_stats', counters,
      );
      return;
    }
    const unitInput: CanonicalApplyUnitInput = {
      family: 'player_match_stats',
      externalRecordId,
      season: bundle.match.season,
      sourceId: refs.sourceId,
      sourceKey: SETTLE_SOURCE_KEY,
      sourceKeysById: refs.sourceKeysById,
      batchId,
      inProgressSeasons,
      completionProven: true,
      matchKey,
      matchRekey: null,
      playerId: playerPlan.playerId,
      brownlowRoundNumber: null,
      targets: [{
        targetTable: 'player_match_stats',
        invitation: 'candidate',
        proposedValues: automatic,
        renderedFields: automaticFields,
        renderedBaselineCanonicalHash: existing === null ? null : baselineCanonicalHash(automaticFields, existing.values),
        sourceVersionSeq: versionSeqOf('player_match_stats', externalRecordId),
      }],
    };
    const outcome = await applyCanonicalUnit(tx, unitInput);
    await applyUnitOutcome(tx, refs, unitInput, outcome, counters, derived, {
      player_match_stats: existing?.targetId ?? null,
    });
    for (const result of outcome.results) {
      if (result.applied) derived.playerIds.add(playerPlan.playerId);
    }
  } else {
    // The REVIEWED path keeps the full proposal, derived-owned field included,
    // so a human still sees everything the source says (§19: the candidate is
    // evidence, not a write).
    if (renderedFields.length === 0) return;
    await writePromotionCandidate(tx, {
      sourceId: refs.sourceId, family: 'player_match_stats',
      independenceGroup: contract.independence?.group ?? SETTLE_SOURCE_KEY,
      externalRecordId, sourceVersionSeq: versionSeqOf('player_match_stats', externalRecordId),
      verb: existing === null ? 'new' : 'corrected', season: bundle.match.season,
      targetTable: 'player_match_stats', targetId: existing?.targetId ?? null,
      targetKey: { player_id: playerPlan.playerId, match_id: matchId }, fields: renderedFields,
      proposedValues: proposed, currentValues: existing?.values ?? null,
      agreeingGroups: [], disagreeingGroups: [], batchId,
    }, counters);
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

class RequireCompleteSourceRollback extends Error {
  constructor(public readonly completeness: SourceCompletenessVerdict) {
    super(`--require-complete-source refused commit: ${completeness.headline}`);
    this.name = 'RequireCompleteSourceRollback';
  }
}

/**
 * These counters describe rows or derived values durably written by the
 * current transaction. A full rollback means none may be reported as an
 * applied effect. Deliberately retain input/plan facts (for example snapshot
 * coverage, identity refusals, corroboration and write refusals): they remain
 * useful to explain why the commit gate refused the run.
 */
const FULL_ROLLBACK_DURABLE_COUNTERS = [
  'payloadsCreated',
  'versionsAppended',
  'observationsCorrected',
  'observationsHistoryOnly',
  'observationsMarkedAbsent',
  'observationsReappeared',
  'projectionRowsWritten',
  'candidatesCreated',
  'candidatesRefreshed',
  'dataIssuesOpened',
  'dataIssuesRefreshed',
  'dataIssuesResolved',
  'canonicalRowsInserted',
  'canonicalRowsUpdated',
  'canonicalApplicationsLogged',
  'attendanceEnrichmentsApplied',
  'derivedRecomputeRuns',
  'derivedRecomputePlayers',
] as const satisfies readonly (keyof AflApiSettleCounters)[];

/** Normalise public counters after the require-complete full transaction rollback. */
export function normaliseAflApiCountersAfterFullRollback(counters: AflApiSettleCounters): void {
  for (const counter of FULL_ROLLBACK_DURABLE_COUNTERS) counters[counter] = 0;
}

export async function runSettleAflApi(
  sql: postgres.Sql, options: AflApiSettleRunOptions,
): Promise<AflApiSettleRunResult> {
  const { bundle } = options;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const counters = emptyAflApiCounters();
  counters.buildFailures = bundle.buildFailures.length;

  let batchIdText: string | null = null;
  let applied = false;
  let halt: { reason: string; detail: Readonly<Record<string, unknown>> } | null = null;
  let rollbackReason: AflApiSettleRunResult['rollbackReason'] = null;
  let sourceCompleteness: SourceCompletenessVerdict | null = null;

  try {
    await sql.begin(async (tx) => {
      const refs = await loadRefs(tx);
      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
        VALUES (${refs.sourceId}, ${SETTLE_BATCH_TOOL}, 'staging.source_record_versions',
                ${bundle.units.reduce((n, u) => n + u.settleRecords.length, 0)},
                ${`AFLDB-ISSUE-228 settle; snapshot=${bundle.snapshotLabel}; season=${bundle.season}; `
                  + `mode=${options.apply ? 'apply' : 'dry-run'}${options.autoApply ? '; auto-apply' : ''}`})
        RETURNING id
      `;
      const runBatchId = asImportBatchId(batch.id);
      batchIdText = batch.id;
      const derived: DerivedScope = emptyDerivedScope();
      const ownedMatchKeys: string[] = [];

      for (const unit of bundle.units) {
        await settleMatchUnit(
          tx, refs, options.registry, runBatchId, observedAt, options.autoApply, options.inProgressSeasons,
          unit, counters, derived, ownedMatchKeys,
        );
      }

      if (options.autoApply) {
        // I244-F009: the run-level `season_not_in_progress` finding (written by
        // the first refused target) is closed the first run the season is
        // in progress again. A run with no units evaluated nothing and leaves it.
        if (bundle.units.length > 0) {
          await clearSeasonGateFinding(
            tx, APPLY_FINDING_SCOPE, refs.applyFindings, bundle.season, options.inProgressSeasons, counters,
          );
        }
        await sweepAttendanceEnrichment(tx, refs, options.registry, runBatchId, ownedMatchKeys, counters);
        // I244-F001: the established AFL Tables/admin recompute set and
        // ordering (`settle-afltables.ts:1906-1914`) — season metadata first
        // because `recomputeClubSeasons()`'s wooden-spoon gate reads
        // `seasons.status`; `recomputeSeasonBrownlowStatus()` last because
        // `player_season_stats.brownlow_status` itself depends on season
        // state. Gated on actual canonical writes, matching the shared
        // `SettleCounters` contract, so a corroborated/no-op replay (F012)
        // does not touch `club_seasons`/`seasons` or re-run the player
        // rebuild. Same transaction as the canonical writes above: a
        // `--dry-run` rolls every recompute back with everything else, and a
        // recompute failure fails the whole settle rather than leaving
        // committed canonical rows beside stale derived ones.
        if (counters.canonicalRowsInserted + counters.canonicalRowsUpdated > 0) {
          const playerIds = await affectedPlayerIds(tx, derived);
          await recomputeSeasonMetadata(tx, bundle.season);
          await recomputeClubSeasons(tx, bundle.season);
          await recomputePlayerDerivedStats(tx, playerIds, bundle.season);
          await recomputeSeasonBrownlowStatus(tx, bundle.season);
          counters.derivedRecomputeRuns = 1;
          counters.derivedRecomputePlayers = playerIds.length;
        }
      }

      if (options.requireCompleteSource && options.apply) {
        sourceCompleteness = assessSourceCompleteness({
          snapshotMatches: counters.snapshotMatches,
          snapshotPlayerMatchRows: counters.snapshotPlayerMatchRows,
          snapshotRejections: counters.unresolvedIdentityMatch + counters.unresolvedIdentityPlayer,
          snapshotUnkeyedRejections: counters.buildFailures,
          absenceSweepSkipped: 0,
          recordsDeferred: Object.values(counters.recordsDeferred).reduce((total, count) => total + count, 0),
        });
        if (sourceCompleteness.status !== 'complete') {
          throw new RequireCompleteSourceRollback(sourceCompleteness);
        }
      }

      // I244-F008: close the batch in THIS transaction, after every write and
      // after the last gate that can still refuse the run (a refused or halted
      // run never reaches here and takes its batch row with it). A dry-run
      // finalises too, so the real UPDATE runs against real constraints and
      // privileges, and is then rolled back below with everything else. A
      // failure here fails the transaction — committed data never sits beside
      // a `running` batch.
      await finalizeSettleImportBatch(tx, runBatchId, counters);

      if (!options.apply) throw new DryRunRollback();
      applied = true;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      // Deliberate rollback: nothing persisted, including the batch row.
      batchIdText = null;
      rollbackReason = 'dry_run';
    } else if (error instanceof RequireCompleteSourceRollback) {
      // Completeness is evaluated after the run is known but before commit,
      // so the batch, observations, projections and canonical rows roll back together.
      batchIdText = null;
      applied = false;
      rollbackReason = 'require_complete_source';
      sourceCompleteness = error.completeness;
      normaliseAflApiCountersAfterFullRollback(counters);
    } else if (error instanceof AflApiSettleHalt) {
      halt = { reason: error.reason, detail: error.detail };
      batchIdText = null;
      applied = false;
    } else {
      throw error;
    }
  }

  return {
    applied, batchId: applied ? batchIdText : null, counters, halt, rollbackReason, sourceCompleteness,
  };
}

export { areCoSources };
