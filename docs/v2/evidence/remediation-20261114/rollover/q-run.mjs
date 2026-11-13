// AFLDB-ISSUE-350 evidence helper: runs q-public-effects.sql (SELECTs only) in ONE read-only transaction and prints one
// `a|b|c` line per row, as psql -A -t would. The DSN is read from the environment variable named by argv[3]; it is never printed.
//   node q-run.mjs <sql-file> <dsn-env> [TimeZone]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [, , file, dsnEnv, tz = 'Etc/UTC'] = process.argv;
const require = createRequire(`${process.cwd()}/package.json`);
const postgres = require('postgres');
const text = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(--|\\)/.test(l)).join('\n');
const statements = text.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
for (const s of statements) if (!/^select\b/i.test(s)) { console.error('refusing a non-SELECT statement'); process.exit(2); }
const sql = postgres(process.env[dsnEnv], { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: tz } });
try {
  await sql.begin('isolation level repeatable read read only', async (tx) => {
    for (const s of statements) {
      const rows = await tx.unsafe(s).values();
      for (const r of rows) console.log(r.map((v) => (v instanceof Date ? v.toISOString() : v === null ? '' : String(v))).join('|'));
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}
