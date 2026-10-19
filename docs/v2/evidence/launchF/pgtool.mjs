// usage: node pgtool.mjs <exe> [args...]; the isolated owner DSN is appended (psql: first) from the env.
import { spawnSync } from 'node:child_process';
const [exe, ...args] = process.argv.slice(2);
const dsn = process.env.AFLDB_TEST_DATABASE_URL;
const full = /psql.exe$/i.test(exe) ? ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args, dsn] : [...args, dsn];
const r = spawnSync(exe, full, { stdio: 'inherit', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
