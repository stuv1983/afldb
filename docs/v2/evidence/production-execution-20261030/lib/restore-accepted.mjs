// Accepted shadow restore (shadow-restore.sh S4, unchanged options): run through isolated-pg as afldb_owner.
//   node restore-accepted.mjs <archive.dump> <restore.toc>
import { spawnSync } from 'node:child_process';
const u = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
const result = spawnSync(process.env.AFLDB_V2_PG_BIN + '/pg_restore', ['--dbname', u.pathname.slice(1), '--no-owner',
  '--no-privileges', '--exit-on-error', '--use-list', process.argv[3], process.argv[2]], {
  stdio: 'inherit', env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) },
});
process.exit(result.status ?? 2);
