-- AFLDB-ISSUE-137 — lineage forensics + closure verification under STABLE IDENTITY.
--
-- Written 2026-09-12 after AFLDB-ISSUE-137-settle-check.sql returned CHECK rows that are
-- NOT regression evidence: production's surrogate player ids no longer match the 2026-09-04
-- snapshot (id 2608 is now Charlie Canet, 6296 Jack Grant, 6525 Jack Ryan, 6626 Jack Wright),
-- and the four careers now sit at 2604 / 6292 / 6519 / 6619. That -0/-1/-2/-3 shift is the
-- signature of a sequentially re-assigned canonical lineage in which the four ISSUE-136
-- duplicate players never existed. This script tests nothing by surrogate id.
--
-- PART A is forensic and states NO pass criteria: the expected values are not known in
-- advance, so claiming a verdict on them would be invention. It establishes WHICH lineage
-- afldb_prod now holds and when it arrived.
-- PART B tests the AFLDB-ISSUE-137 closure condition on identity that survives a lineage
-- change: AFL Tables profile-url paths, display names and dates of birth. Every expected
-- value in PART B is taken from tracked evidence recorded BEFORE this run
-- (issues/closed/AFLDB-ISSUE-137.md §1.2, §8.5-§8.7, moved from issues/open/ on ISSUE-137's
-- 2026-09-12 resolution) and is lineage-independent.
--
-- READ-ONLY BY CONSTRUCTION: the session is pinned to default_transaction_read_only = on and
-- the script issues nothing but SELECT (the two DO blocks build only SELECT count(*) text).
-- It writes nothing, creates nothing, and touches no other database.
--
--   psql -v ON_ERROR_STOP=1 -X -q -f i137_closure_check.sql -d "$AFLDB_OWNER_DATABASE_URL"

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

\echo '### session (db MUST read afldb_prod, ro MUST read on)'
SELECT current_database() AS db, current_user AS role,
       current_setting('default_transaction_read_only') AS ro,
       now() AT TIME ZONE 'Australia/Melbourne' AS local_time,
       version() AS server;

\echo ''
\echo '========================= PART A — LINEAGE FORENSICS (no pass criteria) ========================='

\echo ''
\echo '### A1. databases on this cluster (a completed cutover renames old prod to afldb_prod_pre_rebuild_<stamp>)'
SELECT datname,
       pg_size_pretty(pg_database_size(datname)) AS size,
       pg_get_userbyid(datdba) AS owner
  FROM pg_database
 WHERE datname LIKE 'afldb%'
 ORDER BY datname;

\echo ''
\echo '### A2. migration ledger (count, newest, and WHEN this lineage was migrated)'
SELECT count(*) AS applied,
       min(name) AS first_migration, max(name) AS last_migration,
       min(applied_at) AT TIME ZONE 'Australia/Melbourne' AS first_applied_local,
       max(applied_at) AT TIME ZONE 'Australia/Melbourne' AS last_applied_local
  FROM afldb_meta.schema_migrations;

\echo ''
\echo '### A2b. the ten most recently applied migrations'
SELECT name, applied_at AT TIME ZONE 'Australia/Melbourne' AS applied_local
  FROM afldb_meta.schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 10;

\echo ''
\echo '### A3. DECISIVE — does the 2026-09-04 repair audit trail still exist in this lineage?'
\echo '###     (batch 741 = "AFLDB-ISSUE-137 identity reconciliation", 742 = import_brownlow_season.py.'
\echo '###      ABSENT => this is not the database the repair was committed to.)'
SELECT id, tool, target_table, status,
       records_read, records_inserted, records_updated, records_rejected,
       started_at AT TIME ZONE 'Australia/Melbourne' AS started_local
  FROM import_batches
 WHERE id IN (741,742) OR tool ILIKE '%ISSUE-137%' OR tool ILIKE '%brownlow%'
 ORDER BY id;

\echo ''
\echo '### A4. import_batches shape (id space, age, and whether the settle chain is still writing)'
SELECT count(*) AS rows, min(id) AS min_id, max(id) AS max_id,
       min(started_at) AT TIME ZONE 'Australia/Melbourne' AS oldest_local,
       max(started_at) AT TIME ZONE 'Australia/Melbourne' AS newest_local,
       count(*) FILTER (WHERE status <> 'completed') AS not_completed
  FROM import_batches;

