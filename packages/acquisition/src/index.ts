/**
 * @afldb/acquisition — AFLDB V2 acquisition boundary (docs/v2/plan.md §3 D1).
 *
 * May import @afldb/domain and @afldb/db. Never imported by src/app or src/components.
 * Acquisition never writes final tables; writes go through promotion/settle. The AFL API
 * facade over the existing client/snapshot/staging/resolve/promote code is Stage 3 work; until
 * then this package re-exports only the existing source-family registry contract.
 */
export {
  DEFAULT_CORROBORATION_POLICY,
  SourceFamilyContractError,
  areCoSources,
  countIndependentWitnesses,
  findSourceFamily,
  getSourceFamily,
  independenceGroups,
  isPromotable,
  parseSourceFamilyRegistry,
  type SourceFamilyContract,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

// Stage 3 (AFL API pipeline) export blocks. Each workstream inserts its exports directly
// below its own anchor line; keep the anchors.
// @v2-stage3:pipeline-facade
// Pipeline contract and stage map (docs/v2/architecture.md §9), offline snapshot replay, and the
// PURE / READ-ONLY stage implementations. Rule for a re-export here: the module's runtime import
// closure reaches none of src/db/**, server-only, postgres or a writer module (proved by
// tests/v2-acquisition-pipeline.test.ts). Writer-side implementations (settle-afl-api.ts,
// afl-api-brownlow.ts, settle-report.ts, settle-core.ts' writers, canonical-apply.ts, the CLIs
// under tools/) are cited by path in AFL_API_PIPELINE and deliberately NOT re-exported.
export {
  ACQUISITION_STAGES,
  AFL_API_PIPELINE,
  type AcquisitionStage,
  type StageDescriptor,
  type StageImplementation,
  type StageWrites,
} from './pipeline';
export {
  STAGE_MAP_BEGIN,
  STAGE_MAP_END,
  StageMapError,
  extractStageMap,
  findExportLine,
  renderAflApiStageMap,
  spliceStageMap,
} from './stage-map';
export {
  aflApiPlanDigest,
  replayAflApiSnapshot,
  type AflApiBundleBuilder,
  type AflApiReplayInput,
  type AflApiReplayResult,
} from './replay';
// acquire: the client and season discovery, plus the writer-free constants the acquire CLIs need.
export {
  AFL_API_MATCH_PROVIDER_ID_PATTERN,
  AFL_API_MIN_REQUEST_INTERVAL_MS,
  AFL_API_SEASON_PAGE_SIZE,
  AFL_API_SEASON_PROVIDER_ID_PATTERN,
  AFL_MENS_COMPETITION_ID,
  AflApiRequestError,
  DEFAULT_AFL_API_BASES,
  createAflApiRateLimiter,
  fetchAflApiCfsResource,
  fetchAflApiToken,
  parseAflApiJsonBody,
  parseAflApiSeasonMatchesEnvelope,
  planAflApiBrownlowLeaderboardRequest,
  planAflApiBrownlowSeasonRequest,
  planAflApiCompSeasonsRequest,
  planAflApiMatchRosterRequest,
  planAflApiPlayerStatsRequest,
  planAflApiSeasonMatchesRequest,
  planAflApiTokenRequest,
  requestAflApi,
  resolveAflApiEndpointBases,
  selectAflApiMatches,
  type AflApiCfsFetchResult,
  type AflApiEndpointBases,
  type AflApiMatchSelection,
  type AflApiRequestPlan,
  type AflApiResponse,
  type AflApiSeasonMatchSummary,
  type FetchLike,
} from '@/lib/acquisition/afl-api-client';
export {
  AFL_API_COMP_SEASONS_FILE,
  AFL_API_SEASON_DISCOVERY_CONTRACT_VERSION,
  AFL_API_SEASON_DISCOVERY_KIND,
  describeAflApiSeasonDiscovery,
  parseAflApiCompSeasons,
  proposeAflApiSeasons,
  serialiseAflApiSeasonDiscoveryProposal,
  type AflApiCompSeasonsListing,
  type AflApiSeasonDiscoveryProposal,
  type AflApiSeasonProposal,
  type RegisteredAflApiSeason,
} from '@/lib/acquisition/afl-api-season-discovery';
export {
  AFL_API_FIXTURE_ACQUISITION_KIND,
  BROWNLOW_ENABLE_ENV,
  isAflApiBrownlowEnabled,
} from '@/lib/acquisition/afl-api-acquisition-constants';
// snapshot: claim a directory, verify and read a retained snapshot.
export { claimSnapshotDir, type ClaimedSnapshotDir } from '@/lib/acquisition/snapshot-dir';
export {
  aflApiSeasonFeedTextFrom,
  aflApiSnapshotManifestSha256,
  aflApiSnapshotRoot,
  aflApiUnitSourcesFrom,
  verifyAflApiSnapshotManifest,
  type AflApiManifestFile,
  type AflApiSnapshotManifest,
} from '@/lib/acquisition/afl-api-snapshot';
// validate_stage: the emitters and builders (pure), the season-feed assessment and canonical JSON.
export {
  AFL_API_BUNDLE_CONTRACT_VERSION,
  AflApiBundleError,
  BrownlowVoteSetError,
  buildAflApiMatchBundle,
  buildAflApiSettleRecords,
  canonicalStringify,
  emitAflApiBrownlowLeaderboard,
  emitAflApiBrownlowMatchVotes,
  emitAflApiMatch,
  emitAflApiMatchRoster,
  emitAflApiPlayerMatchStats,
  flattenObservedColumns,
  isAflApiNonParticipant,
  parseAflApiIdentities,
  semanticHash,
  type AflApiDeferral,
  type AflApiIdentities,
  type AflApiMatchBundle,
  type AflApiSettleRecord,
} from '@/lib/acquisition/afl-api-bundle';
export {
  AFL_API_ABSENCE_TOLERANCE,
  AFL_API_SEASON_FEED_FILE,
  aflApiSeasonScopeKey,
  assessAflApiSeasonEnumeration,
  describeAflApiSeasonEnumeration,
  missingAflApiSeasonEnumeration,
  planAflApiAbsenceSweep,
  type AflApiAbsencePlan,
  type AflApiSeasonEnumeration,
  type AflApiSeasonEnumerationGap,
} from '@/lib/acquisition/afl-api-season-enumeration';
export { canonicalJson } from '@/lib/acquisition/observations';
// reconcile: the pure reconciliation outcome and the refusal census.
export { reconcile, type ReconcileInput, type ReconciliationOutcome } from '@/lib/acquisition/reconciliation';
export {
  aflApiRefusalCensusEntry,
  aflApiRefusalCensusSha256,
  canonicalAflApiRefusalCensus,
  compareAflApiRefusalCensusEntries,
  sortAflApiRefusalEvidence,
  type AflApiCanonicalRefusalEvidence,
  type AflApiRefusalCensusEntry,
} from '@/lib/acquisition/afl-api-refusal-evidence';
// @v2-stage3:fixture-contract
// AFL API fixture identity contract (AFLDB-ISSUE-229 safe surrounding contracts; pure, no writer).
export {
  AFL_API_FIXTURE_DEFERRED_STATUSES,
  AFL_API_FIXTURE_SCHEDULED_STATUSES,
  classifyAflApiFixtureStatus,
  detectAflApiFixtureCollisions,
  evaluateAflApiFixtureProjection,
  type AflApiFixtureCollision,
  type AflApiFixtureCollisionCode,
  type AflApiFixtureContractContext,
  type AflApiFixtureEvaluation,
  type AflApiFixtureProjection,
  type AflApiFixtureRefusal,
  type AflApiFixtureRefusalCode,
  type AflApiFixtureStatusClass,
} from './fixture-contract';
// AFL API fixture lifecycle and feed staging (AFLDB-ISSUE-229 / V2-GAP-008; pure, the writer is
// src/lib/acquisition/afl-api-fixture-writer.ts).
export {
  AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS,
  evaluateAflApiFixtureLifecycle,
  parseAcknowledgedUnobservedStatuses,
  stageAflApiFixtureFeed,
  type AflApiFixtureLifecycleEvaluation,
  type AflApiFixtureLifecycleRefusal,
  type AflApiFixtureLifecycleRefusalCode,
  type AflApiFixtureStage,
  type AflApiFixtureStageRefusal,
  type AflApiFixtureTransition,
  type AflApiFixtureTransitionKind,
} from './fixture-lifecycle';
export {
  AFL_API_FIXTURE_SOURCE_KEY,
  settleAflApiFixtureStage,
  type AflApiFixtureAction,
  type AflApiFixtureActionKind,
  type AflApiFixtureProvenance,
  type AflApiFixtureSettleOutcome,
  type AflApiFixtureWriterRefusal,
  type AflApiFixtureWriterRefusalCode,
} from './fixture-writer';
// @v2-stage3:reconciliation-report
// The machine-readable reconciliation report (pure; types only from the writer modules).
export {
  AFL_API_COUNTER_KEYS,
  AFL_API_RECONCILIATION_REPORT_FORMAT,
  AFL_API_RECONCILIATION_REPORT_JSON_SCHEMA,
  AFL_API_RECONCILIATION_REPORT_VERSION,
  AFL_API_RECONCILIATION_REQUIRED,
  AFL_API_RECONCILIATION_RUN_MODES,
  buildAflApiReconciliationReport,
  serialiseAflApiReconciliationReport,
  validateAflApiReconciliationReport,
  type AflApiReconciliationReport,
  type AflApiReconciliationReportInput,
  type AflApiReconciliationRunMode,
} from './reconciliation-report';
