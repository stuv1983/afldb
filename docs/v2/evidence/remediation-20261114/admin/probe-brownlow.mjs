// Read-only probe on the disposable snapshot copy: how do Brownlow round rows relate to player_match_stats rows?
// Aggregates only. Run: RUNDB <db> node probe-brownlow.mjs
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const out = {};
out.roundRows = (await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE match_id IS NULL)::int AS null_match,
         count(*) FILTER (WHERE votes IS NULL)::int AS null_votes,
         count(*) FILTER (WHERE votes = 0)::int AS zero_votes,
         count(*) FILTER (WHERE votes > 0)::int AS positive_votes,
         count(*) FILTER (WHERE played)::int AS played
    FROM brownlow_round_votes`)[0];
out.pmsWithRoundRow = (await sql`
  SELECT count(*)::int AS pms_rows_with_round_row,
         count(*) FILTER (WHERE b.votes > 0)::int AS with_positive,
         count(*) FILTER (WHERE b.votes = 0)::int AS with_zero,
         count(*) FILTER (WHERE b.votes IS NULL)::int AS with_null
    FROM player_match_stats p
    JOIN brownlow_round_votes b ON b.match_id = p.match_id AND b.player_id = p.player_id`)[0];
out.roundRowsWithoutPms = (await sql`
  SELECT count(*)::int AS n FROM brownlow_round_votes b
   WHERE b.match_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = b.match_id AND p.player_id = b.player_id)`)[0];
out.entryState = await sql`SELECT status, count(*)::int AS n FROM brownlow_vote_entry_state GROUP BY 1 ORDER BY 1`;
out.periodStats = (await sql`
  SELECT count(*)::int AS rows, count(DISTINCT match_id)::int AS matches FROM player_match_period_stats`)[0];
out.periodRowsWithoutPms = (await sql`
  SELECT count(*)::int AS n FROM player_match_period_stats s
   WHERE NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = s.match_id AND p.player_id = s.player_id)`)[0];
out.achievements = (await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='active')::int AS active FROM player_achievements`)[0];
out.siren = (await sql`SELECT count(*)::int AS n FROM after_siren_kicks`)[0];
console.log(JSON.stringify(out, null, 1));
await sql.end({ timeout: 2 });
