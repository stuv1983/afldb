\echo --- planner statistics present (pg_statistic rows; tables with a recorded analyze)
SELECT current_database() AS db, (SELECT count(*) FROM pg_stats WHERE schemaname='public') AS pg_stats_rows,
       (SELECT count(*) FROM pg_stat_user_tables WHERE last_analyze IS NOT NULL OR last_autoanalyze IS NOT NULL) AS tables_analyzed,
       (SELECT count(*) FROM pg_stat_user_tables) AS tables_total,
       (SELECT reltuples::bigint FROM pg_class WHERE relname='player_match_stats' AND relnamespace='public'::regnamespace) AS pms_reltuples,
       (SELECT reltuples::bigint FROM pg_class WHERE relname='matches' AND relnamespace='public'::regnamespace) AS matches_reltuples;
