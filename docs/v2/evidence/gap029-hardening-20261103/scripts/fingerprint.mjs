// Prints a one-line fingerprint of the GAP-029 write surfaces of the database in AFLDB_TEST_DATABASE_URL (read-only), so a negative control can prove
// it changed nothing. Usage (inside `isolated-pg run <db> --`): node fingerprint.mjs
import postgres from 'postgres';

const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
const [r] = await sql`SELECT
  (SELECT count(*) FROM import_batches)::int AS batches,
  (SELECT coalesce(max(id), 0) FROM data_edits)::int AS edits,
  (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) FROM draft_picks t) AS picks,
  (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) FROM captaincies t) AS captaincies,
  (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) FROM player_relationships t) AS relationships,
  (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) FROM data_overrides t) AS overrides`;
console.log(`${r.batches}:${r.edits}:${r.picks}:${r.captaincies}:${r.relationships}:${r.overrides}`);
await sql.end({ timeout: 2 });
