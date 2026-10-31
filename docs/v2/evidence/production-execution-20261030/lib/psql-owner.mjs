// psql against the isolated database isolated-pg names, as afldb_owner (default) or, with PSQL_ROLE=afldb_backup,
// as the read-only principal in a read-only session (the production read-back principal). The password
// reaches psql through its environment only.   node psql-owner.mjs <psql args...>
import { spawnSync } from 'node:child_process';
const role = process.env.PSQL_ROLE ?? 'afldb_owner';
const key = { afldb_owner: 'AFLDB_OWNER_DATABASE_URL', afldb_backup: 'AFLDB_BACKUP_DATABASE_URL' }[role];
if (!key || !process.env[key] || process.env.AFLDB_V2_ISOLATED_PG !== '1') { process.stderr.write('psql-owner: run through isolated-pg\n'); process.exit(2); }
const u = new URL(process.env[key]);
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
if (role === 'afldb_backup') env.PGOPTIONS = '-c default_transaction_read_only=on';
const r = spawnSync(process.env.AFLDB_V2_PG_BIN + '/psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(r.status ?? 2);
