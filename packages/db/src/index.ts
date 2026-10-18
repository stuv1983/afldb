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
