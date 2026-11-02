// Identical read-only digest queries for live production and the restored copy. DSN: argv[2] = env var name, or --prod (reads AFLDB_BACKUP_DATABASE_URL from the checkout .env).
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
let dsn;
if (process.argv[2] === '--prod') {
  const l = readFileSync('/home/arm/projects/afldb/.env', 'utf8').split('\n').filter((x) => x.startsWith('AFLDB_BACKUP_DATABASE_URL='));
  dsn = l[0].slice(26).replace(/^"(.*)"$/, '$1');
} else dsn = process.env.AFLDB_TEST_DATABASE_URL;
const sql = postgres(dsn, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: 'on', statement_timeout: '120000' } });
const dig = (label, text) => sql.unsafe(`SELECT '${label}' AS label, count(*)::text AS n, md5(coalesce(string_agg(h, '|' ORDER BY h), '')) AS d FROM (${text}) t(h)`).then((r) => console.log(JSON.stringify(r[0])));
const [{ db }] = await sql`SELECT current_database() AS db`;
console.log('db=' + db);
await dig('season_votes', `SELECT md5(to_jsonb(x)::text) FROM (SELECT season, player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner FROM brownlow_season_votes) x`);
await dig('round_votes_1984_2025', `SELECT md5(to_jsonb(x)::text) FROM (SELECT * FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025) x`);
await dig('round_votes_2026', `SELECT md5(to_jsonb(x)::text) FROM (SELECT * FROM brownlow_round_votes WHERE season = 2026) x`);
await dig('eligibility_decisions', `SELECT md5(to_jsonb(x)::text) FROM (SELECT id, season, player_id_at_decision, verdict, basis, decided_by, supersedes_id FROM brownlow_eligibility_decisions) x`);
await dig('winners', `SELECT season::text || ':' || player_id::text FROM brownlow_season_votes WHERE is_winner`);
await dig('correction_receipts', `SELECT operation || ':' || plan_digest || ':' || before_digest || ':' || after_digest FROM brownlow_correction_receipts`);
await sql.end({ timeout: 2 });
