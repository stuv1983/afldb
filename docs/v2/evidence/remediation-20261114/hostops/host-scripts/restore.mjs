// Restores a verified dump into the launcher-proved isolated database. Usage (via isolated-pg run <db> --): node restore.mjs <dump> <expected-sha256>
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
const exe = process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore';
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const t0 = Date.now();
const r = spawnSync(join(bin, exe), ['--no-password', '--no-comments', '--no-owner', '-j', '4', '-d', db, dump], { env, encoding: 'utf8' });
const err = (r.stderr ?? '').split('\n').filter(Boolean);
console.log(`pg_restore exit=${r.status} seconds=${Math.round((Date.now() - t0) / 1000)} stderrLines=${err.length}`);
for (const l of err.slice(0, 6)) console.log(`  ${l.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 160)}`);
process.exit(r.status === 0 || err.length <= 6 ? 0 : 1);
