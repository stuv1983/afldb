/**
 * AFLDB V2 Stage 3 — the AFL API acquisition pipeline contract (docs/v2/plan.md §3 D1, ADR 0001).
 *
 * The owner's chain, as stage names:
 *
 *   AFL API -> immutable snapshot -> validated staging -> identity resolution -> reconciliation
 *     -> transactional promotion -> derived calculations
 *
 * This module only DESCRIBES where each stage lives in the existing code (plan D1: wrap, never
 * move). It imports nothing and executes nothing; `renderAflApiStageMap` (./stage-map) renders it
 * to docs/v2/architecture.md §9, and tests/v2-acquisition-pipeline.test.ts proves every cited
 * `path` holds an export named `symbol` and that the acquire stage reaches no writer module
 * ("API clients never write final tables").
 *
 * `path` is repository-relative POSIX. A path that does not start with `packages/` is cited, not
 * re-exported from the package index, whenever its runtime closure reaches `postgres`,
 * `src/db/**` or a writer module (settle-afl-api.ts and afl-api-brownlow.ts reach
 * src/db/queries/player-derived.ts; the CLIs live under tools/). The index re-exports the pure
 * and read-only implementations only; see packages/acquisition/src/index.ts.
 */

export const ACQUISITION_STAGES = [
  'acquire',
  'snapshot',
  'validate_stage',
  'resolve_identity',
  'reconcile',
  'promote',
  'derive',
] as const;

export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number];

/** The strongest thing a stage may write: nothing, snapshot files, staging, canonical rows, derived rows. */
export type StageWrites = 'nothing' | 'snapshot_files' | 'staging' | 'canonical' | 'derived';

export interface StageImplementation {
  /** Repository-relative POSIX path of the module that exports `symbol`. */
  readonly path: string;
  /** The exported name; the stage map cites the line of its export declaration. */
  readonly symbol: string;
  readonly note: string;
}

export interface StageDescriptor {
  readonly stage: AcquisitionStage;
  readonly summary: string;
  readonly writes: StageWrites;
  readonly implementations: readonly StageImplementation[];
}

const CLIENT = 'src/lib/acquisition/afl-api-client.ts';
const DISCOVERY = 'src/lib/acquisition/afl-api-season-discovery.ts';
const CONSTANTS = 'src/lib/acquisition/afl-api-acquisition-constants.ts';
const ACQUIRE_CLI = 'tools/current-season/acquire-afl-api.ts';
const ACQUIRE_BROWNLOW_CLI = 'tools/current-season/acquire-afl-api-brownlow.ts';
const SNAPSHOT = 'src/lib/acquisition/afl-api-snapshot.ts';
const BUNDLE = 'src/lib/acquisition/afl-api-bundle.ts';
const SETTLE = 'src/lib/acquisition/settle-afl-api.ts';
const BROWNLOW = 'src/lib/acquisition/afl-api-brownlow.ts';
const SETTLE_CORE = 'src/lib/acquisition/settle-core.ts';
const PLAYER_DERIVED = 'src/db/queries/player-derived.ts';
const FIXTURE_CONTRACT = 'packages/acquisition/src/fixture-contract.ts';

