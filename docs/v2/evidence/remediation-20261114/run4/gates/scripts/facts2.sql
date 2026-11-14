SELECT slug FROM clubs ORDER BY slug;
SELECT key FROM sources ORDER BY key;
\d seasons
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='matches' AND column_name IN ('attendance_status','source_id','is_finals_series','source_match_id');
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('seasons','matches','player_match_stats','players','club_seasons','stat_availability','player_season_stats','brownlow_season_votes');
