\echo --- 2026 finals matches and their is_final / round_type
SELECT m.round_code, m.round_type::text, m.is_final, m.is_finals_series, count(DISTINCT m.id) AS matches, count(s.*) AS pms_rows FROM matches m LEFT JOIN player_match_stats s ON s.match_id=m.id WHERE m.season=2026 AND m.round_type::text<>'home_and_away' GROUP BY 1,2,3,4 ORDER BY 1;
\echo --- career finals vs pms finals, split
SELECT (SELECT sum(finals) FROM player_career_stats) AS career_finals_sum,
       (SELECT count(*) FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.is_finals_series) AS pms_finals_series_rows,
       (SELECT count(*) FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.is_final) AS pms_is_final_rows,
       (SELECT count(*) FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.is_final AND m.round_code='WF') AS pms_wf_rows;
\echo --- cohort 3 re-derived: goals through 2025 from the fact table, career brownlow = 0
WITH t AS (SELECT s.player_id, sum(s.goals) AS goals FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.season <= 2025 GROUP BY 1)
SELECT count(*) AS t25_50_199_nobv FROM t JOIN player_career_stats c ON c.player_id=t.player_id WHERE t.goals BETWEEN 50 AND 199 AND c.brownlow_votes = 0;
\echo --- cohorts 1,2 re-derived independently excluding WF rows (as the career table counts finals), all seasons
WITH t AS (SELECT s.player_id, count(*) AS games, sum(s.goals) AS goals, count(*) FILTER (WHERE m.is_finals_series) AS finals FROM player_match_stats s JOIN matches m ON m.id=s.match_id GROUP BY 1)
SELECT (SELECT count(*) FROM t WHERE games >= 200 AND goals >= 100 AND finals >= 15) AS fs_200_100_15,
       (SELECT count(*) FROM t WHERE games BETWEEN 200 AND 249 AND finals >= 16) AS fs_200_249_16;