export const AFL_API_PIPELINE: readonly StageDescriptor[] = [
  {
    stage: 'acquire',
    summary: 'Request planning, rate-limited fetch and season discovery against the AFL API. '
      + 'The client and the discovery module import nothing that can write; the two acquire CLIs '
      + 'read the ingestion switch and hand bytes to the snapshot stage.',
    writes: 'nothing',
    implementations: [
      { path: CLIENT, symbol: 'planAflApiTokenRequest', note: 'token request plan (no I/O)' },
      { path: CLIENT, symbol: 'planAflApiSeasonMatchesRequest', note: 'whole-season feed request plan' },
      { path: CLIENT, symbol: 'planAflApiCompSeasonsRequest', note: 'competition-season listing request plan' },
      { path: CLIENT, symbol: 'planAflApiPlayerStatsRequest', note: 'per-match player statistics request plan' },
      { path: CLIENT, symbol: 'planAflApiMatchRosterRequest', note: 'per-match roster request plan' },
      { path: CLIENT, symbol: 'planAflApiBrownlowSeasonRequest', note: 'Brownlow season request plan' },
      { path: CLIENT, symbol: 'requestAflApi', note: 'the only HTTP entry: bounded retry, rate-limited' },
      { path: CLIENT, symbol: 'fetchAflApiToken', note: 'obtains the provider token' },
      { path: CLIENT, symbol: 'fetchAflApiCfsResource', note: 'fetches one CFS resource body' },
      { path: CLIENT, symbol: 'selectAflApiMatches', note: 'selects which feed matches to acquire' },
      { path: DISCOVERY, symbol: 'parseAflApiCompSeasons', note: 'parses the competition-season listing' },
      { path: DISCOVERY, symbol: 'proposeAflApiSeasons', note: 'proposes registry additions; never writes the registry' },
      { path: CONSTANTS, symbol: 'AFL_API_FIXTURE_ACQUISITION_KIND', note: 'writer-free leaf constant (W5 MED resolution)' },
      { path: CONSTANTS, symbol: 'isAflApiBrownlowEnabled', note: 'Brownlow acquisition switch; writer-free leaf' },
      { path: ACQUIRE_CLI, symbol: 'parseAcquireArgs', note: 'match acquire CLI arguments' },
      { path: ACQUIRE_CLI, symbol: 'runAcquisition', note: 'match acquire CLI entry; cited by path (tools/)' },
      { path: ACQUIRE_BROWNLOW_CLI, symbol: 'parseAcquireBrownlowArgs', note: 'Brownlow acquire CLI arguments' },
      { path: ACQUIRE_BROWNLOW_CLI, symbol: 'runBrownlowAcquisition', note: 'Brownlow acquire CLI entry; cited by path (tools/)' },
    ],
  },
  {
    stage: 'snapshot',
    summary: 'Immutable, hash-bound snapshot directories: claim a fresh directory, write raw bodies, '
      + 'seal them with manifest.json; read, re-hash and replay a retained snapshot offline.',
    writes: 'snapshot_files',
    implementations: [
      { path: 'src/lib/acquisition/snapshot-dir.ts', symbol: 'claimSnapshotDir', note: 'claims a new directory; never reuses or deletes one' },
      { path: ACQUIRE_CLI, symbol: 'buildAflApiLabel', note: 'snapshot label for a match acquisition' },
      { path: ACQUIRE_CLI, symbol: 'cleanupPartialSnapshot', note: 'removes only a partial directory this run created' },
      { path: ACQUIRE_BROWNLOW_CLI, symbol: 'buildAflApiBrownlowLabel', note: 'snapshot label for a Brownlow acquisition' },
      { path: ACQUIRE_BROWNLOW_CLI, symbol: 'cleanupPartialBrownlowSnapshot', note: 'removes only a partial Brownlow directory' },
      { path: SNAPSHOT, symbol: 'aflApiSnapshotRoot', note: 'data/sources/afl_api/matches under a project root' },
      { path: SNAPSHOT, symbol: 'verifyAflApiSnapshotManifest', note: 'fail-closed re-hash of every manifest file' },
      { path: SNAPSHOT, symbol: 'aflApiUnitSourcesFrom', note: 'unit sources, only from fully hash-verified match directories' },
      { path: SNAPSHOT, symbol: 'aflApiSeasonFeedTextFrom', note: 'the retained whole-season feed text, or null' },
      { path: SNAPSHOT, symbol: 'aflApiSnapshotManifestSha256', note: 'the snapshot identity: sha256 of manifest.json' },
      { path: 'packages/acquisition/src/replay.ts', symbol: 'replayAflApiSnapshot', note: 'offline replay of a snapshot into the validated bundle and a plan digest' },
    ],
  },
  {
    stage: 'validate_stage',
    summary: 'Fail-closed validation of provider bodies against the source-family registry into typed '
      + 'projections and settle records, then durable observation of each record. Emitters are pure; '
      + 'persistSourceObservation writes the observation spine only.',
    writes: 'staging',
    implementations: [
      { path: BUNDLE, symbol: 'emitAflApiMatch', note: 'match family projection' },
      { path: BUNDLE, symbol: 'emitAflApiPlayerMatchStats', note: 'player_match_stats family projection' },
      { path: BUNDLE, symbol: 'emitAflApiMatchRoster', note: 'match_roster family projection' },
      { path: BUNDLE, symbol: 'emitAflApiBrownlowMatchVotes', note: 'Brownlow per-match vote projection' },
      { path: BUNDLE, symbol: 'emitAflApiBrownlowLeaderboard', note: 'Brownlow leaderboard projection' },
      { path: BUNDLE, symbol: 'buildAflApiMatchBundle', note: 'one match: match + roster + stats, cross-checked' },
      { path: BUNDLE, symbol: 'buildAflApiSettleRecords', note: 'explicit per-record settle shape' },
      { path: SETTLE, symbol: 'buildAflApiSettleBundle', note: 'whole snapshot; a bad unit is a build failure, never dropped; cited by path (writer module)' },
      { path: 'src/lib/acquisition/afl-api-season-enumeration.ts', symbol: 'assessAflApiSeasonEnumeration', note: 'proves the retained season feed complete or lists its gaps' },
      { path: 'src/lib/acquisition/observations.ts', symbol: 'canonicalJson', note: 'the one deterministic JSON form used for hashes and plan digests' },
      { path: 'src/lib/acquisition/observation-store.ts', symbol: 'persistSourceObservation', note: 'append-only observation spine; cited by path (writer)' },
    ],
  },
  {
    stage: 'resolve_identity',
    summary: 'Provider identities resolve to stable AFLDB ids, never by name alone, and every fixture '
      + 'status is routed before any identity is minted. Unresolved identity is a refusal, not a guess.',
    writes: 'nothing',
    implementations: [
      { path: BUNDLE, symbol: 'parseAflApiIdentities', note: 'the committed team/venue/season identity map' },
      { path: 'src/lib/acquisition/afl-api-rounds.ts', symbol: 'translateAflRound', note: 'provider round to AFLDB round code' },
      { path: 'src/lib/acquisition/afl-api-match-resolver.ts', symbol: 'resolveAflApiMatch', note: 'resolves a match to its canonical match_key; cited by path (DB read)' },
      { path: 'src/lib/acquisition/afl-api-player-resolver.ts', symbol: 'resolveAflApiPlayer', note: 'resolves a provider player id to a stable player id; cited by path (DB read)' },
      { path: 'src/lib/acquisition/afl-api-fixture-identity.ts', symbol: 'resolveAflApiMatchViaFixtureObservation', note: 'resolves via a fixture observation; cited by path (DB read)' },
      { path: FIXTURE_CONTRACT, symbol: 'classifyAflApiFixtureStatus', note: 'V2 Stage 3: status routing (fixture contract)' },
      { path: FIXTURE_CONTRACT, symbol: 'evaluateAflApiFixtureProjection', note: 'V2 Stage 3: projection preconditions (fixture contract)' },
      { path: FIXTURE_CONTRACT, symbol: 'detectAflApiFixtureCollisions', note: 'V2 Stage 3: collision refusals (fixture contract)' },
    ],
  },
  {
    stage: 'reconcile',
    summary: 'Source observations are compared with canonical state and with other sources; the outcome '
      + 'is a plan, a candidate or a refusal. The machine-readable reconciliation report is built here.',
    writes: 'nothing',
    implementations: [
      { path: 'src/lib/acquisition/reconciliation.ts', symbol: 'reconcile', note: 'pure field-level reconciliation outcome' },
      { path: 'src/lib/acquisition/afl-api-settle-plan.ts', symbol: 'planAflApiMatchUnit', note: 'plans one match unit; cited by path (reaches writers)' },
      { path: BROWNLOW, symbol: 'reconcileAflApiBrownlowSeason', note: 'Brownlow season reconciliation; cited by path (writer module)' },
      { path: 'packages/acquisition/src/reconciliation-report.ts', symbol: 'buildAflApiReconciliationReport', note: 'deterministic machine-readable report' },
      { path: 'packages/acquisition/src/reconciliation-report.ts', symbol: 'validateAflApiReconciliationReport', note: 'validates a report; returns problems' },
    ],
  },
  {
    stage: 'promote',
    summary: 'The only stage that writes canonical tables: one settle transaction behind the promotion '
      + 'gate, with the sealed-season check before any database client is created.',
    writes: 'canonical',
    implementations: [
      { path: 'tools/current-season/settle-afl-api.ts', symbol: 'loadAflApiSettleBundle', note: 'production snapshot loader; replay must equal it' },
      { path: 'tools/current-season/settle-afl-api.ts', symbol: 'runAflApiSettleCli', note: 'match settle CLI entry; review-first, --auto-apply explicit' },
      { path: 'tools/current-season/settle-season-seal.ts', symbol: 'refuseSealedSeasonForSettle', note: 'V2 Stage 3: the seal gate, before any DB client' },
      { path: 'packages/domain/src/season-seal.ts', symbol: 'evaluateSeasonWrite', note: 'V2 Stage 3: the pure sealed-season write decision' },
      { path: 'packages/domain/src/season-seal.ts', symbol: 'assertSeasonWritable', note: 'V2 Stage 3: throws SealedSeasonRefusal' },
      { path: SETTLE_CORE, symbol: 'acquireSettlePromotionGate', note: 'shared advisory gate, first call in each settle transaction' },
      { path: SETTLE, symbol: 'runSettleAflApi', note: 'match-family settle transaction; cited by path (writer)' },
      { path: SETTLE, symbol: 'normaliseAflApiCountersAfterFullRollback', note: 'zeroes durable counters after a full rollback' },
      { path: BROWNLOW, symbol: 'runSettleAflApiBrownlow', note: 'Brownlow settle transaction; cited by path (writer)' },
      { path: 'src/lib/acquisition/canonical-apply.ts', symbol: 'applyCanonicalUnit', note: 'the canonical applier; cited by path (writer)' },
    ],
  },
  {
    stage: 'derive',
    summary: 'Derived tables are recomputed after promotion from canonical rows, with deadlock retry; '
      + 'nothing in this stage ingests source data.',
    writes: 'derived',
    implementations: [
      { path: SETTLE_CORE, symbol: 'runDerivedRecomputeWithDeadlockRetry', note: 'runs the recompute with bounded deadlock retry' },
      { path: PLAYER_DERIVED, symbol: 'recomputePlayerDerivedStats', note: 'player career and season statistics' },
      { path: PLAYER_DERIVED, symbol: 'recomputeClubSeasons', note: 'club-season rows' },
      { path: PLAYER_DERIVED, symbol: 'recomputeSeasonMetadata', note: 'season metadata' },
      { path: PLAYER_DERIVED, symbol: 'recomputeSeasonBrownlowStatus', note: 'Brownlow season status' },
      { path: PLAYER_DERIVED, symbol: 'recomputeBrownlowCoverage', note: 'Brownlow coverage' },
    ],
  },
];
