// AFLDB-ISSUE-350 evidence helper: runs ONE reviewed SQL file in ONE transaction (simple query protocol, so a DO block is fine), printing server
// notices, and rolls back (never commits) unless the third argument is `commit`. The DSN is read from the environment variable named by argv[3];
// it is never printed. Used for the reversal rehearsal on a disposable clone only.
//   node run-sql.mjs <sql-file> <dsn-env> [commit]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [, , file, dsnEnv, mode = 'rollback'] = process.argv;
const require = createRequire(`${process.cwd()}/package.json`);
const postgres = require('postgres');
const sql = postgres(process.env[dsnEnv], { max: 1, onnotice: (n) => console.log(`NOTICE: ${n.message}`), connection: { TimeZone: 'Etc/UTC' } });
class Rollback extends Error {}
try {
  await sql.begin(async (tx) => {
    const [{ db }] = await tx`SELECT current_database() AS db`;
    if (!/^afldb_v2_.*_test$/.test(db)) throw new Error(`refusing: ${db} is not an isolated rehearsal database`);
    await tx.unsafe(readFileSync(file, 'utf8'));
    if (mode !== 'commit') throw new Rollback('dry');
  });
  console.log('COMMITTED');
} catch (e) {
  if (e instanceof Rollback) console.log('ROLLED BACK (dry run)');
  else { console.log('REFUSED/ERROR:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 400)); process.exitCode = 1; }
} finally {
  await sql.end({ timeout: 5 });
}
