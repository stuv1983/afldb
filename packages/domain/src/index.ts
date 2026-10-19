/**
 * @afldb/domain — AFLDB V2 domain types, rules and identifiers (docs/v2/plan.md §3 D1).
 *
 * Imports nothing internal except pure leaf modules it re-exports, and its transitive closure
 * reaches no database, framework or IO module (enforced by tests/v2-module-boundaries.test.ts).
 * Existing contracts are re-exported, not rewritten.
 */

// Fixture status and round vocabulary (AFLDB-ISSUE-162), the shared fixture/finals rules.
export {
  FINALS_ROUND_CODES,
  FIXTURE_ROUND_TYPES,
  FIXTURE_STATUSES,
  MAX_BATCH_ROWS,
  MAX_HOME_AND_AWAY_ROUND,
  isFixtureRoundType,
  isFixtureStatus,
  type FixtureRoundType,
  type FixtureStatus,
} from '@/lib/fixtures/spec';

// The branded import-batch identifier every acquisition and promotion record carries.
export { asImportBatchId, type ImportBatchId } from '@/lib/import-batch-id';

// The sealed historical baseline manifest: table spec, sealed seasons, validation, comparator
// (docs/v2/historical-manifest-spec.md). Pure; the producer lives in @afldb/db.
export {
  COMPARISON_FORMAT,
  HISTORICAL_TABLES,
  MANIFEST_FORMAT,
  MANIFEST_FORMAT_VERSION,
  MANIFEST_SPEC_VERSION,
  METADATA_COLUMNS,
  ManifestFormatError,
  compareManifests,
  comparisonExitCode,
  describeColumnRef,
  isSealedBucket,
  isSealedSeason,
  parseManifest,
  renderComparison,
  sealedSeasonsFrom,
  validateManifest,
  type ColumnRef,
  type ComparisonFinding,
  type FindingCode,
  type FindingSeverity,
  type HistoricalManifest,
  type HistoricalTableKind,
  type HistoricalTableSpec,
  type ManifestBucket,
  type ManifestComparison,
  type ManifestTable,
  type SealedSeasons,
  type SeasonRegistry,
} from './historical-manifest';

// Stage 3 (AFL API pipeline) export blocks. Each workstream inserts its exports directly
// below its own anchor line; keep the anchors.
// @v2-stage3:coverage-registry
// The evidence-backed coverage registry (plan D11, ADR 0011). Pure; the matrix document is
// generated from it by tools/v2/coverage-matrix.ts.
export {
  COVERAGE_EVIDENCE_KINDS,
  COVERAGE_FAMILIES,
  COVERAGE_FAMILY_LABELS,
  COVERAGE_REGISTRY,
  COVERAGE_STATUSES,
  COVERAGE_STATUS_DEFINITIONS,
  checkCoverageEvidence,
  coverageFor,
  renderCoverageMatrix,
  validateCoverageRegistry,
  type CoverageEntry,
  type CoverageEvidence,
  type CoverageEvidenceKind,
  type CoverageFamily,
  type CoverageStatus,
} from './coverage-registry';
// @v2-stage3:season-seal
// The pure write decision for sealed historical seasons (V2-GAP-006; docs/v2/historical-baseline.md §2).
export {
  AUDITED_CORRECTION_WORKFLOWS,
  CORRECTION_NOTE_MAX_LENGTH,
  CORRECTION_NOTE_MIN_LENGTH,
  SealedSeasonRefusal,
  assertSeasonWritable,
  evaluateSeasonWrite,
  type AuditedCorrection,
  type AuditedCorrectionWorkflow,
  type SeasonWriteDecision,
  type SeasonWriteInput,
} from './season-seal';
// @v2-stage4:legacy-retirement
// The registry of retired entry points and their refusal text (plan D10, ADR 0010, R-006).
export {
  RETIRED_ENTRIES,
  findRetiredEntry,
  renderRetiredEntryRefusal,
  renderUnknownRetiredEntry,
  type RetiredEntry,
} from './legacy-retirement';
// @v2-stage5:retired-admin
// The registry of retired ADMIN surfaces (server actions, route handlers) and their typed refusal
// (plan D9/D10, ADR 0009/0010, V2-GAP-013). Pure.
export {
  LEGACY_RETIRED_CODE,
  RETIRED_ADMIN_SURFACES,
  findRetiredAdminSurface,
  renderRetiredAdminRefusal,
  retiredAdminRefusal,
  type RetiredAdminRefusal,
  type RetiredAdminSurface,
  type RetiredAdminSurfaceKind,
} from './legacy-retirement';
// @v2-stage6:table-row-counts
// The table row-count inventory format (shadow parity input; docs/v2/shadow-rehearsal.md). Pure.
export {
  TABLE_ROW_COUNTS_FORMAT,
  TABLE_ROW_COUNTS_FORMAT_VERSION,
  TableRowCountsFormatError,
  V2_ADDED_TABLES,
  isV2AddedTable,
  parseTableRowCounts,
  validateTableRowCounts,
  type TableRowCount,
  type TableRowCounts,
} from './table-row-counts';
// @v2-stage6:shadow-target
// The shadow-rehearsal target policy: only an afldb_v2_shadow[_<tag>]_test copy is a target. Pure.
export {
  REDIRECTING_LIBPQ_VARIABLES,
  RESERVED_DATABASE_NAMES,
  SHADOW_DATABASE_NAME_PATTERN,
  databaseNameFromDsn,
  evaluateShadowDatabaseName,
  evaluateShadowDsn,
  scanShadowEnvironment,
  type ShadowDsnVerdict,
  type ShadowEnvironmentFinding,
  type ShadowEnvironmentResult,
} from './shadow-target';
// @v2-launchF:isolated-test-target
// The isolated local PostgreSQL target policy: loopback, marked cluster and database only. Pure.
export {
  ISOLATED_CLUSTER_NAME,
  ISOLATED_DATABASE_MARKER,
  ISOLATED_DATABASE_NAME_PATTERN,
  ISOLATED_SERVER_FACTS_SQL,
  LOOPBACK_HOSTS,
  checkIsolatedTestDsn,
  checkIsolatedTestServer,
  isolatedDatabaseOf,
  type IsolatedServerFacts,
  type IsolatedTargetFinding,
} from './isolated-test-target';
