-- AFLDB-ISSUE-137 T1 -- supervised in-place identity reconciliation on afldb_prod (runbook 3.1-3.3).
-- Run as afldb_owner from ~/projects/afldb with the host .env sourced:
--   rehearsal (ends with ROLLBACK, writes nothing):
--     psql -X -v ON_ERROR_STOP=1 -P pager=off -d "$AFLDB_OWNER_DATABASE_URL" -f i137_t1.sql
--   production write (ends with COMMIT):
--     psql -X -v ON_ERROR_STOP=1 -P pager=off -d "$AFLDB_OWNER_DATABASE_URL" -v commit=1 -f i137_t1.sql
-- Every refusal condition RAISEs inside the DO block; psql then exits 3 and the server rolls the
-- transaction back. Nothing is written unless every assertion passes AND -v commit=1 was given.
\set ON_ERROR_STOP on
\pset pager off
SELECT current_database() AS db, current_user AS usr, now() AS started_at,
       current_setting('default_transaction_read_only') AS ro;
\if :{?commit}
\echo '### MODE: COMMIT (production write)'
\else
\echo '### MODE: REHEARSAL (ends with ROLLBACK)'
\endif

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
-- 3.4: block concurrent writers (a settle) for the sub-second duration; readers are unaffected.
LOCK TABLE players, external_identities, player_match_stats, brownlow_round_votes,
           award_winners, award_nominations, staging.afltables_player_match IN EXCLUSIVE MODE;

-- 3.1 mapping: derived from the identity table, never typed.
CREATE TEMP TABLE i137_map ON COMMIT DROP AS
SELECT d.player_id AS dup_id, c.player_id AS career_id,
       d.external_id AS renumbered_path, c.external_id AS continuing_path,
       CASE d.external_id
         WHEN 'players/C/Charlie_Cameron3.html' THEN '2025-charlie-cameron-renumbered-profile'
         WHEN 'players/J/Jack_Graham2.html'     THEN '2025-jack-graham-renumbered-profile'
         WHEN 'players/J/Jack_Ross3.html'       THEN '2025-jack-ross-renumbered-profile'
         WHEN 'players/J/Jack_Williams3.html'   THEN '2025-jack-williams-renumbered-profile'
       END AS rule_id
  FROM external_identities d
  JOIN sources s ON s.id = d.source_id
  JOIN external_identities c ON c.source_id = d.source_id AND c.match_method = d.match_method
   AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
 WHERE s.key = 'afltables' AND d.match_method = 'afltables_profile_url'
   AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
   AND d.external_id IN ('players/C/Charlie_Cameron3.html','players/J/Jack_Graham2.html',
                         'players/J/Jack_Ross3.html','players/J/Jack_Williams3.html');

\echo '### mapping'
SELECT * FROM i137_map ORDER BY dup_id;

