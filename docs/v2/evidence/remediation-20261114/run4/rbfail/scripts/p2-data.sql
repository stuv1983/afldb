\echo == FKG: rows not linked (source_record_id, name, season, round, status) ==
SELECT source_record_id, player_name_clean, season, round_raw, link_status_value, candidate_count, player_id IS NOT NULL AS has_player, match_id IS NOT NULL AS has_match, notes
  FROM player_achievements WHERE achievement_type='first_kick_goal'
   AND NOT (player_id IS NOT NULL AND link_status_value IN ('unique','resolved')) ORDER BY source_record_id;
\echo == FKG: counts by link status ==
SELECT link_status_value::text, count(*) FROM player_achievements WHERE achievement_type='first_kick_goal' GROUP BY 1 ORDER BY 1;
\echo == FKG: linked rows with no match ==
SELECT count(*) FROM player_achievements WHERE achievement_type='first_kick_goal' AND player_id IS NOT NULL AND match_id IS NULL;
\echo == Richmond coaches games>=50 ==
SELECT c.display_name, count(*) AS games
  FROM match_coaches mc JOIN matches m ON m.id=mc.match_id JOIN coaches c ON c.id=mc.coach_id
 WHERE mc.club_id IN (SELECT id FROM clubs WHERE organization_id=(SELECT id FROM club_organizations WHERE name='Richmond'))
 GROUP BY c.id, c.display_name HAVING count(*)>=50 ORDER BY games DESC, c.display_name;
\echo == match_coaches by season (count) around the edges ==
SELECT count(*) AS mc_total, min(m.season), max(m.season) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id;
