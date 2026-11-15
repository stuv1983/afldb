-- ISSUE-365 B1a acceptance probe (read-only). Packet 6, 2026-11-16. NOT EXECUTED by preparation.
-- Run as the read-only backup role, BEFORE the B1a commit (keep the output) and AFTER it, then compare (packet 6 §5.4):
--   ( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_BACKUP_DATABASE_URL &&
--     PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" -f <this file> ) > b1a-accept-<label>.txt
-- Every line is labelled; the `inputs2026` line is consumed verbatim by b1a-reverse.sql, and the `fp_*` hashes by its guard.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ DECLARE r record; BEGIN
  SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
         current_setting('transaction_read_only') AS ro INTO r
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database();
  IF r.db <> 'afldb_prod' OR r.oid <> '66668' OR r.sysid <> '7674454702926115004' OR r.ro <> 'on' THEN
    RAISE EXCEPTION 'identity/read-only mismatch: % % % ro=%', r.db, r.oid, r.sysid, r.ro;
  END IF;
END $$;
SELECT 'pss2026', brownlow_status::text, count(*), count(brownlow_votes)
  FROM player_season_stats WHERE season = 2026 GROUP BY 2 ORDER BY 2;
SELECT 'cov2026', stat_key, coverage::text, is_recorded, coalesce(populated_rows::text, '-'), coalesce(total_rows::text, '-')
  FROM stat_availability
 WHERE season = 2026 AND stat_key IN ('brownlow_season_total', 'brownlow_round_votes', 'brownlow_match_votes') ORDER BY stat_key;
-- One string; b1a-reverse.sql rebuilds exactly this expression (keep the two in step).
SELECT 'inputs2026', concat_ws('/',
  coalesce((SELECT status::text FROM seasons WHERE year = 2026), 'none'),
  (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026)::text,
  (SELECT count(*) FROM brownlow_round_votes WHERE season = 2026)::text,
  coalesce((SELECT string_agg(status || ':' || k, ',' ORDER BY status)
              FROM (SELECT status, count(*) AS k FROM brownlow_vote_entry_state WHERE season = 2026 GROUP BY 1) q), 'none'),
  (SELECT count(*) FROM brownlow_season_authority WHERE season = 2026 AND published_revision IS NOT NULL)::text);
SELECT 'fp_pss_other', md5(string_agg(p::text, E'\n' ORDER BY p.season, p.player_id))
  FROM player_season_stats p WHERE season <> 2026;
SELECT 'fp_pss2026_nonbrownlow', md5(string_agg(((to_jsonb(p) - 'brownlow_status') - 'brownlow_votes')::text, E'\n' ORDER BY p.player_id))
  FROM player_season_stats p WHERE season = 2026;
SELECT 'fp_sa_except_2026_brownlow', md5(string_agg(sa::text, E'\n' ORDER BY sa.season, sa.stat_key))
  FROM stat_availability sa WHERE NOT (season = 2026 AND stat_key LIKE 'brownlow%');
SELECT 'na_cov', count(*) FILTER (WHERE season >= 1924 AND season NOT BETWEEN 1942 AND 1945),
                 count(*) FILTER (WHERE season BETWEEN 1942 AND 1945)
  FROM stat_availability WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable';
SELECT 'na_pss', count(*) FILTER (WHERE season >= 1924 AND season NOT BETWEEN 1942 AND 1945),
                 count(*) FILTER (WHERE season BETWEEN 1897 AND 1923 OR season BETWEEN 1942 AND 1945)
  FROM player_season_stats WHERE brownlow_status = 'not_applicable';
ROLLBACK;
