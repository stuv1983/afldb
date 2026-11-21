// ISSUE-363 G-1 PROTOTYPE ONLY (2026-11-21): prepares an isolated afldb_v2_*_test clone for a --rehearsal run of the existing audited
// tool tools/v2/gap029-rookie-selections-production.ts (the eight reviewed Rookie selections, data/players/rookie-relisting-outcomes.csv).
// Writes <out>/target.json (the target identity the tool binds to, same query as tools/v2/gap029-rookie-selections-rehearsal.mts) and
// creates ONE clone-local Super Admin actor exactly as that rehearsal's fixtures do (non-reserved domain, placeholder credentials), because
// a source-only rebuild holds no auth_users rows. Refuses anything but an isolated afldb_v2_*_test database. Prints the actor id.
// Run only via: node --import tsx tools/v2/isolated-pg.ts run <db> -- node overlay-rookie-prep.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || !/\/afldb_v2_[a-z0-9_]+_test$/.test(ownerDsn)) throw new Error('isolated afldb_v2_*_test target required');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const postgres = createRequire('/mnt/ssd/afldb-i363-20261121/cand/package.json')('postgres');
const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
try {
  const u = new URL(ownerDsn);
  const [facts] = await sql`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
    current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment" FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
  writeFileSync(join(out, 'target.json'), JSON.stringify({ host: u.hostname, port: Number(u.port), ...facts }, null, 2));
  await sql`INSERT INTO auth_users (email, role, password_hash, totp_secret) VALUES ('tier-p-overlay@gap029-rehearsal.net', 'super_admin', 'x$1$1$1$x', 'JBSWY3DPEHPK3PXP')
            ON CONFLICT (email) DO NOTHING`;
  const [a] = await sql`SELECT id::int AS id FROM auth_users WHERE email = 'tier-p-overlay@gap029-rehearsal.net'`;
  await sql`SELECT assert_viable_super_admin_actor(${a.id})`;
  console.log(a.id);
} finally { await sql.end(); }