DO $t1$
DECLARE
  n bigint;
  r record;
  dups int[];
  actual text;
  today text := to_char(now() AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD');
  expected_map CONSTANT text := '(2608,2604),(6296,6293),(6525,6521),(6626,6622)';
  expected_103 CONSTANT text :=
    '2604:players/C/Charlie_Cameron.html,players/C/Charlie_Cameron3.html;'
    '6293:players/J/Jack_Graham.html,players/J/Jack_Graham2.html;'
    '6521:players/J/Jack_Ross.html,players/J/Jack_Ross3.html;'
    '6622:players/J/Jack_Williams.html,players/J/Jack_Williams3.html';
BEGIN
  ---------------------------------------------------------------- 3.3 refusal conditions
  -- R1 mapping is exactly the four pairs
  SELECT string_agg(format('(%s,%s)', dup_id, career_id), ',' ORDER BY dup_id) INTO actual FROM i137_map;
  IF actual IS DISTINCT FROM expected_map THEN
    RAISE EXCEPTION 'refuse R1: mapping % <> expected %', actual, expected_map;
  END IF;
  IF EXISTS (SELECT 1 FROM i137_map WHERE dup_id = career_id OR rule_id IS NULL) THEN
    RAISE EXCEPTION 'refuse R1: degenerate mapping';
  END IF;
  SELECT array_agg(dup_id ORDER BY dup_id) INTO dups FROM i137_map;

  -- R6 start count
  SELECT count(*) INTO n FROM players;
  IF n <> 13277 THEN RAISE EXCEPTION 'refuse R6: players = % at start (expected 13277)', n; END IF;

  -- R2 the player rows still look as measured
  SELECT count(*) INTO n FROM players p JOIN i137_map m ON m.dup_id = p.id
   WHERE p.dob IS NULL AND p.debut_season = 2025 AND p.final_season = 2026;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R2: duplicates with (dob NULL, debut 2025, final 2026) = % (expected 4)', n; END IF;
  SELECT count(*) INTO n FROM players p JOIN i137_map m ON m.career_id = p.id
   WHERE p.dob IS NOT NULL AND p.final_season = 2024;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R2: career players with (dob set, final 2024) = % (expected 4)', n; END IF;
  -- every one of the eight has exactly one identity
  SELECT count(*) INTO n FROM external_identities ei
   WHERE ei.player_id IN (SELECT dup_id FROM i137_map UNION SELECT career_id FROM i137_map);
  IF n <> 8 THEN RAISE EXCEPTION 'refuse R2: identities on the eight players = % (expected 8)', n; END IF;

  -- FK inventory unchanged (27 FK columns reference players)
  SELECT count(*) INTO n FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE c.contype = 'f' AND c.confrelid = 'public.players'::regclass;
  IF n <> 27 THEN RAISE EXCEPTION 'refuse: FK columns referencing players = % (expected 27)', n; END IF;

  -- R3 collision probes on the fact tables (re-run of 1.5 inside the transaction)
  SELECT count(*) INTO n FROM i137_map m
    JOIN player_match_stats a ON a.player_id = m.dup_id
    JOIN player_match_stats b ON b.player_id = m.career_id AND b.match_id = a.match_id;
  IF n <> 0 THEN RAISE EXCEPTION 'refuse R3: player_match_stats collisions = %', n; END IF;
  SELECT count(*) INTO n FROM i137_map m
    JOIN brownlow_round_votes a ON a.player_id = m.dup_id
    JOIN brownlow_round_votes b ON b.player_id = m.career_id AND b.season = a.season AND b.round_number = a.round_number;
  IF n <> 0 THEN RAISE EXCEPTION 'refuse R3: brownlow_round_votes collisions = %', n; END IF;
  SELECT count(*) INTO n FROM i137_map m
    JOIN award_winners a ON a.player_id = m.dup_id
    JOIN award_winners b ON b.player_id = m.career_id
     AND b.source_id IS NOT DISTINCT FROM a.source_id AND b.source_record_id IS NOT DISTINCT FROM a.source_record_id;
  IF n <> 0 THEN RAISE EXCEPTION 'refuse R3: award_winners collisions = %', n; END IF;
  SELECT count(*) INTO n FROM i137_map m
    JOIN award_nominations a ON a.player_id = m.dup_id
    JOIN award_nominations b ON b.player_id = m.career_id
     AND b.source_id IS NOT DISTINCT FROM a.source_id AND b.source_record_id IS NOT DISTINCT FROM a.source_record_id;
  IF n <> 0 THEN RAISE EXCEPTION 'refuse R3: award_nominations collisions = %', n; END IF;
  SELECT count(*) INTO n FROM i137_map m
    JOIN staging.afltables_player_match a ON a.player_id = m.dup_id
    JOIN staging.afltables_player_match b ON b.player_id = m.career_id AND b.source_id = a.source_id AND b.match_key = a.match_key;
  IF n <> 0 THEN RAISE EXCEPTION 'refuse R3: staging.afltables_player_match collisions = %', n; END IF;

  -- R4 no NO ACTION FK column other than the six planned ones holds a duplicate id
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.players'::regclass AND c.confdeltype = 'a'
       AND (c.conrelid::regclass::text, a.attname::text) NOT IN (
             ('player_match_stats','player_id'), ('brownlow_round_votes','player_id'),
             ('award_winners','player_id'), ('award_nominations','player_id'),
             ('external_identities','player_id'), ('staging.afltables_player_match','player_id'))
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.tbl, r.col) INTO n USING dups;
    IF n <> 0 THEN RAISE EXCEPTION 'refuse R4: % duplicate rows in %.% (outside the six planned columns)', n, r.tbl, r.col; END IF;
  END LOOP;

  ---------------------------------------------------------------- 3.2 statements, each count-asserted (R5)
  -- 1 external_identities: re-point the renumbered path and annotate as the ISSUE-136 fold does
  UPDATE external_identities ei
     SET player_id = m.career_id,
         notes = format('Matched on profile URL, not name. AFLDB-ISSUE-136 profile_url_continuity %s: '
                        'AFL Tables renumbered this player''s profile; same player as %s. '
                        'Re-pointed on production under AFLDB-ISSUE-137 on %s.',
                        m.rule_id, m.continuing_path, today)
    FROM i137_map m, sources s
   WHERE s.key = 'afltables' AND ei.source_id = s.id
     AND ei.external_id = m.renumbered_path AND ei.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R5: external_identities updated % (expected 4)', n; END IF;
  RAISE NOTICE 'external_identities re-pointed: %', n;

  -- 2 player_match_stats
  UPDATE player_match_stats t SET player_id = m.career_id FROM i137_map m WHERE t.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 146 THEN RAISE EXCEPTION 'refuse R5: player_match_stats updated % (expected 146)', n; END IF;
  RAISE NOTICE 'player_match_stats re-pointed: %', n;

  -- 3 brownlow_round_votes
  UPDATE brownlow_round_votes t SET player_id = m.career_id FROM i137_map m WHERE t.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 75 THEN RAISE EXCEPTION 'refuse R5: brownlow_round_votes updated % (expected 75)', n; END IF;
  RAISE NOTICE 'brownlow_round_votes re-pointed: %', n;

  -- 4 award_winners
  UPDATE award_winners t SET player_id = m.career_id FROM i137_map m WHERE t.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'refuse R5: award_winners updated % (expected 5)', n; END IF;
  RAISE NOTICE 'award_winners re-pointed: %', n;

  -- 5 award_nominations
  UPDATE award_nominations t SET player_id = m.career_id FROM i137_map m WHERE t.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'refuse R5: award_nominations updated % (expected 1)', n; END IF;
  RAISE NOTICE 'award_nominations re-pointed: %', n;

  -- 6 staging.afltables_player_match (2026 settle projections)
  UPDATE staging.afltables_player_match t SET player_id = m.career_id FROM i137_map m WHERE t.player_id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 67 THEN RAISE EXCEPTION 'refuse R5: staging.afltables_player_match updated % (expected 67)', n; END IF;
  RAISE NOTICE 'staging.afltables_player_match re-pointed: %', n;

  -- 7 players.final_season on the career rows (2024 -> 2026); no other column is copied
  UPDATE players p SET final_season = GREATEST(p.final_season, d.final_season)
    FROM i137_map m JOIN players d ON d.id = m.dup_id
   WHERE p.id = m.career_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R5: players.final_season updated % (expected 4)', n; END IF;
  SELECT count(*) INTO n FROM players p JOIN i137_map m ON m.career_id = p.id WHERE p.final_season = 2026;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R5: career players at final_season 2026 = % (expected 4)', n; END IF;
  RAISE NOTICE 'players.final_season extended: 4';

  -- 8 generic guard: every NO ACTION FK column now holds zero duplicate ids
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.players'::regclass AND c.confdeltype = 'a'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.tbl, r.col) INTO n USING dups;
    IF n <> 0 THEN RAISE EXCEPTION 'refuse #8: % duplicate rows remain in %.%', n, r.tbl, r.col; END IF;
  END LOOP;
  -- cascade children about to be removed with the duplicates (informational)
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.players'::regclass AND c.confdeltype = 'c'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.tbl, r.col) INTO n USING dups;
    IF n > 0 THEN RAISE NOTICE 'cascade will remove % rows from %.%', n, r.tbl, r.col; END IF;
  END LOOP;

  -- 9 retire exactly the four duplicate players rows (PostgreSQL refuses if any NO ACTION child remains)
  DELETE FROM players p USING i137_map m WHERE p.id = m.dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R5: players deleted % (expected 4)', n; END IF;
  RAISE NOTICE 'players retired: %', n;

  -- 10 audit record (ISSUE-126 expectation)
  INSERT INTO import_batches (source_id, tool, target_table, started_at, completed_at, status,
                              records_read, records_inserted, records_updated, records_rejected,
                              validation_result, notes)
  SELECT s.id, 'AFLDB-ISSUE-137 identity reconciliation', 'players', now(), now(), 'completed',
         8, 0, 298, 0,
         jsonb_build_object(
           'mapping', (SELECT jsonb_agg(jsonb_build_object('duplicate', dup_id, 'career', career_id,
                          'renumbered_path', renumbered_path, 'continuing_path', continuing_path, 'rule', rule_id)
                          ORDER BY dup_id) FROM i137_map),
           'external_identities', 4, 'player_match_stats', 146, 'brownlow_round_votes', 75,
           'award_winners', 5, 'award_nominations', 1, 'staging.afltables_player_match', 67,
           'players_final_season', 4, 'players_deleted', 4),
         'AFLDB-ISSUE-137: supervised in-place reconciliation of the four AFLDB-ISSUE-136 renumbered-profile '
         'splits on production (2608->2604 Charlie Cameron, 6296->6293 Jack Graham, 6525->6521 Jack Ross, '
         '6626->6622 Jack Williams). Mapping derived from external_identities; six fact-table FK columns '
         're-pointed with count assertions; four duplicate players rows retired after every NO ACTION '
         'reference was cleared; derived tables rebuilt separately by rebuild_derived.py.'
    FROM sources s WHERE s.key = 'afltables';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'refuse: audit row inserted % (expected 1)', n; END IF;

  ---------------------------------------------------------------- 3.2 post-conditions (R6, R7)
  SELECT count(*) INTO n FROM players;
  IF n <> 13273 THEN RAISE EXCEPTION 'refuse R6: players = % at end (expected 13273)', n; END IF;
  SELECT string_agg(format('%s:%s', player_id, paths), ';' ORDER BY player_id) INTO actual FROM (
    SELECT ei.player_id, array_to_string(array_agg(ei.external_id ORDER BY ei.external_id), ',') AS paths
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique','resolved')
     GROUP BY ei.player_id HAVING count(*) > 1) x;
  IF actual IS DISTINCT FROM expected_103 THEN RAISE EXCEPTION 'refuse R7: 10.3 result % <> expected %', actual, expected_103; END IF;
  SELECT count(*) INTO n FROM players WHERE display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams') AND debut_season >= 2014;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse R7: modern_four = % (expected 4)', n; END IF;
  SELECT count(*) INTO n FROM external_identities;           IF n <> 18332  THEN RAISE EXCEPTION 'refuse: external_identities = % (expected 18332)', n; END IF;
  SELECT count(*) INTO n FROM player_match_stats;            IF n <> 694273 THEN RAISE EXCEPTION 'refuse: player_match_stats = % (expected 694273)', n; END IF;
  SELECT count(*) INTO n FROM brownlow_round_votes;          IF n <> 320861 THEN RAISE EXCEPTION 'refuse: brownlow_round_votes = % (expected 320861)', n; END IF;
  SELECT sum(votes) INTO n FROM brownlow_round_votes;        IF n <> 44478  THEN RAISE EXCEPTION 'refuse: brownlow_round_votes votes = % (expected 44478)', n; END IF;
  SELECT count(*) INTO n FROM award_winners;                 IF n <> 3298   THEN RAISE EXCEPTION 'refuse: award_winners = % (expected 3298)', n; END IF;
  SELECT count(*) INTO n FROM award_nominations;             IF n <> 766    THEN RAISE EXCEPTION 'refuse: award_nominations = % (expected 766)', n; END IF;
  -- per career player: match rows 277/162/112/54, first season unchanged, last season 2026
  SELECT string_agg(format('%s:%s:%s-%s', x.player_id, x.rows, x.first, x.last), ';' ORDER BY x.player_id) INTO actual FROM (
    SELECT pms.player_id, count(*) AS rows, min(m.season) AS first, max(m.season) AS last
      FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
     WHERE pms.player_id IN (SELECT career_id FROM i137_map) GROUP BY 1) x;
  IF actual IS DISTINCT FROM '2604:277:2014-2026;6293:162:2017-2026;6521:112:2019-2026;6622:54:2022-2026' THEN
    RAISE EXCEPTION 'refuse: career match spans % <> expected', actual;
  END IF;
  -- renumbered identities now on the career id and still unique; HALT predicate (A4) = 1 per pair
  SELECT count(*) INTO n FROM external_identities ei JOIN i137_map m ON m.renumbered_path = ei.external_id
   WHERE ei.player_id = m.career_id AND ei.status = 'unique';
  IF n <> 4 THEN RAISE EXCEPTION 'refuse: renumbered identities on career id with status unique = % (expected 4)', n; END IF;
  SELECT count(*) INTO n FROM i137_map m
   WHERE (SELECT count(DISTINCT ei.player_id) FROM external_identities ei WHERE ei.external_id IN (m.renumbered_path, m.continuing_path)) = 1;
  IF n <> 4 THEN RAISE EXCEPTION 'refuse: HALT predicate pairs resolving to one player = % (expected 4)', n; END IF;
  RAISE NOTICE 'all assertions passed';
