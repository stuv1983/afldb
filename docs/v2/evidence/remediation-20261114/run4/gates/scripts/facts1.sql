\echo --- seasons (latest, in_progress, 2065/2066 usage)
SELECT year, status, match_count FROM seasons WHERE year >= 2025 OR status = 'in_progress' OR year IN (2065, 2066) ORDER BY year;
\echo --- matches/external_identities/players slug use of CD_I4020 and seasons 2065/2066
SELECT (SELECT count(*) FROM matches WHERE season IN (2065,2066) OR match_key LIKE 'CD\_I4020%') AS matches_2065_6,
       (SELECT count(*) FROM external_identities WHERE external_id LIKE 'CD\_I4020%') AS ext_ids,
       (SELECT count(*) FROM players WHERE slug LIKE 'CD\_I4020%' OR slug LIKE 'cd-i4020%') AS players_slug,
       (SELECT count(*) FROM club_seasons WHERE season IN (2065,2066)) AS cs,
       (SELECT count(*) FROM stat_availability WHERE season IN (2065,2066)) AS sa;
\echo --- cohort 50-199 goals, zero career brownlow: independent oracle (all seasons / through 2025)
WITH g AS (SELECT s.player_id, sum(s.goals) AS goals_all, sum(s.goals) FILTER (WHERE m.season <= 2025) AS goals_25
             FROM player_match_stats s JOIN matches m ON m.id = s.match_id GROUP BY 1),
     v AS (SELECT player_id, sum(votes) AS votes_all, sum(votes) FILTER (WHERE season <= 2025) AS votes_25 FROM brownlow_season_votes GROUP BY 1)
SELECT count(*) FILTER (WHERE g.goals_all BETWEEN 50 AND 199 AND COALESCE(v.votes_all,0) = 0) AS all_seasons_bsv,
       count(*) FILTER (WHERE g.goals_25 BETWEEN 50 AND 199 AND COALESCE(v.votes_25,0) = 0) AS thru25_bsv
  FROM g LEFT JOIN v USING (player_id);
\echo --- career-table based (what run3 facts3 used) through 2025
WITH t AS (SELECT s.player_id, sum(s.goals) AS goals FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.season <= 2025 GROUP BY 1)
SELECT count(*) AS t25_career_bv FROM t JOIN player_career_stats c ON c.player_id=t.player_id WHERE t.goals BETWEEN 50 AND 199 AND c.brownlow_votes = 0;
\echo --- attendance by status, all and thru 2025
SELECT attendance_status::text, (season <= 2025) AS thru25, count(*) AS n, count(*) FILTER (WHERE attendance IS NULL) AS null_att FROM matches GROUP BY 1,2 ORDER BY 1,2;
\echo --- ladder ranges all and through 2025
SELECT c.slug, count(cs.season) AS n, min(cs.season) AS first, max(cs.season) AS last,
       count(cs.season) FILTER (WHERE cs.season <= 2025) AS n25, max(cs.season) FILTER (WHERE cs.season <= 2025) AS last25
  FROM clubs c JOIN club_seasons cs ON cs.club_id=c.id
 WHERE c.slug IN ('footscray','western-bulldogs','south-melbourne','sydney','kangaroos','north-melbourne') GROUP BY 1 ORDER BY 1;
\echo --- birth dates
SELECT (SELECT count(*) FROM players) AS players,
       (SELECT count(*) FROM players WHERE dob IS NOT NULL) AS dated,
       (SELECT count(*) FROM players WHERE dob IS NULL) AS undated,
       (SELECT count(*) FROM players WHERE dob IS NULL AND dob_confidence = 'unknown') AS undated_unknown,
       (SELECT count(*) FROM players WHERE dob IS NOT NULL AND dob_evidence_id IS NOT NULL) AS dated_linked,
       (SELECT count(*) FROM player_birth_evidence) AS evidence,
       (SELECT count(*) FROM external_identities WHERE match_method='afltables_profile_url' AND status='unique') AS profile_uniq,
       (SELECT count(DISTINCT player_id) FROM external_identities WHERE match_method='afltables_profile_url' AND status='unique') AS profile_players;
SELECT dob_confidence::text, (dob IS NULL) AS dob_null, count(*) FROM players GROUP BY 1,2 ORDER BY 1,2;
SELECT evidence_type, (SELECT key FROM sources s WHERE s.id=source_id) AS src, count(*) AS rows, count(DISTINCT player_id) AS players FROM player_birth_evidence GROUP BY 1,2 ORDER BY 1,2;
SELECT p.dob_confidence::text, e.evidence_type, count(*) FROM players p JOIN player_birth_evidence e ON e.id = p.dob_evidence_id GROUP BY 1,2 ORDER BY 1,2;
\echo --- first-appearance season of the undated and of dated-not-in-fitzroy-evidence
SELECT (SELECT count(*) FROM players p WHERE dob IS NULL AND EXISTS (SELECT 1 FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE s.player_id=p.id AND m.season=2026) AND NOT EXISTS (SELECT 1 FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE s.player_id=p.id AND m.season<=2025)) AS undated_2026_debut;
\echo --- 2026 debutants (no pms row through 2025)
SELECT count(*) AS debut2026, count(*) FILTER (WHERE dob IS NOT NULL) AS dated FROM players p
 WHERE EXISTS (SELECT 1 FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE s.player_id=p.id AND m.season=2026)
   AND NOT EXISTS (SELECT 1 FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE s.player_id=p.id AND m.season<=2025);
