/**
 * ISOLATED ONLY. Seeds the 2025 `afl_api` match-family (fixtures spine) observations that stage B1 of the ordered
 * Brownlow workflow needs but that a production-derived restore does not hold (the 2025 fixtures snapshot
 * `afl-api-2025-2026-10-20-014218` is not retained; its effect survives in the earlier rehearsal database).
 *
 *   node tools/v2/isolated-pg.ts run afldb_v2_bro_<label>_test -- \
 *     node --import tsx tools/v2/brownlow-isolated-seed-2025-fixture-observations.mts <source-db> <report-file-outside-checkout>
 *
 * It copies, verbatim, the 212 `scope_key = 'season=2025'` match observations (records, versions, payloads) from the
 * named SOURCE disposable database into the launcher-proved TARGET, under ONE new import_batches row that says in its
 * notes that it is a SIMULATED prerequisite copy. It is a stand-in for running `settle-afl-api-fixtures.ts --apply` on
 * the real snapshot; it is NOT production evidence and it never touches `brownlow_*` or canonical tables. Both databases
 * must be marked isolated `afldb_v2_*_test` on the launcher's loopback cluster; the target must hold none of these
 * observations already (it refuses rather than merging). Nothing is deleted.
 */
import { existsSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const [sourceDb, reportPath] = process.argv.slice(2);
if (!sourceDb || !reportPath || existsSync(reportPath)) throw new Error('usage: seed <source-db> <new-report-file>');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const targetDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const tu = new URL(targetDsn);
const targetDb = decodeURIComponent(tu.pathname.slice(1));
if (!/^afldb_v2_.+_test$/.test(targetDb) || !/^afldb_v2_.+_test$/.test(sourceDb) || tu.hostname !== '127.0.0.1') throw new Error('Isolated afldb_v2_*_test databases required');
if (targetDb === sourceDb) throw new Error('Source and target must differ');
const su = new URL(targetDsn); su.pathname = `/${sourceDb}`;
const src = postgres(su.toString(), { max: 1, onnotice: () => {} });
const tgt = postgres(targetDsn, { max: 1, onnotice: () => {} });
const SCOPE = 'season=2025';
try {
  for (const [name, s] of [['source', src], ['target', tgt]] as const) {
    const [r] = await s`SELECT shobj_description(d.oid, 'pg_database') AS c FROM pg_database d WHERE d.datname = current_database()`;
    if (!String(r?.c ?? '').length) throw new Error(`${name} database carries no isolation marker`);
  }
  const [sid] = await src`SELECT id FROM sources WHERE key = 'afl_api'`;
  const [tid] = await tgt`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!sid || !tid || sid.id !== tid.id) throw new Error('afl_api source id differs between databases');
  const [have] = await tgt`SELECT count(*)::int AS n FROM staging.source_records WHERE source_id = ${tid.id} AND family = 'match' AND scope_key = ${SCOPE}`;
  if (have.n !== 0) throw new Error(`target already holds ${have.n} ${SCOPE} match observations; refusing to merge`);

  const records = await src`SELECT * FROM staging.source_records WHERE source_id = ${sid.id} AND family = 'match' AND scope_key = ${SCOPE} ORDER BY external_record_id`;
  const versions = await src`SELECT v.* FROM staging.source_record_versions v JOIN staging.source_records r USING (source_id, family, external_record_id)
    WHERE r.source_id = ${sid.id} AND r.family = 'match' AND r.scope_key = ${SCOPE} ORDER BY v.external_record_id, v.version_seq`;
  const hashes = [...new Set(versions.map((v) => v.payload_hash as string))];
  const payloads = await src`SELECT * FROM staging.source_payloads WHERE source_id = ${sid.id} AND family = 'match' AND payload_hash = ANY(${hashes})`;
  if (records.length !== 212 || payloads.length !== hashes.length) throw new Error(`unexpected source shape: ${records.length} records, ${payloads.length}/${hashes.length} payloads`);

  const result = await tgt.begin(async (tx) => {
    const [batch] = await tx`INSERT INTO import_batches (source_id, tool, target_table, started_at, completed_at, status, records_read, records_inserted, records_updated, records_rejected, validation_result, notes)
      VALUES (${tid.id}, 'brownlow-isolated-seed-2025-fixture-observations.mts', 'staging.source_record_versions', now(), now(), 'completed', ${records.length}, ${records.length}, 0, 0,
        ${tx.json({ simulated: true, copiedFromDatabase: sourceDb, scope: SCOPE })}, ${`SIMULATED PREREQUISITE (isolated rehearsal only): verbatim copy of ${records.length} afl_api match observations (${SCOPE}) from ${sourceDb}; stands in for settle-afl-api-fixtures.ts --apply on snapshot afl-api-2025-2026-10-20-014218, which is not retained`}) RETURNING id`;
    const batchId = String(batch.id);
    const copy = async (table: string, rows: readonly Record<string, unknown>[], remap: string[]) => {
      if (!rows.length) return 0;
      const out = rows.map((r) => { const c = { ...r }; for (const k of remap) if (c[k] !== null && c[k] !== undefined) c[k] = batchId; return c; });
      await tx.unsafe(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, ($1::text)::json)`, [JSON.stringify(out)]);
      return rows.length;
    };
    const p = await copy('staging.source_payloads', payloads, []);
    const v = await copy('staging.source_record_versions', versions, ['opened_by_batch_id', 'closed_by_batch_id']);
    const r = await copy('staging.source_records', records, ['last_batch_id']);
    return { batchId, payloads: p, versions: v, records: r };
  });
  const [after] = await tgt`SELECT count(*)::int AS n FROM staging.source_records WHERE source_id = ${tid.id} AND family = 'match' AND scope_key = ${SCOPE}`;
  writeFileSync(reportPath, `${JSON.stringify({ sourceDb, targetDb, scope: SCOPE, ...result, matchObservations2025AfterSeed: after.n, simulated: true }, null, 2)}\n`, { flag: 'wx' });
  console.log(`seeded ${JSON.stringify(result)}; target now holds ${after.n} ${SCOPE} afl_api match observations (SIMULATED prerequisite)`);
} finally {
  await src.end({ timeout: 5 }); await tgt.end({ timeout: 5 });
}
