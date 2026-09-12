-- AFLDB-ISSUE-137 §5 step 13 / runbook §8.9 item 2.
-- Post-settle verification for the first nightly settle AFTER the 2026-09-04 repair
-- (T1 batch 741, Brownlow loader batch 742). Scheduled settle: 2026-09-05 04:31 AEST.
--
-- READ-ONLY BY CONSTRUCTION: the session is pinned to default_transaction_read_only = on
-- and the script issues nothing but SELECT. Run as a role that can read the tables
-- (afldb_owner is what the earlier stages used).
--
--   psql -v ON_ERROR_STOP=1 -X -q -f i137_settle_check.sql -d "$AFLDB_OWNER_DATABASE_URL"
--
-- Read the VERDICT table at the end: every row must read PASS. A row reading CHECK is a
-- stop condition -- persist the exact output before doing anything else.

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

\echo '### session'
SELECT current_database() AS db, current_user AS role,
       current_setting('default_transaction_read_only') AS ro,
       now() AT TIME ZONE 'Australia/Melbourne' AS local_time;

\echo ''
\echo '### 1. settle batch (expect a new completed row with id > 742, dated 2026-09-05)'
SELECT id, tool, target_table, status, records_read, records_inserted, records_updated,
       records_rejected, started_at AT TIME ZONE 'Australia/Melbourne' AS started_local,
       completed_at AT TIME ZONE 'Australia/Melbourne' AS completed_local
  FROM import_batches WHERE id > 742 ORDER BY id;

\echo ''
\echo '### 1b. rejection rows for any batch after 742'
SELECT b.id AS batch_id, count(r.*) AS rejections
  FROM import_batches b LEFT JOIN import_rejections r ON r.import_batch_id = b.id
 WHERE b.id > 742 GROUP BY b.id ORDER BY b.id;

\echo ''
\echo '### 2. the four repaired careers (expect 2604 / 6293 / 6521 / 6622 present, final_season 2026;'
\echo '###    2608 / 6296 / 6525 / 6626 absent)'
SELECT id, display_name, dob, debut_season, final_season
  FROM players WHERE id IN (2604,2608,6293,6296,6521,6525,6622,6626) ORDER BY id;

\echo ''
\echo '### 3. identity rows for the eight AFL Tables paths (expect both paths per career id, status unique)'
SELECT ei.player_id, ei.external_id, ei.status
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afltables'
   AND ei.external_id IN ('players/C/Charlie_Cameron.html','players/C/Charlie_Cameron3.html',
                          'players/J/Jack_Graham.html','players/J/Jack_Graham2.html',
                          'players/J/Jack_Ross.html','players/J/Jack_Ross3.html',
                          'players/J/Jack_Williams.html','players/J/Jack_Williams3.html')
 ORDER BY ei.external_id;

\echo ''
\echo '### 4. settle projections + canonical match rows per career id (may GROW with new 2026 matches)'
SELECT p.id, p.display_name,
       (SELECT count(*) FROM staging.afltables_player_match s WHERE s.player_id = p.id) AS staging_rows,
       (SELECT count(*) FROM player_match_stats pms WHERE pms.player_id = p.id) AS match_rows,
       (SELECT max(m.season) FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = p.id) AS last_season,
       (SELECT c.games FROM player_career_stats c WHERE c.player_id = p.id) AS career_games,
       (SELECT c.brownlow_votes FROM player_career_stats c WHERE c.player_id = p.id) AS career_brownlow
  FROM players p WHERE p.id IN (2604,6293,6521,6622) ORDER BY p.id;

