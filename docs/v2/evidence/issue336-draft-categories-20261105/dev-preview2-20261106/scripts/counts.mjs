// READ-ONLY row counts and migration ledger, for proving a DEV backup restores to the same content.
// Usage: node counts.mjs <ENV_VAR_HOLDING_THE_DSN> [label]
//   live DEV (owner's deployment day): AFLDB_BACKUP_DATABASE_URL from DEV's .env, exported into this process only;
//   isolated restore: AFLDB_TEST_DATABASE_URL, set by `tools/v2/isolated-pg.ts run`.
// The DSN is never printed. Every statement runs in a READ ONLY transaction. `postgres` is resolved from the WORKING directory's
// node_modules (an ES module would otherwise resolve it beside this file), so run it from a checkout; nothing is written there.
import { createRequire } from 'node:module';
import { join } from 'node:path';
const postgres = createRequire(join(process.cwd(), 'package.json'))('postgres');

const dsnVar = process.argv[2];
const raw = dsnVar ? process.env[dsnVar] : undefined;
if (!raw) throw new Error(`usage: counts.mjs <DSN env var>; ${dsnVar ?? '(none)'} is not set`);
const url = new URL(raw);
const db = decodeURIComponent(url.pathname.slice(1));
if (dsnVar === 'AFLDB_BACKUP_DATABASE_URL' && db !== 'afldb_dev') throw new Error(`refusing: ${db} is not afldb_dev`);
if (dsnVar === 'AFLDB_TEST_DATABASE_URL' && !/^afldb_v2_.+_test$/.test(db)) throw new Error('refusing: not an isolated _test database');

const TABLES = [
  'players', 'matches', 'player_match_stats', 'match_period_scores', 'draft_picks', 'draft_persons', 'data_overrides',
  'data_edits', 'import_batches', 'site_settings', 'auth_users', 'venues', 'venue_name_spans', 'fixtures',
  'brownlow_round_votes', 'award_winners', 'staging.afl_api_match', 'staging.afl_api_brownlow_vote',
];
const sql = postgres(raw, { max: 1, onnotice: () => {} });
try {
  const out = await sql.begin('read only', async (tx) => {
    const counts = {};
    for (const t of TABLES) {
      const [{ reg }] = await tx`SELECT to_regclass(${t})::text AS reg`;
      counts[t] = reg === null ? null : (await tx.unsafe(`SELECT count(*)::bigint::text AS n FROM ${reg}`))[0].n;
    }
    const [ledger] = await tx`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations`;
    const [at] = await tx`SELECT now()::text AS now`;
    return { label: process.argv[3] ?? null, database: db, readAt: at.now, ledger, counts };
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sql.end();
}