END
$t1$;

\echo '### post-state (inside the transaction)'
SELECT ei.player_id, array_agg(ei.external_id ORDER BY ei.external_id) AS paths
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique','resolved')
 GROUP BY ei.player_id HAVING count(*) > 1 ORDER BY 1;
SELECT id, display_name, dob, debut_season, final_season FROM players
 WHERE id IN (2604,2608,6293,6296,6521,6525,6622,6626) ORDER BY 1;
SELECT ei.id, ei.player_id, ei.external_id, ei.status, ei.notes FROM external_identities ei
 WHERE ei.external_id IN ('players/C/Charlie_Cameron3.html','players/J/Jack_Graham2.html','players/J/Jack_Ross3.html','players/J/Jack_Williams3.html') ORDER BY 1;
SELECT 'players' AS t, count(*) AS n, md5(string_agg(id||':'||display_name||':'||slug, ',' ORDER BY id)) AS fp FROM players
UNION ALL SELECT 'external_identities', count(*), md5(string_agg(id||':'||source_id||':'||external_id||':'||coalesce(player_id,-1)||':'||status, ',' ORDER BY id)) FROM external_identities
UNION ALL SELECT 'player_match_stats', count(*), md5(string_agg(player_id||':'||match_id, ',' ORDER BY match_id, player_id)) FROM player_match_stats
UNION ALL SELECT 'award_winners', count(*), md5(string_agg(id||':'||coalesce(player_id,-1), ',' ORDER BY id)) FROM award_winners
UNION ALL SELECT 'award_nominations', count(*), md5(string_agg(id||':'||coalesce(player_id,-1), ',' ORDER BY id)) FROM award_nominations;
SELECT count(*) AS round_rows, sum(votes) AS round_votes,
       md5(string_agg(season||':'||player_id||':'||round_number||':'||votes, ',' ORDER BY season, player_id, round_number)) AS fingerprint_f1
  FROM brownlow_round_votes;
SELECT id, tool, target_table, status, records_updated, started_at FROM import_batches
 WHERE tool = 'AFLDB-ISSUE-137 identity reconciliation' ORDER BY id DESC LIMIT 1;

\if :{?commit}
COMMIT;
\echo '### COMMITTED'
\else
ROLLBACK;
\echo '### ROLLED BACK (rehearsal; nothing written)'
\endif
