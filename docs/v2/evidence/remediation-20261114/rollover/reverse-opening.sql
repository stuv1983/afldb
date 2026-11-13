-- AFLDB-ISSUE-350: the REVERSAL of the season opening. NOT an application path, NOT run by any tool: an owner-run recovery, used only if the
-- opening must be undone while NOTHING depends on the new season row yet. It is rehearsed on a disposable clone (REHEARSAL.md).
--
-- Run as the schema owner (afldb_owner) in ONE transaction (docs/v2/evidence/.../rollover/run-sql.mjs does this; or psql --single-transaction).
-- Replace the two id lists below with `changes.clubIds` and `changes.orgIds` of the APPROVED plan (the plan file is the single source of truth;
-- the lists in this file are the 2026-11-14 production values and must be re-checked against the plan before use) and YEAR/PREVIOUS if the
-- season differs. Every statement is bounded by an exact count; any difference raises and the transaction rolls back untouched.
--
-- It restores exactly what the opening changed: clubs.last_season and club_organizations.last_season for the planned ids, then the seasons row.
-- The DELETE of the seasons row is refused by the 32 foreign keys onto seasons(year) if ANYTHING depends on the row (matches, staging.afl_api_*,
-- club_seasons, brownlow tables ...): that refusal is the intended "dependents present, do not reverse" signal, and the transaction rolls back.
-- The import_batches audit row the opening wrote is HISTORY and is left in place (it records the opening and that it was later reversed by an
-- owner statement; add a note by hand if wanted). Nothing else is touched.
DO $$
DECLARE
  yr         constant smallint := 2027;
  prev       constant smallint := 2026;
  club_ids   constant integer[] := ARRAY[1,3,4,5,6,9,10,11,12,13,15,16,17,18,20,21,23,24];
  org_ids    constant integer[] := ARRAY[1,3,4,5,6,9,10,11,12,13,15,16,17,18,20,21,23,24];
  n          integer;
BEGIN
  SET LOCAL lock_timeout = '10s';
  LOCK TABLE seasons, clubs, club_organizations IN SHARE ROW EXCLUSIVE MODE;

  -- guards: the opened state is exactly what the plan produced, and nothing depends on it
  SELECT count(*) INTO n FROM seasons WHERE year = yr AND status = 'in_progress' AND match_count IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'reversal refused: the % seasons row is not the untouched opened row (% matching)', yr, n; END IF;
  SELECT count(*) INTO n FROM clubs WHERE id = ANY(club_ids) AND last_season = yr;
  IF n <> cardinality(club_ids) THEN RAISE EXCEPTION 'reversal refused: % of % planned clubs hold last_season %', n, cardinality(club_ids), yr; END IF;
  SELECT count(*) INTO n FROM clubs WHERE last_season >= yr AND NOT (id = ANY(club_ids));
  IF n <> 0 THEN RAISE EXCEPTION 'reversal refused: % clubs outside the plan hold last_season >= %', n, yr; END IF;
  SELECT count(*) INTO n FROM club_organizations WHERE id = ANY(org_ids) AND last_season = yr;
  IF n <> cardinality(org_ids) THEN RAISE EXCEPTION 'reversal refused: % of % planned organisations hold last_season %', n, cardinality(org_ids), yr; END IF;
  SELECT count(*) INTO n FROM club_organizations WHERE last_season >= yr AND NOT (id = ANY(org_ids));
  IF n <> 0 THEN RAISE EXCEPTION 'reversal refused: % organisations outside the plan hold last_season >= %', n, yr; END IF;
  SELECT (SELECT count(*) FROM matches WHERE season = yr) + (SELECT count(*) FROM club_seasons WHERE season = yr)
       + (SELECT count(*) FROM staging.afl_api_match WHERE season = yr) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'reversal refused: % rows already depend on season %', n, yr; END IF;

  UPDATE clubs SET last_season = prev WHERE id = ANY(club_ids) AND last_season = yr;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(club_ids) THEN RAISE EXCEPTION 'reversal refused: updated % clubs rows, expected %', n, cardinality(club_ids); END IF;
  UPDATE club_organizations SET last_season = prev WHERE id = ANY(org_ids) AND last_season = yr;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(org_ids) THEN RAISE EXCEPTION 'reversal refused: updated % organisation rows, expected %', n, cardinality(org_ids); END IF;
  DELETE FROM seasons WHERE year = yr;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'reversal refused: deleted % seasons rows, expected 1', n; END IF;
  RAISE NOTICE 'season % opening reversed: % clubs, % organisations, 1 seasons row', yr, cardinality(club_ids), cardinality(org_ids);
END $$;
