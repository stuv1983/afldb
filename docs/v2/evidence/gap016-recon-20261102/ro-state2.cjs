// Read-only production probe 2: the twelve + winner identities and a refined round-vs-season comparison.
const fs = require('fs'); const { createRequire } = require('module');
const req = createRequire('/home/arm/projects/afldb/package.json'); const postgres = req('postgres');
(async () => {
  const env = fs.readFileSync('/home/arm/projects/afldb/.env', 'utf8').split('\n');
  const l = env.filter((x) => x.startsWith('AFLDB_BACKUP_DATABASE_URL='));
  const sql = postgres(l[0].slice(26).replace(/^"(.*)"$/, '$1'), { max: 1, connection: { default_transaction_read_only: 'on', statement_timeout: '60000' } });
  const q = async (label, text) => { try { const rows = await sql.unsafe(text); console.log('## ' + label); console.log(JSON.stringify(rows)); } catch (e) { console.log('## ' + label + ' ERROR ' + e.message); } };
  await q('players columns', `SELECT column_name FROM information_schema.columns WHERE table_name='players' AND column_name IN ('id','slug','display_name','full_name','first_name','last_name') ORDER BY 1`);
  await q('refined round vs season (1984-2025)', `WITH r AS (SELECT season, player_id, sum(votes)::int AS rv FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 GROUP BY 1,2), s AS (SELECT season, player_id, votes FROM brownlow_season_votes WHERE season BETWEEN 1984 AND 2025) SELECT count(*) AS pairs, count(*) FILTER (WHERE r.rv IS NOT NULL AND s.votes IS NOT NULL AND r.rv<>s.votes) AS value_differs, count(*) FILTER (WHERE s.votes IS NULL AND r.rv>0) AS round_positive_without_season_row, count(*) FILTER (WHERE r.rv IS NULL) AS season_row_without_round, count(*) FILTER (WHERE s.votes IS NULL AND r.rv=0) AS round_zero_only FROM r FULL JOIN s USING (season, player_id)`);
  await q('differing pairs sample', `WITH r AS (SELECT season, player_id, sum(votes)::int AS rv FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 GROUP BY 1,2), s AS (SELECT season, player_id, votes FROM brownlow_season_votes WHERE season BETWEEN 1984 AND 2025) SELECT season, player_id, r.rv, s.votes FROM r FULL JOIN s USING (season, player_id) WHERE (r.rv IS NOT NULL AND s.votes IS NOT NULL AND r.rv<>s.votes) OR (s.votes IS NULL AND r.rv>0) OR r.rv IS NULL ORDER BY 1,2 LIMIT 40`);
  await q('seasons with season_votes but no round votes (1984+)', `SELECT s.season FROM (SELECT DISTINCT season FROM brownlow_season_votes WHERE season>=1984) s WHERE NOT EXISTS (SELECT 1 FROM brownlow_round_votes r WHERE r.season=s.season) ORDER BY 1`);
  await q('the twelve + winner + runner-up identities', `SELECT s.player_id, p.slug, p.display_name, s.votes, s.vote_rank, s.eligible_rank, s.is_ineligible, s.is_winner FROM brownlow_season_votes s JOIN players p ON p.id=s.player_id WHERE s.season=2025 AND (s.is_ineligible OR s.is_winner OR s.player_id=9910) ORDER BY s.is_ineligible, s.votes DESC, s.player_id`);
  await q('players with brownlow medals (winner count)', `SELECT count(DISTINCT player_id) AS distinct_winners, count(*) AS winner_rows FROM brownlow_season_votes WHERE is_winner`);
  await sql.end({ timeout: 2 });
})().catch((e) => { console.error('ro failed:', e.message); process.exit(1); });