\echo ''
\echo '### A4b. the twelve most recent batches (proves settle-service execution from the ledger side)'
SELECT id, tool, target_table, status, records_read, records_inserted, records_updated, records_rejected,
       started_at AT TIME ZONE 'Australia/Melbourne' AS started_local,
       completed_at AT TIME ZONE 'Australia/Melbourne' AS completed_local
  FROM import_batches ORDER BY id DESC LIMIT 12;

\echo ''
\echo '### A5. derived rebuild ledger (a promotion/rebuild leaves its own run here)'
SELECT count(*) AS rows, min(id) AS min_id, max(id) AS max_id,
       max(started_at) AT TIME ZONE 'Australia/Melbourne' AS newest_local
  FROM derived_rebuilds;

\echo ''
\echo '### A6. core table census (canonical rebuilt lineage folds the four splits: players 13,271;'
\echo '###     the 2026-09-04 in-place repair left 13,273)'
SELECT (SELECT count(*) FROM players) AS players,
       (SELECT count(*) FROM external_identities) AS external_identities,
       (SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url') AS afltables_profile_ids,
       (SELECT count(*) FROM player_match_stats) AS player_match_stats,
       (SELECT count(*) FROM matches) AS matches,
       (SELECT count(*) FROM player_career_stats) AS player_career_stats;

\echo ''
\echo '### A7. schema generation: tables introduced after migration 085 (present => lineage carries 086+)'
SELECT c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relname IN ('coaches','match_coaches','external_grids','external_grid_sources',
                     'fixtures','club_leadership','captaincies','player_link_match_candidates',
                     'brownlow_season_votes','draft_persons')
 ORDER BY 1;

\echo ''
\echo '### A8. production-only state (a cutover replaces the rebuilt copy and reinstates these from the'
\echo '###     pre-cutover dump; zero/low rows where history is expected is the AFLDB-ISSUE-126 hazard)'
DO $inv$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth_users','auth_audit_log','auth_sessions','admin_invites',
                           'beta_access_codes','beta_allowed_emails','beta_join_requests',
                           'site_settings','site_media','data_edits','data_overrides',
                           'player_link_resolutions','player_link_match_candidates',
                           'nl_search_log','app_health_events','canonical_applications']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'PROD-ONLY %: <table absent>', t;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      RAISE NOTICE 'PROD-ONLY %: %', t, n;
    END IF;
  END LOOP;
END
$inv$;

\echo ''
\echo '========================= PART B — ISSUE-137 CLOSURE ON STABLE IDENTITY ========================='

\echo ''
\echo '### B1. the eight AFL Tables paths and who owns them now (expect 2 rows per career, ONE owner each)'
SELECT ei.external_id AS path, ei.status, ei.match_method,
       p.id AS player_id, p.display_name, p.dob, p.debut_season, p.final_season
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
  JOIN players p ON p.id = ei.player_id
 WHERE ei.external_id IN ('players/C/Charlie_Cameron.html','players/C/Charlie_Cameron3.html',
                          'players/J/Jack_Graham.html','players/J/Jack_Graham2.html',
                          'players/J/Jack_Ross.html','players/J/Jack_Ross3.html',
                          'players/J/Jack_Williams.html','players/J/Jack_Williams3.html')
 ORDER BY ei.external_id;

