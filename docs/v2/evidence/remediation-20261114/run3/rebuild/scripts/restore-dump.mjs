// Restores afldb_v2_rb_rem3-<R>.dump into the isolated database named by AFLDB_TEST_DATABASE_URL.
// Run only via: node --import tsx tools/v2/isolated-pg.ts run <db> -- node restore-dump.mjs <dump> <expected-sha256>
// Target must be a FRESH marked database made by `isolated-pg create-db <db>` (it already carries pg_trgm/unaccent and the
// schema grants). Credentials travel only in the child's environment, never in argv.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [dump, expected] = process.argv.slice(2);
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const sha = createHash('sha256').update(readFileSync(dump)).digest('hex');
if (sha !== expected) throw new Error(`dump sha256 ${sha} != expected ${expected}`);
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const db = decodeURIComponent(url.pathname.slice(1));
if (!/^afldb_v2_.+_test$/.test(db) || url.hostname !== '127.0.0.1') throw new Error('isolated target required');
const bin = process.env.AFLDB_V2_PG_BIN;
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const t0 = Date.now();
// --no-owner: objects are owned by the restoring role (afldb_owner); --no-comments: the isolated-pg marker comes from create-db.
const r = spawnSync(join(bin, 'pg_restore'), ['--no-password', '--no-comments', '--no-owner', '-j', '4', '-d', db, dump], { env, encoding: 'utf8' });
const err = (r.stderr ?? '').split('\n').filter(Boolean);
console.log(`pg_restore exit=${r.status} seconds=${Math.round((Date.now() - t0) / 1000)} stderrLines=${err.length}`);
for (const l of err.slice(0, 12)) console.log(`  ${l.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 200)}`);
// Expected benign noise: CREATE EXTENSION / SCHEMA public "already exists" from the create-db bootstrap.
process.exit(r.status === 0 ? 0 : 1);
