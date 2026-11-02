// Read-only production Brownlow state probe (afldb_backup role, read-only session). Prints no secrets.
const fs = require('fs'); const { createRequire } = require('module');
const req = createRequire('/home/arm/projects/afldb/package.json'); const postgres = req('postgres');
(async () => {
  const env = fs.readFileSync('/home/arm/projects/afldb/.env', 'utf8').split('\n');
  const l = env.filter((x) => x.startsWith('AFLDB_BACKUP_DATABASE_URL='));
  const sql = postgres(l[0].slice(26).replace(/^"(.*)"$/, '$1'), { max: 1, connection: { default_transaction_read_only: 'on', statement_timeout: '60000' } });
  const q = async (label, text) => { try { const rows = await sql.unsafe(text); console.log('## ' + label); console.log(JSON.stringify(rows)); } catch (e) { console.log('## ' + label + ' ERROR ' + e.message); } };
  await q('identity', `SELECT current_database() AS db, (SELECT oid FROM pg_database WHERE datname=current_database()) AS oid, current_setting('transaction_read_only') AS ro, current_setting('TimeZone') AS tz, now() AS now`);
  await q('ledger', `SELECT count(*) AS rows, max(name) AS last FROM afldb_meta.schema_migrations`);
  await q('receipts', `SELECT operation, count(*) AS n, left(max(plan_digest),12) AS plan, left(max(after_digest),12) AS after FROM brownlow_correction_receipts GROUP BY operation ORDER BY 1`);
  await q('latest receipt after digest', `SELECT after_digest FROM brownlow_correction_receipts ORDER BY applied_at DESC LIMIT 1`);
  await q('season_votes coverage', `SELECT count(DISTINCT season) AS seasons, min(season) AS min, max(season) AS max, count(*) AS rows FROM brownlow_season_votes`);
  await q('season_votes winners per season (anomalies only)', `SELECT season, count(*) FILTER (WHERE is_winner) AS winners FROM brownlow_season_votes GROUP BY season HAVING count(*) FILTER (WHERE is_winner) <> 1 ORDER BY season`);
  await q('seasons with a joint winner', `SELECT season, count(*) AS winners FROM brownlow_season_votes WHERE is_winner GROUP BY season HAVING count(*)>1 ORDER BY season`);
  await q('ineligible flagged per season', `SELECT season, count(*) AS flagged FROM brownlow_season_votes WHERE is_ineligible GROUP BY season ORDER BY season`);
  await q('round_votes coverage', `SELECT count(*) AS rows, count(DISTINCT season) AS seasons, min(season) AS min, max(season) AS max, count(*) FILTER (WHERE match_id IS NOT NULL) AS with_match, count(*) FILTER (WHERE season=2026) AS r2026, count(*) FILTER (WHERE season=2026 AND match_id IS NOT NULL) AS r2026_match FROM brownlow_round_votes`);
  await q('round vs season totals disagreeing (seasons with round votes, per player)', `WITH r AS (SELECT season, player_id, sum(votes)::int AS rv FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 GROUP BY 1,2), s AS (SELECT season, player_id, votes FROM brownlow_season_votes WHERE season BETWEEN 1984 AND 2025) SELECT count(*) AS compared, count(*) FILTER (WHERE r.rv IS DISTINCT FROM s.votes) AS differ, count(*) FILTER (WHERE r.rv IS NULL) AS season_only, count(*) FILTER (WHERE s.votes IS NULL) AS round_only FROM r FULL JOIN s USING (season, player_id)`);
  await q('2025 winner', `SELECT player_id, votes, eligible_rank, is_winner FROM brownlow_season_votes WHERE season=2025 AND is_winner`);
  await q('2025 top5', `SELECT player_id, votes, vote_rank, eligible_rank, is_ineligible FROM brownlow_season_votes WHERE season=2025 ORDER BY votes DESC, player_id LIMIT 5`);
  await q('decisions', `SELECT count(*) AS n, count(*) FILTER (WHERE verdict='ineligible') AS ineligible, min(id) AS min_id, max(id) AS max_id, count(*) FILTER (WHERE supersedes_id IS NOT NULL) AS superseded FROM brownlow_eligibility_decisions`);
  await q('2025 ownership', `SELECT count(*) FILTER (WHERE source_id IS NOT NULL) AS sourced, count(*) FILTER (WHERE source_id IS NULL) AS sourceless, count(*) FILTER (WHERE source_id IS NULL AND votes>0) AS sourceless_positive FROM brownlow_round_votes WHERE season=2025`);
  await q('2026 digest', `SELECT count(*)||':'||md5(coalesce(string_agg(md5(to_jsonb(x)::text), '|' ORDER BY md5(to_jsonb(x)::text)), '')) AS d FROM brownlow_round_votes x WHERE season = 2026`);
  await q('unresolved settle issues', `SELECT count(*) AS n FROM data_issues WHERE issue_type='afl_api_brownlow_settle' AND resolved_at IS NULL`);
  await sql.end({ timeout: 2 });
})().catch((e) => { console.error('ro failed:', e.message); process.exit(1); });