\echo ''
\echo '### B2. per-career reconciliation against the tracked 2026-09-04 figures (games may GROW — finals)'
WITH anchor(base_path, renum_path, name, dob, min_games, votes) AS (VALUES
  ('players/C/Charlie_Cameron.html','players/C/Charlie_Cameron3.html','Charlie Cameron','1994-07-05'::date,277,25),
  ('players/J/Jack_Graham.html',    'players/J/Jack_Graham2.html',    'Jack Graham',    '1998-02-25'::date,162, 9),
  ('players/J/Jack_Ross.html',      'players/J/Jack_Ross3.html',      'Jack Ross',      '2000-09-03'::date,112, 0),
  ('players/J/Jack_Williams.html',  'players/J/Jack_Williams3.html',  'Jack Williams',  '2003-12-01'::date, 54, 0)
), owned AS (
  SELECT a.*, ei.player_id
    FROM anchor a
    JOIN sources s ON s.key = 'afltables'
    JOIN external_identities ei ON ei.source_id = s.id
     AND ei.external_id IN (a.base_path, a.renum_path)
     AND ei.status IN ('unique','resolved')
)
SELECT o.name AS expected_name, o.dob AS expected_dob,
       count(*) AS identity_rows, count(DISTINCT o.player_id) AS owners,
       min(o.player_id) AS player_id_now,
       min(p.display_name) AS actual_name, min(p.dob) AS actual_dob,
       min(p.debut_season) AS debut, max(p.final_season) AS final_season,
       min(c.games) AS games, o.min_games AS games_2026_09_04,
       min(c.brownlow_votes) AS brownlow, o.votes AS brownlow_expected,
       (SELECT count(*) FROM player_match_stats m WHERE m.player_id = min(o.player_id)) AS match_rows
  FROM owned o
  JOIN players p ON p.id = o.player_id
  LEFT JOIN player_career_stats c ON c.player_id = o.player_id
 GROUP BY o.name, o.dob, o.min_games, o.votes
 ORDER BY o.name;

\echo ''
\echo '### B3a. modern same-name renumbered-profile split detector — TRACKED NARROW PREDICATE, THE'
\echo '###      BINDING GATE (restored from issues/closed/AFLDB-ISSUE-137-settle-check.sql, which'
\echo '###      remains the historical-lineage evidence this predicate was written against). A'
\echo '###      genuine unresolved duplicate from this identity-resolution path is a synthetic'
\echo '###      placeholder row: no DOB and a generic current-window debut season, never the'
\echo '###      recorded birth date and career start of an actual person. Expect 0 rows.'
SELECT d.external_id AS renumbered_path, dp.id AS dup_id, dp.display_name, dp.dob AS dup_dob,
       dp.debut_season AS dup_debut, dp.final_season AS dup_final,
       c.external_id AS base_path, cp.id AS base_id, cp.dob AS base_dob, cp.final_season AS base_final
  FROM external_identities d
  JOIN sources s ON s.id = d.source_id AND s.key = 'afltables'
  JOIN players dp ON dp.id = d.player_id
  JOIN external_identities c
    ON c.source_id = d.source_id AND c.match_method = d.match_method
   AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
   AND c.external_id <> d.external_id
  JOIN players cp ON cp.id = c.player_id
 WHERE d.match_method = 'afltables_profile_url'
   AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
   AND d.player_id <> c.player_id
   AND dp.dob IS NULL AND dp.debut_season >= 2025
   AND dp.display_name = cp.display_name
 ORDER BY 1;

\echo ''
\echo '### B3b. BROADER same-name detector — ADVISORY ONLY, NOT A GATE, NOT part of the VERDICT below.'
\echo '###      Drops the dob IS NULL / debut >= 2025 narrowing and keeps only debut >= 2015, which'
\echo '###      also matches a MODERN player whose base (unsuffixed) path is legitimately owned by an'
\echo '###      older, unrelated namesake — the opposite polarity to an actual ISSUE-137-style split.'
\echo '###      Repository evidence (data/awards/player-identity.csv) already confirms this false-'
\echo '###      positive shape for at least Archie Roberts (13168 -> Archie_Roberts1.html) and Luke'
\echo '###      Trainor (13191 -> Luke_Trainor1.html): both were adjudicated onto the SUFFIXED path by'
\echo '###      a prior tracked census, i.e. they are the correct, already-resolved identity, not an'
\echo '###      unresolved duplicate. Any row here needs the same per-pair check (career continuity +'
\echo '###      no DOB conflict) before being treated as a candidate split.'
SELECT d.external_id AS renumbered_path, dp.id AS dup_id, dp.display_name, dp.dob AS dup_dob,
       dp.debut_season AS dup_debut, dp.final_season AS dup_final,
       c.external_id AS base_path, cp.id AS base_id, cp.dob AS base_dob, cp.final_season AS base_final
  FROM external_identities d
  JOIN sources s ON s.id = d.source_id AND s.key = 'afltables'
  JOIN players dp ON dp.id = d.player_id
  JOIN external_identities c
    ON c.source_id = d.source_id AND c.match_method = d.match_method
   AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
   AND c.external_id <> d.external_id
  JOIN players cp ON cp.id = c.player_id
 WHERE d.match_method = 'afltables_profile_url'
   AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
   AND d.player_id <> c.player_id
   AND dp.display_name = cp.display_name
   AND dp.debut_season >= 2015
 ORDER BY 1;

