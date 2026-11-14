WITH hist AS (
  SELECT DISTINCT s.player_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season <= 2025)
SELECT (SELECT count(*) FROM hist) AS hist_players,
       (SELECT count(*) FROM players p JOIN hist h ON h.player_id=p.id WHERE p.dob IS NOT NULL) AS hist_dated,
       (SELECT count(*) FROM players p JOIN hist h ON h.player_id=p.id WHERE p.dob IS NULL AND p.dob_confidence='unknown') AS hist_undated_unknown,
       (SELECT count(*) FROM players p JOIN hist h ON h.player_id=p.id WHERE p.dob IS NOT NULL AND p.dob_evidence_id IS NOT NULL) AS hist_linked,
       (SELECT count(*) FROM player_birth_evidence e JOIN hist h ON h.player_id=e.player_id) AS hist_evidence,
       (SELECT count(*) FROM external_identities e JOIN hist h ON h.player_id=e.player_id WHERE e.match_method='afltables_profile_url' AND e.status='unique') AS hist_profile_ids,
       (SELECT count(*) FROM players p WHERE NOT EXISTS (SELECT 1 FROM hist h WHERE h.player_id=p.id)) AS non_hist_players,
       (SELECT count(*) FROM players p WHERE p.dob IS NULL AND p.dob_confidence <> 'unknown') AS dobnull_conf_other;
SELECT count(*) AS players_no_pms FROM players p WHERE NOT EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id=p.id);
SELECT count(*) AS players_no_unique_profile FROM players p WHERE NOT EXISTS (SELECT 1 FROM external_identities e WHERE e.player_id=p.id AND e.match_method='afltables_profile_url' AND e.status='unique');
SELECT status::text, match_method, count(*) FROM external_identities e JOIN sources s ON s.id=e.source_id AND s.key='afltables' GROUP BY 1,2 ORDER BY 1,2;
SELECT debut_season IS NULL AS debut_null, count(*) FROM players GROUP BY 1;
