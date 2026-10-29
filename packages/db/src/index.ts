/**
 * @afldb/db — AFLDB V2 database access boundary (docs/v2/plan.md §3 D1, D5).
 *
 * May import @afldb/domain only. The connection pools themselves stay in src/db/client.ts and
 * src/db/authClient.ts (re-exporting them here would build a pool on import); this package owns
 * the connection-safety contract both pools apply.
 */
export {
  assertTestProcessDsn,
  isTestProcess,
  testProcessDsnRefusal,
} from '@/db/test-process-guard';

// The historical baseline manifest producer (read-only, never run in Launch A; plan §7 R-007).
export {
  ManifestProducerRefusal,
  NON_TEST_CONFIRMATION_FLAG,
  PRODUCER_BEGIN_SQL,
  PRODUCER_END_SQL,
  PRODUCER_LOCAL_SETTINGS,
  PRODUCER_SESSION_SQL,
  PRODUCER_STATEMENT_ALLOWLIST,
  READ_ONLY_SOURCE_FLAG,
  bucketSql,
  catalogSql,
  planColumns,
  produceManifest,
  resolveProducerTarget,
  type ManifestQuery,
  type ManifestRow,
  type ProduceOptions,
  type ProducerTarget,
  type ProducerTargetArgs,
} from './historical-manifest-producer';

// The minimal SQL port shared by @afldb/admin services, the postgres.js adapter and the PGlite
// test adapter (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md).
export {
  nativeTransactionOf,
  postgresExecutor,
  postgresTransactionExecutor,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from './sql-executor';

// @v2-stage6:table-row-counts-producer
// The read-only table row-count census (shadow parity input; docs/v2/shadow-rehearsal.md).
export {
  DEFAULT_ROW_COUNT_SCHEMAS,
  ROW_COUNTS_BEGIN_SQL,
  ROW_COUNTS_END_SQL,
  ROW_COUNTS_LOCAL_SETTINGS,
  ROW_COUNTS_SESSION_SQL,
  ROW_COUNTS_STATE_SQL,
  ROW_COUNTS_STATEMENT_ALLOWLIST,
  ROW_COUNTS_TRANSACTION,
  RowCountsProducerRefusal,
  produceTableRowCounts,
  rowCountCatalogSql,
  rowCountSql,
  schemaExistsSql,
  type RowCountsOptions,
  type RowCountsQuery,
  type RowCountsRow,
} from './table-row-counts-producer';