\echo ''
\echo '### 5. every FK column referencing players(id): rows still on a retired id (expect 0 on all 27)'
DO $chk$
DECLARE r record; n bigint; total bigint := 0; cols int := 0;
BEGIN
  FOR r IN
    SELECT n2.nspname AS sch, c2.relname AS tbl, a.attname AS col
      FROM pg_constraint k
      JOIN pg_class c2 ON c2.oid = k.conrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      JOIN pg_class c1 ON c1.oid = k.confrelid
      JOIN unnest(k.conkey) AS ck(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ck.attnum
     WHERE k.contype = 'f' AND c1.relname = 'players'
     ORDER BY 1,2,3
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IN (2608,6296,6525,6626)', r.sch, r.tbl, r.col)
      INTO n;
    cols := cols + 1;
    total := total + n;
    IF n > 0 THEN RAISE NOTICE 'RETIRED ID ROWS: %.%.% = %', r.sch, r.tbl, r.col, n; END IF;
  END LOOP;
  RAISE NOTICE 'FK columns scanned: %; rows on retired ids: %', cols, total;
END
$chk$;

\echo ''
\echo '### 6. Brownlow season table (loader-owned; the settle must not touch it)'
SELECT count(*) AS rows, sum(votes) AS votes, count(*) FILTER (WHERE is_winner) AS winners,
       count(DISTINCT season) AS seasons, count(DISTINCT player_id) AS players,
       min(season) AS first_season, max(season) AS last_season,
       count(*) FILTER (WHERE eligible_rank IS NULL) AS null_eligible_rank,
       count(*) FILTER (WHERE polling_games IS NULL) AS null_polling_games
  FROM brownlow_season_votes;

\echo ''
\echo '### 7. Brownlow round votes (expect 320,861 / 44,478 / F1 bb2a047194c45bd643c518fb2d716ac5,'
\echo '###    max season 2025; a 2026 row would be a legitimate settle write -- investigate before judging)'
SELECT count(*) AS rows, sum(votes) AS votes, max(season) AS last_season,
       md5(string_agg(season||':'||player_id||':'||round_number||':'||votes, ','
                      ORDER BY season, player_id, round_number)) AS fingerprint
  FROM brownlow_round_votes;

\echo ''
\echo '### 8. derived Brownlow totals (expect 79,113 both; Cameron 2604 = 25, Graham 6293 = 9)'
SELECT (SELECT sum(brownlow_votes) FROM player_season_stats) AS season_total,
       (SELECT sum(brownlow_votes) FROM player_career_stats) AS career_total,
       (SELECT brownlow_votes FROM player_career_stats WHERE player_id = 2604) AS cameron_2604,
       (SELECT brownlow_votes FROM player_career_stats WHERE player_id = 6293) AS graham_6293;

\echo ''
\echo '### 9. no NEW renumbered-profile split has appeared (expect 0 rows)'
SELECT d.player_id AS dup_id, dp.display_name, d.external_id AS renumbered_path,
       c.player_id AS base_id, c.external_id AS base_path, cp.final_season AS base_final_season
  FROM external_identities d
  JOIN sources s ON s.id = d.source_id AND s.key = 'afltables'
  JOIN players dp ON dp.id = d.player_id
  JOIN external_identities c
    ON c.source_id = d.source_id AND c.match_method = d.match_method
   AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
   AND c.external_id <> d.external_id
  JOIN players cp ON cp.id = c.player_id
 WHERE d.match_method = 'afltables_profile_url'
   AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
   AND d.player_id <> c.player_id
   AND dp.dob IS NULL AND dp.debut_season >= 2025
   AND dp.display_name = cp.display_name
 ORDER BY 1;

\echo ''
\echo '### 10. DB-health reconciliation (the five /admin/db-health checks; expect 0 each)'
SELECT 'games' AS check, count(*) AS mismatches FROM player_career_stats c
  LEFT JOIN (SELECT player_id, count(*) AS actual FROM player_match_stats GROUP BY player_id) g
    ON g.player_id = c.player_id WHERE c.games <> COALESCE(g.actual, 0)
UNION ALL
SELECT 'goals', count(*) FROM player_career_stats c
  LEFT JOIN (SELECT player_id, sum(goals) AS actual FROM player_match_stats GROUP BY player_id) g
    ON g.player_id = c.player_id WHERE c.goals <> COALESCE(g.actual, 0)
UNION ALL
SELECT 'finals', count(*) FROM player_career_stats c
  LEFT JOIN (SELECT pms.player_id, count(*) AS actual FROM player_match_stats pms
               JOIN matches m ON m.id = pms.match_id WHERE m.is_finals_series
              GROUP BY pms.player_id) f ON f.player_id = c.player_id
 WHERE c.finals <> COALESCE(f.actual, 0)
UNION ALL
SELECT 'brownlow', count(*) FROM player_career_stats c
  LEFT JOIN (SELECT player_id, sum(votes) AS actual FROM brownlow_season_votes GROUP BY player_id) b
    ON b.player_id = c.player_id WHERE c.brownlow_votes <> COALESCE(b.actual, 0)
UNION ALL
SELECT 'missing career row', count(*) FROM players p
  LEFT JOIN player_career_stats c ON c.player_id = p.id
 WHERE c.player_id IS NULL AND EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id = p.id);

