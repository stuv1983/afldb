// hostops rehearsal helper: create afldb_restore_test on the ISOLATED cluster only (port 55620 asserted).
// restore-test.sh restores into the FIXED name afldb_restore_test, which tools/v2/isolated-pg.ts create-db refuses
// (it only creates afldb_v2_*_test): an explicit, recorded exception to the run's naming rule (plan review H-2).
// Reads the superuser password from the isolated cluster's own secrets directory; prints no secret and no DSN.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.AFLDB_V2_PG_ROOT;
const port = Number(process.env.AFLDB_V2_PG_PORT);
if (!root || port !== 55620) throw new Error(`refused: expected the isolated cluster on 55620, got ${process.env.AFLDB_V2_PG_PORT}`);
const pid = readFileSync(join(root, 'data', 'postmaster.pid'), 'utf8').split('\n');
if (Number(pid[3]) !== port) throw new Error(`refused: postmaster.pid says port ${pid[3]}`);
const require = createRequire(join(process.cwd(), 'package.json'));
const postgres = require('postgres');
const pw = readFileSync(join(root, 'secrets', 'superuser.pw'), 'utf8').trim();
const url = (db) => `postgresql://afldb_v2_super:${encodeURIComponent(pw)}@127.0.0.1:${port}/${db}`;
const admin = postgres(url('postgres'), { max: 1, onnotice: () => {} });
try {
  const [id] = await admin`SELECT current_setting('port') AS port, current_setting('listen_addresses') AS listen`;
  if (id.port !== String(port) || id.listen !== '127.0.0.1') throw new Error(`refused: server answers port ${id.port} listen ${id.listen}`);
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = 'afldb_restore_test'`;
  if (!exists) await admin.unsafe('CREATE DATABASE afldb_restore_test OWNER afldb_owner');
  console.log(`afldb_restore_test ${exists ? 'already present' : 'created'} on isolated cluster port ${id.port}`);
} finally {
  await admin.end({ timeout: 5 });
}
const db = postgres(url('afldb_restore_test'), { max: 1, onnotice: () => {} });
try {
  // The same bootstrap tools/maintenance/01_setup_service.sh gives the production copy: extensions owned by the superuser.
  await db.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;
    ALTER SCHEMA public OWNER TO afldb_owner; GRANT CREATE ON SCHEMA public TO afldb_owner;`);
  console.log('afldb_restore_test bootstrapped (extensions owned by the superuser, as on production)');
} finally {
  await db.end({ timeout: 5 });
}
