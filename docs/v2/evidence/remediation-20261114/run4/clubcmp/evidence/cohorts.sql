SELECT 'pms_rows|' || count(*) FROM player_match_stats;
SELECT 'career_games_sum|' || sum(games) FROM player_career_stats;
SELECT 'c_200_249_f16|' || count(*) FROM player_career_stats WHERE games BETWEEN 200 AND 249 AND finals >= 16;
SELECT 'c_50_199_nobv|' || count(*) FROM player_career_stats WHERE goals BETWEEN 50 AND 199 AND brownlow_votes = 0;
SELECT 'c_200_100_f15|' || count(*) FROM player_career_stats WHERE games >= 200 AND goals >= 100 AND finals >= 15;
SELECT 'seasons_complete_max|' || max(year) FROM seasons WHERE status = 'complete';
