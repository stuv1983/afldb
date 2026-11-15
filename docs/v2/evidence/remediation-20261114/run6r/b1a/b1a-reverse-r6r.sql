-- ISSUE-365 B1a GUARDED REVERSAL, packet 6R. OPERATIONAL EXECUTABLE ARTIFACT (packet 6R §3). Supersedes run6/b1a/b1a-reverse.sql.
-- NOT EXECUTED against production; needs its own owner approval at the time. It re-introduces the ISSUE-365 defect: use it only when
-- the repair itself is shown to have caused a fault (packet 6R §4.4 lists when NOT to use it).
--
-- Puts exactly the repaired 669 rows back to 'not_applicable' ONLY if every guard holds: identity; the same locks, in the same order,
-- as the runner; the 669 rows with the BEFORE id set, all 'pending', NULL votes; no medal or published authority; the three coverage
-- rows unchanged; inputs2026, H1, H2 and H3 equal to the BEFORE capture of b1a-accept-r6r.sql. brownlow_votes is not assigned.
--
-- Inputs (all required; from the BEFORE capture taken immediately before the B1a commit):
--   ids = md5 after "ids2026|669|"   inputs = text after "inputs2026|"   h1/h2/h3 = hashes after fp_pss_other / fp_pss2026_nonstatus /
--   fp_stat_availability (H3: the hash, not the count).  commit = false (dry run, always rolls back) or true.
--   ( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_IMPORT_DATABASE_URL &&
--     psql -X -v ON_ERROR_STOP=1 -d "$DSN" -v db=afldb_prod -v oid=66668 -v sysid=7674454702926115004 \
--       -v ids='<ids>' -v inputs='<inputs>' -v h1='<h1>' -v h2='<h2>' -v h3='<h3>' -v commit=false -f <this file>; echo "exit=$?" )
-- Any failed guard raises; psql stops (ON_ERROR_STOP, exit 3) and the server rolls the transaction back; COMMIT is never reached.
\set QUIET on
\if :{?commit}
\else
DO $$ BEGIN RAISE EXCEPTION 'REVERSE REFUSED: -v commit=true|false is required'; END $$;
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SELECT set_config('b1a.db', :'db', true), set_config('b1a.oid', :'oid', true), set_config('b1a.sysid', :'sysid', true),
       set_config('b1a.ids', :'ids', true), set_config('b1a.inputs', :'inputs', true),
       set_config('b1a.h1', :'h1', true), set_config('b1a.h2', :'h2', true), set_config('b1a.h3', :'h3', true) \g /dev/null
-- Same tables, same order, same mode as the runner: no writer of any of them can commit until this transaction ends.
LOCK TABLE seasons, stat_availability, brownlow_season_votes, brownlow_season_authority,
           brownlow_vote_entry_state, brownlow_round_votes, player_season_stats IN SHARE ROW EXCLUSIVE MODE;
SELECT count(*) AS locked_2026_rows FROM (SELECT 1 FROM player_season_stats WHERE season = 2026 ORDER BY player_id FOR UPDATE) l \g /dev/null
DO $guard$ DECLARE r record; n int; p int; v int; ids text; s text; cov text; BEGIN
  SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
         current_setting('transaction_read_only') AS ro INTO r
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database();
  IF r.db <> current_setting('b1a.db') OR r.oid <> current_setting('b1a.oid') OR r.sysid <> current_setting('b1a.sysid') OR r.ro <> 'off' THEN
    RAISE EXCEPTION 'REVERSE REFUSED identity: % % % ro=%', r.db, r.oid, r.sysid, r.ro;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE brownlow_status = 'pending'), count(brownlow_votes),
         md5(string_agg(player_id::text, ',' ORDER BY player_id)) INTO n, p, v, ids
    FROM player_season_stats WHERE season = 2026;
  IF n <> 669 OR p <> 669 OR v <> 0 THEN
    RAISE EXCEPTION 'REVERSE REFUSED pss2026 total=% pending=% votes=% (expected 669/669/0)', n, p, v;
  END IF;
  IF ids IS DISTINCT FROM current_setting('b1a.ids') THEN RAISE EXCEPTION 'REVERSE REFUSED: 2026 player_id set differs from BEFORE'; END IF;
  IF (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026) <> 0
     OR (SELECT count(*) FROM brownlow_season_authority WHERE season = 2026 AND published_revision IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'REVERSE REFUSED: 2026 medal rows or a published authority present';
  END IF;
  SELECT string_agg(stat_key || '=' || coverage::text || '/' || is_recorded::text || '/' || coalesce(populated_rows::text, 'null') || '/'
                    || coalesce(total_rows::text, 'null'), ',' ORDER BY stat_key) INTO cov
    FROM stat_availability WHERE season = 2026 AND stat_key LIKE 'brownlow%';
  IF cov IS DISTINCT FROM 'brownlow_match_votes=pending/false/null/null,brownlow_round_votes=pending/false/null/null,brownlow_season_total=pending/false/null/null' THEN
    RAISE EXCEPTION 'REVERSE REFUSED coverage rows now %', cov;
  END IF;
  SELECT concat_ws('/',
    coalesce((SELECT status::text FROM seasons WHERE year = 2026), 'none'),
    (SELECT count(*) FROM brownlow_season_votes WHERE season = 2026)::text,
    (SELECT count(*) FROM brownlow_round_votes WHERE season = 2026)::text,
    coalesce((SELECT string_agg(status || ':' || k, ',' ORDER BY status)
                FROM (SELECT status::text AS status, count(*) AS k FROM brownlow_vote_entry_state WHERE season = 2026 GROUP BY 1) q), 'none'),
    (SELECT count(*) FROM brownlow_season_authority WHERE season = 2026 AND published_revision IS NOT NULL)::text) INTO s;
  IF s IS DISTINCT FROM current_setting('b1a.inputs') THEN
    RAISE EXCEPTION 'REVERSE REFUSED 2026 inputs now % (BEFORE %)', s, current_setting('b1a.inputs');
  END IF;
  IF (SELECT md5(string_agg(x::text, E'\n' ORDER BY x.season, x.player_id)) FROM player_season_stats x WHERE season <> 2026)
     IS DISTINCT FROM current_setting('b1a.h1') THEN
    RAISE EXCEPTION 'REVERSE REFUSED: player_season_stats of another season changed (H1)';
  END IF;
  IF (SELECT md5(string_agg((to_jsonb(x) - 'brownlow_status')::text, E'\n' ORDER BY x.player_id))
        FROM player_season_stats x WHERE season = 2026) IS DISTINCT FROM current_setting('b1a.h2') THEN
    RAISE EXCEPTION 'REVERSE REFUSED: a 2026 column other than brownlow_status changed (H2)';
  END IF;
  IF (SELECT md5(string_agg(sa::text, E'\n' ORDER BY sa.season, sa.stat_key)) FROM stat_availability sa)
     IS DISTINCT FROM current_setting('b1a.h3') THEN
    RAISE EXCEPTION 'REVERSE REFUSED: stat_availability changed (H3)';
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
  IF (SELECT md5(string_agg((to_jsonb(x) - 'brownlow_status')::text, E'\n' ORDER BY x.player_id))
        FROM player_season_stats x WHERE season = 2026) IS DISTINCT FROM current_setting('b1a.h2') THEN
    RAISE EXCEPTION 'REVERSE ABORTED: a 2026 column other than brownlow_status changed';
  END IF;
END $rev$;
\if :commit
COMMIT;
\echo REVERSE COMMITTED: 669 rows back to not_applicable
\else
ROLLBACK;
\echo REVERSE DRY-RUN PASS (rolled back)
\endif
