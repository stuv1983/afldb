// READ-ONLY facts around one nightly settle on an isolated _test database (run via isolated-pg run). No DSN printed.
import { createRequire } from 'node:module';
import { join } from 'node:path';
const postgres = createRequire(join(process.cwd(), 'package.json'))('postgres');
const raw = process.env.AFLDB_TEST_DATABASE_URL;
const db = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!/^afldb_v2_.+_test$/.test(db)) throw new Error('isolated _test database required');
const sql = postgres(raw, { max: 1, onnotice: () => {} });
try {
  // Every query goes through `tx` (the pool has one connection, which the transaction holds).
  const out = await sql.begin('read only', async (tx) => { const one = async (q) => (await tx.unsafe(q))[0]; return {
    label: process.argv[2] ?? null,
    database: db,
    ledger: await one(`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations`),
    importBatches: await one(`SELECT count(*)::int AS n, max(id)::int AS max_id FROM import_batches`),
    lastBatch: await one(`SELECT (to_jsonb(b) - 'validation_result' - 'notes') AS row, b.validation_result->'seasonFeedStatusCounts' AS feed_status, b.validation_result->>'seasonFeedMatches' AS feed_matches, b.validation_result->>'snapshotMatches' AS snapshot_matches FROM import_batches b ORDER BY id DESC LIMIT 1`),
    matchesBySeason: await tx.unsafe(`SELECT season, count(*)::int AS n FROM matches WHERE season >= 2025 GROUP BY season ORDER BY season`),
    fixtures: await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE (to_jsonb(f)->>'season')::int = 2027)::int AS season2027 FROM fixtures f`),
    playerMatchStats: await one(`SELECT count(*)::bigint::text AS n FROM player_match_stats`),
    dataIssuesOpen: await one(`SELECT count(*)::int AS n FROM data_issues WHERE resolved_at IS NULL`),
    dataIssuesTotal: await one(`SELECT count(*)::int AS n FROM data_issues`),
    stagingAflApiMatch: await one(`SELECT count(*)::int AS n FROM staging.afl_api_match`),
    siteSwitch: await tx.unsafe(`SELECT key, value::text FROM site_settings WHERE key LIKE 'acquisition.%' ORDER BY key`),
  }; });
  console.log(JSON.stringify(out, null, 1));
} finally { await sql.end(); }
