-- AFLDB-ISSUE-225 S1 (§18, §21 V2/V5): read-only captaincies checks, run before AND after the
-- `import_awards.py --groups captaincies` reload. Writes nothing.
--
-- Usage (psql variable expect_db names the ONLY database this may run against):
--   PGOPTIONS='-c default_transaction_read_only=on' \
--   psql -X -v ON_ERROR_STOP=1 -v expect_db=afldb_test -f issues/closed/AFLDB-ISSUE-225-s1-captaincies-checks.sql -d "$DSN"
--
-- Expected AFTER the reload (BEFORE in brackets):
--   T  rows 1781 [1774], trusted 1781 [1774] on afldb_test (DEV: trusted is whatever its
--      identity split allows; DEV had 1,690 of 1,774 linked -- compare to its own BEFORE + 7)
--   P  distinct trusted captains = BEFORE + 2 (Steven May, Cameron Bruce; Witts and McDonald
--      are already captains through 2022-24 / 2009-10)
--   R  seven rows, every one trusted, source wikipedia, each linked to the profile shown
--      [BEFORE: zero rows]
--   C  Gold Coast 2017-18: Lynch + May; 2019-21: Swallow + Witts; Melbourne 2008: Neitz + Bruce + McDonald
\set ON_ERROR_STOP 1
BEGIN READ ONLY;

\echo '== G. target'
SELECT current_database() AS database, current_user AS role, current_setting('transaction_read_only') AS read_only,
       inet_server_port() AS port, now() AS observed_at;
SELECT set_config('afldb.expect_db', :'expect_db', true) AS expect_db;
DO $$
BEGIN
  IF current_database() <> current_setting('afldb.expect_db') THEN
    RAISE EXCEPTION 'refusing: connected to %, expected %', current_database(), current_setting('afldb.expect_db');
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'refusing: transaction is not read-only';
  END IF;
END $$;

\echo '== T. totals'
SELECT count(*) AS rows,
       count(*) FILTER (WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')) AS trusted,
       min(season) AS season_min, max(season) AS season_max
  FROM captaincies;

\echo '== P. club_captain_any population (distinct trusted captains)'
SELECT count(DISTINCT player_id) AS club_captain_any
  FROM captaincies
 WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved');

\echo '== R. the seven AFLDB-ISSUE-225 rows, by source_record_id'
SELECT cp.source_record_id, cp.season, c.name AS club, cp.player_name_raw, cp.player_id, p.display_name,
       ei.external_id AS afltables_profile, cp.link_status_value, s.key AS source, cp.period
  FROM captaincies cp
  JOIN clubs c ON c.id = cp.club_id
  LEFT JOIN sources s ON s.id = cp.source_id
  LEFT JOIN players p ON p.id = cp.player_id
  LEFT JOIN external_identities ei ON ei.player_id = cp.player_id
        AND ei.source_id = (SELECT id FROM sources WHERE key = 'afltables')
 WHERE cp.source_record_id IN ('25f8dac05c6995eb838d7bef', '3469269fae62fa9aa25d705d', '91b499dcbe61d3386183fc8e',
                               '2c4db502ad00390a4f74db74', 'c9d6a0dffa2a7035f52c66e7', '0a590b03a95e13bcfac2c41c',
                               '8dbd379972bbe7f8ecf68a10')
 ORDER BY cp.season, c.name, cp.player_name_raw;

\echo '== C. every captain of the affected club-seasons'
SELECT cp.season, c.name AS club, string_agg(cp.player_name_raw || ' [' || cp.link_status_value || ']', ', ' ORDER BY cp.player_name_raw) AS captains
  FROM captaincies cp JOIN clubs c ON c.id = cp.club_id
 WHERE (c.name = 'Gold Coast' AND cp.season BETWEEN 2017 AND 2021) OR (c.name = 'Melbourne' AND cp.season = 2008)
 GROUP BY cp.season, c.name
 ORDER BY c.name, cp.season;

ROLLBACK;
