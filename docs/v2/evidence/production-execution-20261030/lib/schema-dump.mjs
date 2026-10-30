// Complete schema text (shadow-restore.sh S5, unchanged options), as afldb_owner through isolated-pg.
//   node schema-dump.mjs <out.sql>
import { spawnSync } from 'node:child_process';
const u = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
const result = spawnSync(process.env.AFLDB_V2_PG_BIN + '/pg_dump', ['--schema-only', '--no-owner', '--file', process.argv[2],
  u.pathname.slice(1)], { stdio: 'inherit', env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) } });
process.exit(result.status ?? 2);
