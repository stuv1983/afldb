\echo --- player_match_stats rows by period
SELECT (m.season <= 2025) AS thru_2025, count(*) FROM player_match_stats s JOIN matches m ON m.id = s.match_id GROUP BY 1 ORDER BY 1;
\echo --- career table is an exact aggregate of the fact table (db-health agreement)
SELECT (SELECT sum(games) FROM player_career_stats) AS sum_games,
       (SELECT count(*) FROM player_match_stats) AS pms_rows,
       (SELECT sum(finals) FROM player_career_stats) AS sum_finals,
       (SELECT count(*) FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.is_final) AS pms_final_rows,
       (SELECT sum(goals) FROM player_career_stats) AS sum_goals,
       (SELECT sum(goals) FROM player_match_stats) AS pms_goals;
\echo --- cohorts from the career table (what the tests read)
SELECT (SELECT count(*) FROM player_career_stats WHERE games >= 200 AND goals >= 100 AND finals >= 15) AS c_200_100_15,
       (SELECT count(*) FROM player_career_stats WHERE games BETWEEN 200 AND 249 AND finals >= 16) AS c_200_249_16,
       (SELECT count(*) FROM player_career_stats WHERE goals BETWEEN 50 AND 199 AND brownlow_votes = 0) AS c_50_199_nobv;
\echo --- same cohorts re-derived independently from player_match_stats, all seasons
WITH t AS (SELECT s.player_id, count(*) AS games, sum(s.goals) AS goals, count(*) FILTER (WHERE m.is_final) AS finals FROM player_match_stats s JOIN matches m ON m.id=s.match_id GROUP BY 1)
SELECT (SELECT count(*) FROM t WHERE games >= 200 AND goals >= 100 AND finals >= 15) AS i_200_100_15,
       (SELECT count(*) FROM t WHERE games BETWEEN 200 AND 249 AND finals >= 16) AS i_200_249_16;
\echo --- same two cohorts re-derived through season 2025 only (the retired baseline stopped before 2026 completed)
WITH t AS (SELECT s.player_id, count(*) AS games, sum(s.goals) AS goals, count(*) FILTER (WHERE m.is_final) AS finals FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.season <= 2025 GROUP BY 1)
SELECT (SELECT count(*) FROM t WHERE games >= 200 AND goals >= 100 AND finals >= 15) AS t25_200_100_15,
       (SELECT count(*) FROM t WHERE games BETWEEN 200 AND 249 AND finals >= 16) AS t25_200_249_16;
\echo --- matches by season 2025/2026 and H2H Adelaide v Brisbane Lions meetings in 2026
SELECT m.season, count(*) FROM matches m WHERE m.season IN (2025, 2026) GROUP BY 1 ORDER BY 1;
