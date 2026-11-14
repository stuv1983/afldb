-- 261 gate: move one cohort player out of 50-199 goals consistently in the fact table AND the career table
-- (service and oracle agree; only the historical 261 can notice)
WITH p AS (
  SELECT s.player_id
    FROM player_match_stats s JOIN matches m ON m.id = s.match_id
   WHERE m.season <= 2025
   GROUP BY s.player_id
  HAVING sum(s.goals) BETWEEN 50 AND 199
     AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.player_id = s.player_id)
   ORDER BY 1 LIMIT 1
), u1 AS (
  UPDATE player_match_stats SET goals = goals + 200
   WHERE id = (SELECT min(s.id) FROM player_match_stats s JOIN p ON p.player_id = s.player_id)
  RETURNING 1
)
UPDATE player_career_stats SET goals = goals + 200 WHERE player_id IN (SELECT player_id FROM p);
