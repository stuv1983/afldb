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
