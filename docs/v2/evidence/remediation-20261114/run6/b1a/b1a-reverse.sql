-- ISSUE-365 B1a GUARDED REVERSAL. Packet 6, 2026-11-16. NOT EXECUTED by preparation; needs its own owner approval at the time.
-- Purpose: put the 669 rows back to `not_applicable` ONLY if they still exactly match the state B1a left. It re-introduces the
-- ISSUE-365 defect; use it only when the repair itself is shown to have caused a fault (packet 6 §6.2 lists when NOT to use it).
--
-- Inputs come from the BEFORE capture of b1a-accept.sql (the file taken immediately before the B1a commit):
--   inputs = the text after "inputs2026|"            e.g. complete/0/9522/<state>/<n>
--   h1     = the hash after "fp_pss_other|"
--   h2     = the hash after "fp_pss2026_nonbrownlow|"
-- Run as the import role (the role that wrote the repair):
--   ( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_IMPORT_DATABASE_URL &&
--     psql -X -v ON_ERROR_STOP=1 -d "$DSN" -v inputs='<inputs>' -v h1='<h1>' -v h2='<h2>' -f <this file>; echo "exit=$?" )
-- Any failed guard raises; psql stops (ON_ERROR_STOP) and the open transaction is rolled back; COMMIT is never reached.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SELECT set_config('b1a.inputs', :'inputs', true), set_config('b1a.h1', :'h1', true), set_config('b1a.h2', :'h2', true);
-- Hold off every other writer of the two tables for the few seconds this takes; readers are unaffected.
LOCK TABLE player_season_stats, stat_availability IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ DECLARE r record; n int; p int; v int; cn int; cp int; s text; BEGIN
  SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
         current_setting('transaction_read_only') AS ro INTO r
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database();
  IF r.db <> 'afldb_prod' OR r.oid <> '66668' OR r.sysid <> '7674454702926115004' OR r.ro <> 'off' THEN
    RAISE EXCEPTION 'REVERSE REFUSED identity: % % % ro=%', r.db, r.oid, r.sysid, r.ro;
  END IF;
  -- 1. The rows are still exactly the repaired state: 669 rows, all pending, no votes.
  SELECT count(*), count(*) FILTER (WHERE brownlow_status = 'pending'), count(brownlow_votes) INTO n, p, v
    FROM player_season_stats WHERE season = 2026;
  IF n <> 669 OR p <> 669 OR v <> 0 THEN
    RAISE EXCEPTION 'REVERSE REFUSED pss2026 total=% pending=% votes=% (expected 669/669/0)', n, p, v;
  END IF;
  -- 2. No medal result loaded, coverage still the three pending/unrecorded rows.
  IF (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026) <> 0 THEN
    RAISE EXCEPTION 'REVERSE REFUSED: 2026 medal rows present';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE coverage = 'pending' AND NOT is_recorded) INTO cn, cp
    FROM stat_availability
   WHERE season = 2026 AND stat_key IN ('brownlow_season_total', 'brownlow_round_votes', 'brownlow_match_votes');
  IF cn <> 3 OR cp <> 3 THEN RAISE EXCEPTION 'REVERSE REFUSED coverage rows=% pending=%', cn, cp; END IF;
  -- 3. Nothing that feeds the 2026 Brownlow state changed since the BEFORE capture (same expression as b1a-accept.sql).
  SELECT concat_ws('/',
    coalesce((SELECT status::text FROM seasons WHERE year = 2026), 'none'),
    (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026)::text,
    (SELECT count(*) FROM brownlow_round_votes WHERE season = 2026)::text,
    coalesce((SELECT string_agg(status || ':' || k, ',' ORDER BY status)
                FROM (SELECT status, count(*) AS k FROM brownlow_vote_entry_state WHERE season = 2026 GROUP BY 1) q), 'none'),
    (SELECT count(*) FROM brownlow_season_authority WHERE season = 2026 AND published_revision IS NOT NULL)::text) INTO s;
  IF s IS DISTINCT FROM current_setting('b1a.inputs') THEN
    RAISE EXCEPTION 'REVERSE REFUSED 2026 inputs now % (BEFORE %)', s, current_setting('b1a.inputs');
  END IF;
  -- 4. No other season's rows and no other 2026 column changed since the BEFORE capture.
  IF (SELECT md5(string_agg(x::text, E'\n' ORDER BY x.season, x.player_id)) FROM player_season_stats x WHERE season <> 2026)
     IS DISTINCT FROM current_setting('b1a.h1') THEN
    RAISE EXCEPTION 'REVERSE REFUSED: player_season_stats of another season changed';
  END IF;
  IF (SELECT md5(string_agg(((to_jsonb(x) - 'brownlow_status') - 'brownlow_votes')::text, E'\n' ORDER BY x.player_id))
        FROM player_season_stats x WHERE season = 2026) IS DISTINCT FROM current_setting('b1a.h2') THEN
    RAISE EXCEPTION 'REVERSE REFUSED: 2026 non-Brownlow columns changed';
  END IF;
END $guard$;
DO $rev$ DECLARE k int; BEGIN
  UPDATE player_season_stats SET brownlow_status = 'not_applicable'
   WHERE season = 2026 AND brownlow_status = 'pending' AND brownlow_votes IS NULL;
  GET DIAGNOSTICS k = ROW_COUNT;
  IF k <> 669 THEN RAISE EXCEPTION 'REVERSE ABORTED: updated % rows, expected 669', k; END IF;
  IF EXISTS (SELECT 1 FROM player_season_stats
              WHERE season = 2026 AND (brownlow_status <> 'not_applicable' OR brownlow_votes IS NOT NULL)) THEN
    RAISE EXCEPTION 'REVERSE ABORTED: post-state is not 669 x not_applicable/NULL';
  END IF;
  RAISE NOTICE 'REVERSE OK: 669 rows back to not_applicable';
END $rev$;
COMMIT;