\echo ''
\echo '### VERDICT (every row must read PASS)'
WITH v AS (
  SELECT
    (SELECT count(*) FROM import_batches WHERE id > 742) AS batches_after_742,
    (SELECT count(*) FROM import_batches WHERE id > 742 AND status <> 'completed') AS batches_not_completed,
    (SELECT count(*) FROM players WHERE id IN (2608,6296,6525,6626)) AS retired_present,
    (SELECT count(*) FROM players WHERE id IN (2604,6293,6521,6622)) AS careers_present,
    (SELECT count(*) FROM players WHERE id IN (2604,6293,6521,6622) AND final_season = 2026) AS careers_2026,
    (SELECT count(*) FROM staging.afltables_player_match WHERE player_id IN (2608,6296,6525,6626)) AS staging_retired,
    (SELECT count(*) FROM staging.afltables_player_match WHERE player_id IN (2604,6293,6521,6622)) AS staging_career,
    (SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id
      WHERE s.key = 'afltables' AND ei.status = 'unique'
        AND ((ei.external_id = 'players/C/Charlie_Cameron3.html' AND ei.player_id = 2604)
          OR (ei.external_id = 'players/J/Jack_Graham2.html'     AND ei.player_id = 6293)
          OR (ei.external_id = 'players/J/Jack_Ross3.html'       AND ei.player_id = 6521)
          OR (ei.external_id = 'players/J/Jack_Williams3.html'   AND ei.player_id = 6622))) AS renumbered_on_career,
    (SELECT count(*) FROM (
       SELECT ei.player_id FROM external_identities ei JOIN sources s ON s.id = ei.source_id
        WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
          AND ei.external_id IN ('players/C/Charlie_Cameron.html','players/C/Charlie_Cameron3.html',
                                 'players/J/Jack_Graham.html','players/J/Jack_Graham2.html',
                                 'players/J/Jack_Ross.html','players/J/Jack_Ross3.html',
                                 'players/J/Jack_Williams.html','players/J/Jack_Williams3.html')
        GROUP BY ei.player_id) t) AS distinct_owners_of_eight_paths,
    (SELECT count(*) FROM external_identities d
       JOIN sources s ON s.id = d.source_id AND s.key = 'afltables'
       JOIN players dp ON dp.id = d.player_id
       JOIN external_identities c ON c.source_id = d.source_id AND c.match_method = d.match_method
        AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
        AND c.external_id <> d.external_id
       JOIN players cp ON cp.id = c.player_id
      WHERE d.match_method = 'afltables_profile_url'
        AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
        AND d.player_id <> c.player_id AND dp.dob IS NULL AND dp.debut_season >= 2025
        AND dp.display_name = cp.display_name) AS new_splits,
    (SELECT count(*) FROM brownlow_season_votes) AS bsv_rows,
    (SELECT sum(votes) FROM brownlow_season_votes) AS bsv_votes,
    (SELECT count(*) FROM brownlow_season_votes WHERE is_winner) AS bsv_winners,
    (SELECT count(DISTINCT season) FROM brownlow_season_votes) AS bsv_seasons,
    (SELECT count(DISTINCT player_id) FROM brownlow_season_votes) AS bsv_players,
    (SELECT count(*) FROM brownlow_round_votes) AS brv_rows,
    (SELECT sum(votes) FROM brownlow_round_votes) AS brv_votes,
    (SELECT md5(string_agg(season||':'||player_id||':'||round_number||':'||votes, ','
                ORDER BY season, player_id, round_number)) FROM brownlow_round_votes) AS brv_fp,
    (SELECT sum(brownlow_votes) FROM player_career_stats) AS career_brownlow_total,
    (SELECT sum(brownlow_votes) FROM player_season_stats) AS season_brownlow_total,
    (SELECT count(*) FROM player_career_stats c
       WHERE c.player_id IN (2604,6293,6521,6622)
         AND c.games < (CASE c.player_id WHEN 2604 THEN 277 WHEN 6293 THEN 162
                                         WHEN 6521 THEN 112 ELSE 54 END)) AS careers_shrunk,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, count(*) AS actual FROM player_match_stats GROUP BY player_id) g
         ON g.player_id = c.player_id WHERE c.games <> COALESCE(g.actual, 0)) AS h_games,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, sum(goals) AS actual FROM player_match_stats GROUP BY player_id) g
         ON g.player_id = c.player_id WHERE c.goals <> COALESCE(g.actual, 0)) AS h_goals,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT pms.player_id, count(*) AS actual FROM player_match_stats pms
                    JOIN matches m ON m.id = pms.match_id WHERE m.is_finals_series
                   GROUP BY pms.player_id) f ON f.player_id = c.player_id
      WHERE c.finals <> COALESCE(f.actual, 0)) AS h_finals,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, sum(votes) AS actual FROM brownlow_season_votes GROUP BY player_id) b
         ON b.player_id = c.player_id WHERE c.brownlow_votes <> COALESCE(b.actual, 0)) AS h_brownlow,
    (SELECT count(*) FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id
      WHERE c.player_id IS NULL
        AND EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id = p.id)) AS h_missing
)
SELECT * FROM (
  SELECT  1 AS n, 'settle batch after 742 exists' AS check, v.batches_after_742::text AS actual, '>= 1' AS expected, CASE WHEN v.batches_after_742 >= 1 THEN 'PASS' ELSE 'CHECK' END AS verdict FROM v
  UNION ALL SELECT  2, 'no batch after 742 unfinished',      v.batches_not_completed::text, '0',      CASE WHEN v.batches_not_completed = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  3, 'retired ids absent from players',    v.retired_present::text,       '0',      CASE WHEN v.retired_present = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  4, 'four career players present',        v.careers_present::text,       '4',      CASE WHEN v.careers_present = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  5, 'career final_season = 2026',         v.careers_2026::text,          '4',      CASE WHEN v.careers_2026 = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  6, 'staging rows on retired ids',        v.staging_retired::text,       '0',      CASE WHEN v.staging_retired = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  7, 'staging rows on career ids',         v.staging_career::text,        '>= 67',  CASE WHEN v.staging_career >= 67 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  8, 'renumbered paths on career ids',     v.renumbered_on_career::text,  '4',      CASE WHEN v.renumbered_on_career = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  9, 'eight paths owned by four players',  v.distinct_owners_of_eight_paths::text, '4', CASE WHEN v.distinct_owners_of_eight_paths = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 10, 'no new renumbered-profile split',    v.new_splits::text,            '0',      CASE WHEN v.new_splits = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 11, 'brownlow_season_votes rows',         v.bsv_rows::text,              '16120',  CASE WHEN v.bsv_rows = 16120 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 12, 'brownlow_season_votes votes',        v.bsv_votes::text,             '79113',  CASE WHEN v.bsv_votes = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 13, 'brownlow winners',                   v.bsv_winners::text,           '112',    CASE WHEN v.bsv_winners = 112 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 14, 'brownlow seasons',                   v.bsv_seasons::text,           '98',     CASE WHEN v.bsv_seasons = 98 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 15, 'brownlow distinct players',          v.bsv_players::text,           '4275',   CASE WHEN v.bsv_players = 4275 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 16, 'brownlow_round_votes rows',          v.brv_rows::text,              '320861', CASE WHEN v.brv_rows = 320861 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 17, 'brownlow_round_votes votes',         v.brv_votes::text,             '44478',  CASE WHEN v.brv_votes = 44478 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 18, 'brownlow_round_votes fingerprint',   v.brv_fp,      'bb2a047194c45bd643c518fb2d716ac5', CASE WHEN v.brv_fp = 'bb2a047194c45bd643c518fb2d716ac5' THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 19, 'career brownlow total',              v.career_brownlow_total::text, '79113',  CASE WHEN v.career_brownlow_total = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 20, 'season brownlow total',              v.season_brownlow_total::text, '79113',  CASE WHEN v.season_brownlow_total = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 21, 'no career shrank below its repaired games', v.careers_shrunk::text, '0',      CASE WHEN v.careers_shrunk = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 22, 'db-health games',                    v.h_games::text,               '0',      CASE WHEN v.h_games = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 23, 'db-health goals',                    v.h_goals::text,               '0',      CASE WHEN v.h_goals = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 24, 'db-health finals',                   v.h_finals::text,              '0',      CASE WHEN v.h_finals = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 25, 'db-health brownlow',                 v.h_brownlow::text,            '0',      CASE WHEN v.h_brownlow = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 26, 'db-health missing career row',       v.h_missing::text,             '0',      CASE WHEN v.h_missing = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
) t ORDER BY n;
