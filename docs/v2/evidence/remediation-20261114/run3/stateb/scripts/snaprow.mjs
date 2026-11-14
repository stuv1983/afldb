// Aggregates only (counts, md5, ids). Run through: isolated-pg run <db> -- node $W/in/snaprow.mjs [label]
import { createRequire } from 'node:module';
const require = createRequire('/mnt/ssd/afldb-rem3-stateb-20261114/cand/package.json');
const postgres = require('postgres');
const label = process.argv[2] ?? '';
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const sql = postgres(url.toString(), { max: 1, onnotice: () => {}, connect_timeout: 10 });
try {
  const [db] = await sql`SELECT current_database() AS db`;
  const [r] = await sql`
    SELECT
      (SELECT count(*) FROM external_identities e WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND e.external_id = 'CD_I297354')::int AS "snapshotRows",
      (SELECT md5(to_jsonb(e)::text) FROM external_identities e WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND e.external_id = 'CD_I297354') AS "snapshotRowMd5",
      (SELECT player_id FROM external_identities e WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND e.external_id = 'CD_I297354') AS "snapshotPlayerId",
      (SELECT count(*) FROM external_identities)::int AS "externalIdentitiesTotal",
      (SELECT count(*) FROM external_identities WHERE source_id = (SELECT id FROM sources WHERE key = 'afl_api'))::int AS "aflApiIdentities",
      (SELECT count(*) FROM external_identities e WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND e.external_id = 'CD_I2071275001')::int AS "ownIdRows",
      (SELECT min(length(external_id)) FROM external_identities WHERE source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND external_id ~ '^CD_I[0-9]+$')::int AS "minCdILen",
      (SELECT max(length(external_id)) FROM external_identities WHERE source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND external_id ~ '^CD_I[0-9]+$')::int AS "maxCdILen",
      (SELECT count(*) FROM seasons WHERE year >= 2060)::int AS "fixtureSeasonsLeft",
      (SELECT count(*) FROM players WHERE legacy_player_id = -275000001)::int AS "ownPlayers",
      (SELECT count(*) FROM matches)::int AS "matches"
  `;
  console.log(label, db.db, JSON.stringify(r));
} catch (e) {
  console.log(label, 'ERR', String(e.message).slice(0, 200));
} finally {
  await sql.end({ timeout: 2 });
}
