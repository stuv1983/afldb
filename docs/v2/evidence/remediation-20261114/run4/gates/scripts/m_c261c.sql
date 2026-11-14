-- 261 gate: a cohort player loses his AFL Tables profile identity (a silently dropped identity)
DELETE FROM external_identities
 WHERE id = (SELECT ei.id
               FROM external_identities ei
               JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
              WHERE ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique', 'resolved')
                AND ei.player_id = (SELECT g.player_id FROM (
                      SELECT pms.player_id FROM player_match_stats pms GROUP BY pms.player_id
                      HAVING sum(pms.goals) BETWEEN 50 AND 199
                         AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.player_id = pms.player_id)
                      ORDER BY 1 LIMIT 1) g)
              LIMIT 1);
