\echo --- 2026 stat_availability brownlow rows
SELECT stat_key, season, is_recorded, coverage::text, populated_rows, total_rows FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%' ORDER BY stat_key;
\echo --- all stat_availability rows count for 2026
SELECT count(*) FROM stat_availability WHERE season=2026;
\echo --- seasons 2026 and 2027
SELECT year, status::text, first_match_date, last_match_date, match_count FROM seasons WHERE year IN (2026,2027) ORDER BY year;
\echo --- brownlow_season_votes for 2026 / 2025
SELECT season, count(*) FROM brownlow_season_votes WHERE season IN (2025,2026) GROUP BY season ORDER BY season;
\echo --- Hawthorn v Brisbane Lions 2026 matches
SELECT m.id, m.match_key, m.round_code, m.round_type::text, m.match_date, m.source_id FROM matches m JOIN clubs h ON h.id=m.home_club_id JOIN clubs a ON a.id=m.away_club_id WHERE m.season=2026 AND h.name IN ('Hawthorn','Brisbane Lions') AND a.name IN ('Hawthorn','Brisbane Lions') ORDER BY m.match_date;
\echo --- 2026 final matches
SELECT m.round_code, count(*) FROM matches m WHERE m.season=2026 AND m.round_type::text<>'home_and_away' GROUP BY 1 ORDER BY 1;
\echo --- brownlow_vote_entry_state 2026
SELECT count(*) FROM brownlow_vote_entry_state WHERE season=2026;
