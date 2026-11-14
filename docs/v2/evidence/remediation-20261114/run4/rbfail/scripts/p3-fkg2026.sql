\echo == FKG fkg-331..334: link, player, match (rebuild vs snapshot) ==
SELECT a.source_record_id, a.player_name_clean, a.season, a.round_raw, a.link_status_value::text AS st,
       p.display_name AS linked_player, a.match_id IS NOT NULL AS has_match,
       m.season AS m_season, m.round_code AS m_round,
       (SELECT count(*) FROM player_match_stats s WHERE s.player_id = a.player_id AND s.match_id = a.match_id) AS pms_rows,
       (SELECT min(s.career_game_no) FROM player_match_stats s WHERE s.player_id = a.player_id) AS min_career_game_no,
       (SELECT debut_season FROM players WHERE id = a.player_id) AS debut_season
  FROM player_achievements a LEFT JOIN players p ON p.id = a.player_id LEFT JOIN matches m ON m.id = a.match_id
 WHERE a.achievement_type='first_kick_goal' AND a.source_record_id IN ('fkg-331','fkg-332','fkg-333','fkg-334') ORDER BY 1;
\echo == FKG: do the four players exist by name in players (any season) ==
SELECT p.display_name, p.debut_season, p.final_season, (SELECT count(*) FROM player_match_stats s WHERE s.player_id=p.id) AS pms
  FROM players p WHERE p.display_name IN ('Milan Murdock','Noah Roberts-Thomson','Zane Peucker','Jay Polkinghorne') ORDER BY 1;
\echo == after_siren_kicks: total/unlinked/max season ==
SELECT count(*), count(*) FILTER (WHERE player_id IS NULL) AS unlinked, max(season) AS max_season,
       count(*) FILTER (WHERE season>=2026) AS from_2026, count(*) FILTER (WHERE season>=2026 AND player_id IS NULL) AS unlinked_2026
  FROM after_siren_kicks;
\echo == match_coaches rows in 2026 ==
SELECT count(*) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id WHERE m.season=2026;
\echo == coaches / player_relationships / achievements counts ==
SELECT (SELECT count(*) FROM coaches) AS coaches, (SELECT count(*) FROM player_relationships) AS rels, (SELECT count(*) FROM club_seasons WHERE season=2027) AS cs2027,
       (SELECT count(*) FROM matches WHERE season=2027) AS m2027;
