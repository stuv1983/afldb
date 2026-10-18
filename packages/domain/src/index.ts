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
