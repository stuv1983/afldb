-- AFLDB-ISSUE-267 / AFLDB-ISSUE-269: guarded removal of the 2026-10-09 failed run's fixture residue on afldb_test.
--
-- Operator-run only, AFTER AFLDB-ISSUE-267-269-fixture-residue-census.sql has been run and reviewed.
-- Refuses unless the database name ends in _test. Run as the role the integration suite uses
-- (AFLDB_TEST_DATABASE_URL, the table owner): data_edits is append-only for the application roles.
--
-- DRY RUN BY DEFAULT. Everything runs in one transaction that ends in ROLLBACK unless
-- -v recover_commit=1 is given. Run it once without, read the NOTICEs, then once with.
--
-- REQUIRED: -v expect_matches=N -v expect_period_rows=N -v expect_overrides=N -v expect_edits=N
--           -v expect_club_seasons=N -v expect_season=N
-- copied from census section 8. They bind this run to the state the operator reviewed: each is
-- compared with the live count before anything is deleted, and with the row count of its DELETE.
--
-- OWNERSHIP. Nothing is deleted for being in season 2081. Before the first DELETE, the DO block
-- refuses (RAISE, so the whole transaction rolls back and nothing is removed) on any of:
--   * a season-2081 or 2081|issue267-* match without the full fixture signature;
--   * a season-2081 club_seasons row without the fixture signature;
--   * a matches override keyed to a namespace match but outside 2081|issue267-*;
--   * an audit row on a namespace match not noted 'issue-267 replay', or a noted row on a foreign match;
--   * a seasons row 2081 whose league is not AFL;
--   * ANY row, in any table with a foreign key into seasons, referencing season 2081, other than
--     matches.season and club_seasons.season (catalogue-enumerated);
--   * ANY row, in any table with a foreign key into matches, on a namespace match, other than
--     match_period_scores.match_id (catalogue-enumerated);
--   * a multi-column foreign key into either table (not evaluated, so not assumed safe);
--   * any expect_* value that differs from the live count;
-- and after each DELETE, on any row count that differs from its expect_* value. The fixture
-- signature is the one the census prints (header of the census file).
--
-- Exit status (psql, with ON_ERROR_STOP on): 0 and a final '== Done (COMMITTED).' or
-- '== Done (ROLLED BACK: dry run).' line; 3 on a refusal or any failed statement (nothing committed).

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset null '(null)'

-- A missing expect_* stops the script before BEGIN: the failing SELECT exits 3 under ON_ERROR_STOP.
\if :{?expect_matches}
\else
  \echo 'REFUSED: -v expect_matches=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_matches;
\endif
\if :{?expect_period_rows}
\else
  \echo 'REFUSED: -v expect_period_rows=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_period_rows;
\endif
\if :{?expect_overrides}
\else
  \echo 'REFUSED: -v expect_overrides=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_overrides;
\endif
\if :{?expect_edits}
\else
  \echo 'REFUSED: -v expect_edits=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_edits;
\endif
\if :{?expect_club_seasons}
\else
  \echo 'REFUSED: -v expect_club_seasons=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_club_seasons;
\endif
\if :{?expect_season}
\else
  \echo 'REFUSED: -v expect_season=N is required (census section 8). Nothing was run.'
  SELECT 1 / 0 AS refused_missing_expect_season;
\endif

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

SELECT set_config('issue267.expect_matches',      :'expect_matches',      true),
       set_config('issue267.expect_period_rows',  :'expect_period_rows',  true),
       set_config('issue267.expect_overrides',    :'expect_overrides',    true),
       set_config('issue267.expect_edits',        :'expect_edits',        true),
       set_config('issue267.expect_club_seasons', :'expect_club_seasons', true),
       set_config('issue267.expect_season',       :'expect_season',       true)
\gset ignored_

\echo '== Target'
SELECT current_database() AS database, current_user AS role;

DO $recover$
DECLARE
    root        constant text := '2081|issue267-';
    note_267    constant text := 'issue-267 replay';
    e_matches   constant bigint := current_setting('issue267.expect_matches')::bigint;
    e_periods   constant bigint := current_setting('issue267.expect_period_rows')::bigint;
    e_overrides constant bigint := current_setting('issue267.expect_overrides')::bigint;
    e_edits     constant bigint := current_setting('issue267.expect_edits')::bigint;
    e_ladder    constant bigint := current_setting('issue267.expect_club_seasons')::bigint;
    e_season    constant bigint := current_setting('issue267.expect_season')::bigint;
    pair        int[];
    fx_ids      int[];
    afltables   int;
    n           bigint;
    fk          record;
