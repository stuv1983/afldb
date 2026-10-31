// Restored ledger equals the observed ledger in a sidecar (shadow-restore.sh S4). stdin module, run from src.
//   isolated-pg run <db> -- node --input-type=module - <file.json with observed_ledger> < ledger-check.mjs
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const want = JSON.parse(readFileSync(process.argv[2], 'utf8')).observed_ledger;
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const got = await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name`;
  const w = new Map(want.map((r) => [r.name, r.checksum]));
  const bad = got.filter((r) => w.get(r.name) !== r.checksum).map((r) => r.name);
  const missing = want.filter((r) => !got.some((g) => g.name === r.name)).map((r) => r.name);
  console.log(JSON.stringify({ restored: got.length, sidecar: want.length, last: got.at(-1)?.name, mismatched: bad, missing }));
  process.exitCode = bad.length || missing.length || got.length !== want.length ? 1 : 0;
} finally { await sql.end(); }
