\pset pager off
\echo == identity
SELECT current_database() AS db, (SELECT count(*) FROM afldb_meta.schema_migrations) AS ledger;
\echo == seasons 2025..2027
SELECT year, status::text AS status, match_count FROM seasons WHERE year BETWEEN 2025 AND 2027 ORDER BY year;
\echo == coleman award definition
SELECT slug, first_season, last_season FROM awards WHERE slug = 'coleman';
\echo == coleman family (before any loader run): rows, seasons, first, last, per-source
SELECT count(*) AS rows, count(DISTINCT w.season) AS seasons, min(w.season) AS first_season, max(w.season) AS last_season
  FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman';
SELECT s.key AS source_key, count(*) AS rows, min(w.season) AS first_season, max(w.season) AS last_season
  FROM award_winners w JOIN awards a ON a.id = w.award_id LEFT JOIN sources s ON s.id = w.source_id
 WHERE a.slug = 'coleman' GROUP BY s.key ORDER BY 1;
\echo == rows with season <= 2025 and season > 2025
SELECT count(*) FILTER (WHERE w.season <= 2025) AS le_2025, count(*) FILTER (WHERE w.season > 2025) AS gt_2025
  FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman';
\echo == key shape (derived form) counts
SELECT count(*) FILTER (WHERE w.source_record_id ~ '^coleman:[0-9]{4}:[^:]+$' AND w.source_record_id !~ '^coleman:[0-9]{4}:[0-9]+$') AS derived_key_form,
       count(*) FILTER (WHERE w.source_record_id ~ '^coleman:[0-9]{4}:[0-9]+$') AS legacy_key_form
  FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman';
\echo == independent oracle (contract derivation_method; same SQL text as the test): rows, le_2025, gt_2025, max season
WITH totals AS (
  SELECT m.season::int AS season, s.player_id::int AS player_id, sum(s.goals)::int AS goals
    FROM player_match_stats s JOIN matches m ON m.id = s.match_id JOIN seasons y ON y.year = m.season
   WHERE m.round_type = 'home_and_away' AND y.status = 'complete' AND m.season >= 1980
   GROUP BY m.season, s.player_id
), fam AS (
  SELECT t.season, t.player_id FROM totals t
   WHERE t.goals >= 1 AND NOT EXISTS (SELECT 1 FROM totals o WHERE o.season = t.season AND o.goals > t.goals)
)
SELECT count(*) AS rows, count(*) FILTER (WHERE season <= 2025) AS le_2025, count(*) FILTER (WHERE season > 2025) AS gt_2025,
       min(season) AS first_season, max(season) AS last_season, count(DISTINCT season) AS seasons FROM fam;
\echo == oracle vs stored family (season:player_id), symmetric difference
WITH totals AS (
  SELECT m.season::int AS season, s.player_id::int AS player_id, sum(s.goals)::int AS goals
    FROM player_match_stats s JOIN matches m ON m.id = s.match_id JOIN seasons y ON y.year = m.season
   WHERE m.round_type = 'home_and_away' AND y.status = 'complete' AND m.season >= 1980
   GROUP BY m.season, s.player_id
), fam AS (
  SELECT t.season, t.player_id FROM totals t
   WHERE t.goals >= 1 AND NOT EXISTS (SELECT 1 FROM totals o WHERE o.season = t.season AND o.goals > t.goals)
), stored AS (
  SELECT w.season::int AS season, w.player_id::int AS player_id
    FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman'
)
SELECT (SELECT count(*) FROM (SELECT * FROM fam EXCEPT SELECT * FROM stored) x) AS in_oracle_not_stored,
       (SELECT count(*) FROM (SELECT * FROM stored EXCEPT SELECT * FROM fam) x) AS in_stored_not_oracle;
\echo == real 2026 Coleman winner in the oracle (names are public facts)
WITH totals AS (
  SELECT m.season::int AS season, s.player_id::int AS player_id, sum(s.goals)::int AS goals
    FROM player_match_stats s JOIN matches m ON m.id = s.match_id JOIN seasons y ON y.year = m.season
   WHERE m.round_type = 'home_and_away' AND y.status = 'complete' AND m.season = 2026
   GROUP BY m.season, s.player_id
)
SELECT t.season, t.goals, p.display_name FROM totals t JOIN players p ON p.id = t.player_id
 WHERE NOT EXISTS (SELECT 1 FROM totals o WHERE o.goals > t.goals);
\echo == null goals in home-and-away rows from 1980 (the loader refuses on these)
SELECT count(*) AS null_goal_rows FROM player_match_stats s JOIN matches m ON m.id = s.match_id
 WHERE m.round_type = 'home_and_away' AND m.season >= 1980 AND s.goals IS NULL;
\echo == data_overrides authority rows, Coleman link decisions
SELECT (SELECT count(*) FROM data_overrides) AS data_overrides,
       (SELECT count(*) FROM player_link_resolutions r JOIN award_winners w ON w.id = r.target_id JOIN awards a ON a.id = w.award_id
         WHERE r.target_table = 'award_winners' AND a.slug = 'coleman') AS coleman_decisions;