BEGIN
    IF current_database() !~ '_test$' THEN
        RAISE EXCEPTION 'REFUSED: % is not a _test database', current_database();
    END IF;

    -- Lock the namespace rows first, so nothing checked below changes before it is deleted.
    PERFORM 1 FROM seasons WHERE year = 2081 FOR UPDATE;
    PERFORM 1 FROM matches WHERE season = 2081 OR starts_with(match_key, root) FOR UPDATE;
    PERFORM 1 FROM club_seasons WHERE season = 2081 FOR UPDATE;

    SELECT array_agg(id ORDER BY id) INTO pair
      FROM (SELECT DISTINCT ON (organization_id) id FROM clubs
             WHERE organization_id IS NOT NULL ORDER BY organization_id, id LIMIT 2) p;
    SELECT id INTO afltables FROM sources WHERE key = 'afltables';
    -- A signature test against a NULL pair or source would be NULL, never "foreign": refuse first.
    IF cardinality(pair) IS DISTINCT FROM 2 OR afltables IS NULL THEN
        RAISE EXCEPTION 'REFUSED: the fixture club pair (%) or the afltables source (%) does not resolve', pair, afltables;
    END IF;

    -- O1. Every namespace match carries the full fixture signature. IS NOT TRUE: a NULL
    -- signature column (venue_raw, say) counts as foreign, never as the fixture's.
    SELECT count(*) INTO n FROM matches m
     WHERE (m.season = 2081 OR starts_with(m.match_key, root))
       AND (m.season = 2081 AND starts_with(m.match_key, root)
            AND m.venue_raw = 'ISSUE-267 Fixture Oval' AND m.round_code = '1'
            AND m.match_date = DATE '2081-03-05'
            AND m.home_club_id = ANY(pair) AND m.away_club_id = ANY(pair)) IS NOT TRUE;
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: % season-2081 / 2081|issue267-* match(es) lack the fixture signature', n;
    END IF;
    SELECT COALESCE(array_agg(id::int), '{}') INTO fx_ids
      FROM matches WHERE season = 2081 OR starts_with(match_key, root);

    -- O2. Every season-2081 ladder row carries the fixture signature.
    SELECT count(*) INTO n FROM club_seasons cs
     WHERE cs.season = 2081
       AND (cs.club_id = ANY(pair) AND cs.source_id = afltables AND cs.import_batch_id IS NULL
            AND NOT cs.is_premier AND COALESCE(cs.finals_played, 0) = 0) IS NOT TRUE;
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: % season-2081 club_seasons row(s) lack the fixture signature', n;
    END IF;

    -- O3. No override on a namespace match outside the fixture key root.
    SELECT count(*) INTO n FROM data_overrides o
     WHERE o.entity_type = 'matches'
       AND o.entity_key IN (SELECT match_key FROM matches WHERE id = ANY(fx_ids))
       AND NOT starts_with(o.entity_key, root);
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: % override(s) on a namespace match outside %*', n, root;
    END IF;

    -- O4. Audit rows: none on a namespace match from anyone else; no noted row on a foreign match.
    SELECT count(*) INTO n FROM data_edits d
     WHERE d.table_name = 'matches' AND d.row_id = ANY(fx_ids) AND d.note IS DISTINCT FROM note_267;
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: % audit row(s) on a namespace match are not noted %', n, quote_literal(note_267);
    END IF;
    SELECT count(*) INTO n FROM data_edits d
     WHERE d.table_name = 'matches' AND d.note = note_267
       AND d.row_id IN (SELECT id FROM matches) AND NOT (d.row_id = ANY(fx_ids));
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: % audit row(s) noted % sit on a match outside the namespace', n, quote_literal(note_267);
    END IF;

    -- O5. The season row is the fixture's shape.
    SELECT count(*) INTO n FROM seasons WHERE year = 2081 AND league IS DISTINCT FROM 'AFL';
    IF n > 0 THEN
        RAISE EXCEPTION 'REFUSED: seasons row 2081 is not an AFL season';
    END IF;

    -- O6. Nothing else references season 2081 (catalogue-enumerated).
    FOR fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col, ra.attname AS refcol, cardinality(c.conkey) AS k
          FROM pg_constraint c
          JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'seasons'::regclass
    LOOP
        IF fk.k <> 1 THEN
            RAISE EXCEPTION 'REFUSED: multi-column foreign key from % into seasons is not evaluated', fk.tbl;
        END IF;
        CONTINUE WHEN (fk.tbl = 'matches'::regclass AND fk.col = 'season')
                   OR (fk.tbl = 'club_seasons'::regclass AND fk.col = 'season');
        EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT %I FROM seasons WHERE year = 2081)',
                       fk.tbl, fk.col, fk.refcol) INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'REFUSED: %.% holds % row(s) referencing season 2081', fk.tbl, fk.col, n;
        END IF;
    END LOOP;

    -- O7. Nothing but period rows hangs off a namespace match (catalogue-enumerated).
    FOR fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col, ra.attname AS refcol, cardinality(c.conkey) AS k
          FROM pg_constraint c
          JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'matches'::regclass
    LOOP
        IF fk.k <> 1 THEN
            RAISE EXCEPTION 'REFUSED: multi-column foreign key from % into matches is not evaluated', fk.tbl;
        END IF;
        CONTINUE WHEN fk.tbl = 'match_period_scores'::regclass AND fk.col = 'match_id';
        EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT %I FROM matches WHERE id = ANY($1))',
                       fk.tbl, fk.col, fk.refcol) INTO n USING fx_ids;
        IF n > 0 THEN
            RAISE EXCEPTION 'REFUSED: %.% holds % row(s) on a namespace match', fk.tbl, fk.col, n;
        END IF;
    END LOOP;

    -- O8. The live state is the state the operator reviewed.
    IF cardinality(fx_ids) <> e_matches THEN
        RAISE EXCEPTION 'REFUSED: % fixture match(es) now, census said %', cardinality(fx_ids), e_matches;
    END IF;
    SELECT count(*) INTO n FROM match_period_scores WHERE match_id = ANY(fx_ids);
    IF n <> e_periods THEN RAISE EXCEPTION 'REFUSED: % period row(s) now, census said %', n, e_periods; END IF;
    SELECT count(*) INTO n FROM data_overrides WHERE entity_type = 'matches' AND starts_with(entity_key, root);
    IF n <> e_overrides THEN RAISE EXCEPTION 'REFUSED: % override(s) now, census said %', n, e_overrides; END IF;
    SELECT count(*) INTO n FROM data_edits WHERE table_name = 'matches' AND note = note_267;
    IF n <> e_edits THEN RAISE EXCEPTION 'REFUSED: % audit row(s) now, census said %', n, e_edits; END IF;
    SELECT count(*) INTO n FROM club_seasons WHERE season = 2081;
    IF n <> e_ladder THEN RAISE EXCEPTION 'REFUSED: % club_seasons row(s) now, census said %', n, e_ladder; END IF;
    SELECT count(*) INTO n FROM seasons WHERE year = 2081;
    IF n <> e_season THEN RAISE EXCEPTION 'REFUSED: % seasons row(s) now, census said %', n, e_season; END IF;

    RAISE NOTICE 'ownership checks passed: fixture pair %, % fixture match(es)', pair, cardinality(fx_ids);

    -- Removal, children first. Each DELETE must remove exactly its reviewed count.
    DELETE FROM data_overrides WHERE entity_type = 'matches' AND starts_with(entity_key, root);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_overrides THEN RAISE EXCEPTION 'REFUSED: data_overrides DELETE removed %, expected %', n, e_overrides; END IF;

    DELETE FROM data_edits WHERE table_name = 'matches' AND note = note_267;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_edits THEN RAISE EXCEPTION 'REFUSED: data_edits DELETE removed %, expected %', n, e_edits; END IF;

    DELETE FROM match_period_scores WHERE match_id = ANY(fx_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_periods THEN RAISE EXCEPTION 'REFUSED: match_period_scores DELETE removed %, expected %', n, e_periods; END IF;

    DELETE FROM matches WHERE id = ANY(fx_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_matches THEN RAISE EXCEPTION 'REFUSED: matches DELETE removed %, expected %', n, e_matches; END IF;

    DELETE FROM club_seasons WHERE season = 2081;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_ladder THEN RAISE EXCEPTION 'REFUSED: club_seasons DELETE removed %, expected %', n, e_ladder; END IF;

    DELETE FROM seasons WHERE year = 2081;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> e_season THEN RAISE EXCEPTION 'REFUSED: seasons DELETE removed %, expected %', n, e_season; END IF;

    -- Post-condition: the namespace is empty, as the suite's ownership preflight requires.
    SELECT (SELECT count(*) FROM seasons WHERE year = 2081)
         + (SELECT count(*) FROM matches WHERE season = 2081 OR starts_with(match_key, root))
         + (SELECT count(*) FROM club_seasons WHERE season = 2081)
         + (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND starts_with(entity_key, root))
         + (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND note = note_267)
      INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'REFUSED: % namespace row(s) remain after removal', n; END IF;

    RAISE NOTICE 'removed: % override(s), % audit row(s), % period row(s), % match(es), % club_seasons row(s), % season row(s)',
        e_overrides, e_edits, e_periods, e_matches, e_ladder, e_season;
END
$recover$;

\echo '== After (inside the transaction): club_seasons total; the failed run''s historical baseline was 1624'
SELECT count(*) AS club_seasons_total FROM club_seasons;

\if :{?recover_commit}
  \if :recover_commit
    COMMIT;
    \echo '== Done (COMMITTED).'
  \else
    ROLLBACK;
    \echo '== Done (ROLLED BACK: recover_commit is false).'
  \endif
\else
  ROLLBACK;
  \echo '== Done (ROLLED BACK: dry run). Re-run with -v recover_commit=1 to commit.'
\endif