\echo ''
\echo '### B4. the ISSUE-136 modern_four probe, by name not by id (expect exactly 4 rows, one per name)'
SELECT p.display_name, count(*) AS modern_players,
       string_agg(p.id::text || ' (' || COALESCE(p.dob::text,'no dob') || ', '
                  || p.debut_season || '-' || COALESCE(p.final_season::text,'?') || ')', ' | '
                  ORDER BY p.id) AS players
  FROM players p
 WHERE p.display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams')
   AND p.debut_season >= 2014
 GROUP BY p.display_name ORDER BY 1;

\echo ''
\echo '### B5. settle projections land on the canonical players (the original ISSUE-137 symptom was'
\echo '###     2026 settle rows accumulating on the duplicate). Expect one player per name.'
SELECT p.display_name, p.id AS player_id, count(*) AS staging_rows,
       min(st.season) AS first_season, max(st.season) AS last_season,
       count(*) FILTER (WHERE st.season = 2026) AS staging_2026
  FROM staging.afltables_player_match st
  JOIN players p ON p.id = st.player_id
 WHERE p.display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams')
   AND p.debut_season >= 2014
 GROUP BY p.display_name, p.id ORDER BY 1, 2;

\echo ''
\echo '### B6. Brownlow round votes, fingerprinted on the AFL Tables PATH rather than player_id.'
\echo '###     Fixed 2026-09-12: dual-path players (the four ISSUE-137 folds) were fanned out twice,'
\echo '###     once per registered path, inflating rows/votes by exactly their round-vote total'
\echo '###     (+499 rows / +34 votes, diagnosed in the 2026-09-12 handoff). one_path picks exactly'
\echo '###     one identity per player (the shortest external_id, i.e. the base non-suffixed path)'
\echo '###     before fingerprinting. The id-keyed F1 bb2a0471... is meaningless across a lineage'
\echo '###     change; this value is the forward-stable baseline. Aggregates must still read'
\echo '###     320,861 / 44,478 / max season 2025.'
WITH one_path AS (
  SELECT DISTINCT ON (ei.player_id) ei.player_id, ei.external_id
    FROM external_identities ei
    JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
   WHERE ei.match_method = 'afltables_profile_url'
   ORDER BY ei.player_id, length(ei.external_id), ei.external_id
)
SELECT count(*) AS rows, sum(b.votes) AS votes, max(b.season) AS last_season,
       count(DISTINCT b.player_id) AS players,
       md5(string_agg(op.external_id || ':' || b.season || ':' || b.round_number || ':' || b.votes,
                      ',' ORDER BY op.external_id, b.season, b.round_number)) AS path_fingerprint
  FROM brownlow_round_votes b
  JOIN one_path op ON op.player_id = b.player_id;

\echo ''
\echo '### B7. Brownlow anchors by path (tracked artefact expectations: 10 / 89 / 73 / 154 / 180)'
SELECT ei.external_id AS path, p.display_name, c.brownlow_votes
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
  JOIN players p ON p.id = ei.player_id
  LEFT JOIN player_career_stats c ON c.player_id = p.id
 WHERE ei.external_id IN ('players/H/Harley_Reid.html','players/M/Matt_Rowell.html',
                          'players/T/Tom_Green1.html','players/D/Dick_Reynolds.html',
                          'players/B/Bob_Skilton.html')
 ORDER BY ei.external_id;

