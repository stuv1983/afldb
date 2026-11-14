-- 261 gate: a Brownlow row for a cohort player that the derived career table does not know (service and oracle diverge)
INSERT INTO brownlow_season_votes (season, player_id, votes)
SELECT 2025, g.player_id, 1
  FROM (SELECT s.player_id
          FROM player_match_stats s
         GROUP BY s.player_id
        HAVING sum(s.goals) BETWEEN 50 AND 199
           AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.player_id = s.player_id)
         ORDER BY 1 LIMIT 1) g;
