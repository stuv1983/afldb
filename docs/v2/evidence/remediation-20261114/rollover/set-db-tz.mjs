// AFLDB-ISSUE-350 rehearsal helper (O-3): make Australia/Melbourne the DATABASE default time zone of one disposable isolated database
// (production's host zone), so the rehearsal shows the tools' per-connection TimeZone=Etc/UTC pin overriding it. Refuses anything that is not
// an isolated afldb_v2_*_test database. Reads the owner DSN from the environment variable named by argv[2]; prints no DSN.
//   node set-db-tz.mjs <dsn-env> [zone]
import { createRequire } from 'node:module';

const [, , dsnEnv, zone = 'Australia/Melbourne'] = process.argv;
const require = createRequire(`${process.cwd()}/package.json`);
const postgres = require('postgres');
const sql = postgres(process.env[dsnEnv], { max: 1, onnotice: () => {} });
try {
  const [{ d }] = await sql`SELECT current_database() AS d`;
  if (!/^afldb_v2_[a-z0-9_]+_test$/.test(d)) throw new Error(`refusing: ${d} is not an isolated rehearsal database`);
  if (!/^[A-Za-z_/+-]+$/.test(zone)) throw new Error('bad zone');
  await sql.unsafe(`ALTER DATABASE ${d} SET timezone = '${zone}'`);
  console.log(`database ${d} default TimeZone set to ${zone}`);
} finally {
  await sql.end({ timeout: 5 });
}
