// READ-ONLY consistent backup of the DEV database as the afldb_backup role. Run with DEV's .env exported into THIS process only.
// The DSN is parsed into PG* variables of the pg_dump child; it is never put in argv and never printed.
// Usage: node dump-dev.cjs <out.dump>
const { spawnSync } = require('node:child_process');
const out = process.argv[2];
if (!out) throw new Error('usage: dump-dev.cjs <out.dump>');
const raw = process.env.AFLDB_BACKUP_DATABASE_URL;
if (!raw) throw new Error('AFLDB_BACKUP_DATABASE_URL absent');
const u = new URL(raw);
const db = decodeURIComponent(u.pathname.slice(1));
if (db !== 'afldb_dev') throw new Error(`refusing: backup DSN names ${db}, expected afldb_dev`);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', PGHOST: u.hostname, PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: db, PGAPPNAME: 'afldb-i336-preview-backup' };
const t0 = Date.now();
const r = spawnSync('/usr/lib/postgresql/16/bin/pg_dump', ['--no-password', '-Fc', '-f', out], { env, encoding: 'utf8' });
const err = (r.stderr || '').split('\n').filter(Boolean).map((l) => l.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>'));
console.log(JSON.stringify({ role: env.PGUSER, database: db, host: u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? 'loopback' : 'non-loopback', exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), stderr: err.slice(0, 5) }));
process.exit(r.status === 0 ? 0 : 1);
