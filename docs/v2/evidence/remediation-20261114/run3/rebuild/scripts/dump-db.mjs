// Dumps the isolated database named by AFLDB_TEST_DATABASE_URL (custom format, no owner stripping, ACLs and
// comments as they rest). Run via: isolated-pg run <db> -- node dump-db.mjs <out.dump>
// Credentials travel only in the child's environment, never in argv.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [out] = process.argv.slice(2);
if (!out) throw new Error('usage: dump-db.mjs <out.dump>');
if (existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const db = decodeURIComponent(url.pathname.slice(1));
if (!/^afldb_v2_.+_test$/.test(db) || url.hostname !== '127.0.0.1') throw new Error('isolated target required');
const bin = process.env.AFLDB_V2_PG_BIN;
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const t0 = Date.now();
const r = spawnSync(join(bin, 'pg_dump'), ['--no-password', '-Fc', '-f', out, '-d', db], { env, encoding: 'utf8' });
console.log(`pg_dump exit=${r.status} seconds=${Math.round((Date.now() - t0) / 1000)} stderrLines=${(r.stderr ?? '').split('\n').filter(Boolean).length}`);
if (r.status !== 0) { console.log((r.stderr ?? '').replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 400)); process.exit(1); }
console.log(`db=${db} bytes=${statSync(out).size} sha256=${createHash('sha256').update(readFileSync(out)).digest('hex')}`);