\echo ''
\echo '### VERDICT (every row must read PASS; criteria are lineage-independent). Row 8 gates on B3a'
\echo '###     (tracked narrow predicate) only; B3b is advisory and intentionally excluded here.'
WITH anchor(base_path, renum_path, name, dob, min_games, votes) AS (VALUES
  ('players/C/Charlie_Cameron.html','players/C/Charlie_Cameron3.html','Charlie Cameron','1994-07-05'::date,277,25),
  ('players/J/Jack_Graham.html',    'players/J/Jack_Graham2.html',    'Jack Graham',    '1998-02-25'::date,162, 9),
  ('players/J/Jack_Ross.html',      'players/J/Jack_Ross3.html',      'Jack Ross',      '2000-09-03'::date,112, 0),
  ('players/J/Jack_Williams.html',  'players/J/Jack_Williams3.html',  'Jack Williams',  '2003-12-01'::date, 54, 0)
), owned AS (
  SELECT a.*, ei.player_id, ei.external_id
    FROM anchor a
    JOIN sources s ON s.key = 'afltables'
    JOIN external_identities ei ON ei.source_id = s.id
     AND ei.external_id IN (a.base_path, a.renum_path)
     AND ei.status IN ('unique','resolved')
), per_pair AS (
  SELECT o.name, o.dob, o.min_games, o.votes,
         count(*) AS identity_rows, count(DISTINCT o.player_id) AS owners, min(o.player_id) AS pid
    FROM owned o GROUP BY 1,2,3,4
), v AS (
  SELECT
    (SELECT count(*) FROM owned) AS path_rows,
    (SELECT count(DISTINCT player_id) FROM owned) AS distinct_owners,
    (SELECT count(*) FROM per_pair WHERE owners = 1) AS pairs_single_owner,
    (SELECT count(*) FROM per_pair pp JOIN players p ON p.id = pp.pid
      WHERE p.display_name = pp.name AND p.dob = pp.dob) AS identity_anchor_ok,
    (SELECT count(*) FROM per_pair pp JOIN players p ON p.id = pp.pid
      WHERE p.final_season = 2026) AS final_season_2026,
    (SELECT count(*) FROM per_pair pp JOIN player_career_stats c ON c.player_id = pp.pid
      WHERE c.games < pp.min_games) AS careers_shrunk,
    (SELECT count(*) FROM per_pair pp JOIN player_career_stats c ON c.player_id = pp.pid
      WHERE c.brownlow_votes = pp.votes) AS brownlow_ok,
    (SELECT count(*) FROM external_identities d
       JOIN sources s ON s.id = d.source_id AND s.key = 'afltables'
       JOIN players dp ON dp.id = d.player_id
       JOIN external_identities c ON c.source_id = d.source_id AND c.match_method = d.match_method
        AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
        AND c.external_id <> d.external_id
       JOIN players cp ON cp.id = c.player_id
      WHERE d.match_method = 'afltables_profile_url'
        AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
        AND d.player_id <> c.player_id AND dp.dob IS NULL AND dp.debut_season >= 2025
        AND dp.display_name = cp.display_name) AS modern_splits,
    (SELECT count(*) FROM players
      WHERE display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams')
        AND debut_season >= 2014) AS modern_four,
    (SELECT count(DISTINCT st.player_id) FROM staging.afltables_player_match st
       JOIN players p ON p.id = st.player_id
      WHERE p.display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams')
        AND p.debut_season >= 2014) AS staging_modern_players,
    (SELECT count(*) FROM brownlow_season_votes) AS bsv_rows,
    (SELECT sum(votes) FROM brownlow_season_votes) AS bsv_votes,
    (SELECT count(*) FROM brownlow_season_votes WHERE is_winner) AS bsv_winners,
    (SELECT count(DISTINCT season) FROM brownlow_season_votes) AS bsv_seasons,
    (SELECT count(DISTINCT player_id) FROM brownlow_season_votes) AS bsv_players,
    (SELECT count(*) FROM brownlow_round_votes) AS brv_rows,
    (SELECT sum(votes) FROM brownlow_round_votes) AS brv_votes,
    (SELECT max(season) FROM brownlow_round_votes) AS brv_last_season,
    (SELECT sum(brownlow_votes) FROM player_career_stats) AS career_brownlow,
    (SELECT sum(brownlow_votes) FROM player_season_stats) AS season_brownlow,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, count(*) AS actual FROM player_match_stats GROUP BY player_id) g
         ON g.player_id = c.player_id WHERE c.games <> COALESCE(g.actual, 0)) AS h_games,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, sum(goals) AS actual FROM player_match_stats GROUP BY player_id) g
         ON g.player_id = c.player_id WHERE c.goals <> COALESCE(g.actual, 0)) AS h_goals,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT pms.player_id, count(*) AS actual FROM player_match_stats pms
                    JOIN matches m ON m.id = pms.match_id WHERE m.is_finals_series
                   GROUP BY pms.player_id) f ON f.player_id = c.player_id
      WHERE c.finals <> COALESCE(f.actual, 0)) AS h_finals,
    (SELECT count(*) FROM player_career_stats c
       LEFT JOIN (SELECT player_id, sum(votes) AS actual FROM brownlow_season_votes GROUP BY player_id) b
         ON b.player_id = c.player_id WHERE c.brownlow_votes <> COALESCE(b.actual, 0)) AS h_brownlow,
    (SELECT count(*) FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id
      WHERE c.player_id IS NULL
        AND EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id = p.id)) AS h_missing
)
SELECT * FROM (
  SELECT  1 AS n, 'eight AFL Tables paths registered' AS check, v.path_rows::text AS actual, '8' AS expected,
          CASE WHEN v.path_rows = 8 THEN 'PASS' ELSE 'CHECK' END AS verdict FROM v
  UNION ALL SELECT  2, 'paths owned by exactly four players', v.distinct_owners::text, '4',
          CASE WHEN v.distinct_owners = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  3, 'each base+renumbered pair has ONE owner', v.pairs_single_owner::text, '4',
          CASE WHEN v.pairs_single_owner = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  4, 'owner name+dob matches tracked identity', v.identity_anchor_ok::text, '4',
          CASE WHEN v.identity_anchor_ok = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  5, 'career final_season = 2026', v.final_season_2026::text, '4',
          CASE WHEN v.final_season_2026 = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  6, 'no career below its 2026-09-04 games', v.careers_shrunk::text, '0',
          CASE WHEN v.careers_shrunk = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  7, 'career Brownlow votes 25/9/0/0', v.brownlow_ok::text, '4',
          CASE WHEN v.brownlow_ok = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  8, 'no modern renumbered-profile split (B3a, tracked narrow predicate)', v.modern_splits::text, '0',
          CASE WHEN v.modern_splits = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT  9, 'modern_four (one player per name)', v.modern_four::text, '4',
          CASE WHEN v.modern_four = 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 10, 'settle rows on <= 4 modern players', v.staging_modern_players::text, '<= 4',
          CASE WHEN v.staging_modern_players <= 4 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 11, 'brownlow_season_votes rows', v.bsv_rows::text, '16120',
          CASE WHEN v.bsv_rows = 16120 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 12, 'brownlow_season_votes votes', v.bsv_votes::text, '79113',
          CASE WHEN v.bsv_votes = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 13, 'brownlow winners / seasons / players',
          v.bsv_winners::text || ' / ' || v.bsv_seasons::text || ' / ' || v.bsv_players::text, '112 / 98 / 4275',
          CASE WHEN v.bsv_winners = 112 AND v.bsv_seasons = 98 AND v.bsv_players = 4275 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 14, 'brownlow_round_votes rows / votes',
          v.brv_rows::text || ' / ' || v.brv_votes::text, '320861 / 44478',
          CASE WHEN v.brv_rows = 320861 AND v.brv_votes = 44478 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 15, 'brownlow_round_votes last season', v.brv_last_season::text, '2025',
          CASE WHEN v.brv_last_season = 2025 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 16, 'derived career Brownlow total', v.career_brownlow::text, '79113',
          CASE WHEN v.career_brownlow = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 17, 'derived season Brownlow total', v.season_brownlow::text, '79113',
          CASE WHEN v.season_brownlow = 79113 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 18, 'db-health games', v.h_games::text, '0',
          CASE WHEN v.h_games = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 19, 'db-health goals', v.h_goals::text, '0',
          CASE WHEN v.h_goals = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 20, 'db-health finals', v.h_finals::text, '0',
          CASE WHEN v.h_finals = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 21, 'db-health brownlow', v.h_brownlow::text, '0',
          CASE WHEN v.h_brownlow = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
  UNION ALL SELECT 22, 'db-health missing career row', v.h_missing::text, '0',
          CASE WHEN v.h_missing = 0 THEN 'PASS' ELSE 'CHECK' END FROM v
) t ORDER BY n;
