-- AFLDB-ISSUE-267 / AFLDB-ISSUE-269: read-only census of the season-2081 fixture namespace on afldb_test.
--
-- Operator-run only, BEFORE AFLDB-ISSUE-267-269-fixture-residue-recovery.sql and again after it.
-- Context: the 2026-10-09 integration run failed (6 failed). Its afterEach cleanup deleted fixture
-- rows in separate statements and then failed on club_seasons_season_fkey, so the namespace may hold
-- a season row, ladder rows and anything else a statement before the failure did not reach.
--
-- Read-only transaction, 30 s statement timeout. Prints no credentials: role and database names only.
-- Plain SQL plus psql \echo / \pset. Nothing here assumes that a season-2081 row belongs to the test:
-- every row is listed with the evidence for or against the fixture signature, and sections 6 and 7
-- enumerate EVERY foreign key into seasons(year) and matches(id) from the catalogue, so a row the
-- fixture never writes is shown rather than missed.
--
-- The fixture signature (tests/integration/data-editor.test.ts, seedFixture267/saveEdit267):
--   match:        season 2081, match_key '2081|issue267-<token>', venue_raw 'ISSUE-267 Fixture Oval',
--                 round_code '1', match_date 2081-03-05, clubs = the fixture club pair;
--   fixture pair: SELECT DISTINCT ON (organization_id) id FROM clubs WHERE organization_id IS NOT NULL
--                 ORDER BY organization_id, id LIMIT 2;
--   club_seasons: season 2081, a fixture-pair club, source afltables, no import batch, no finals;
--   override:     entity_type 'matches', entity_key '2081|issue267-*';
--   audit row:    data_edits table_name 'matches', note 'issue-267 replay'.
--
-- Exit status (psql, with ON_ERROR_STOP on): 0 when every section ran and '== Done.' is the last line;
-- 3 for any failed statement; 2 for a lost connection. A run that does not end in '== Done.' with
-- status 0 is not evidence.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset null '(null)'
\pset footer on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

\echo '== 0. Target (the recovery refuses unless the database name ends in _test)'
SELECT current_database() AS database, current_user AS role,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_database() ~ '_test$' AS is_test_database;

\echo '== 1. The fixture club pair, by the fixture''s own selection rule'
SELECT id::int AS club_id, organization_id
  FROM (SELECT DISTINCT ON (organization_id) id, organization_id
          FROM clubs WHERE organization_id IS NOT NULL
         ORDER BY organization_id, id
         LIMIT 2) p
 ORDER BY id;

\echo '== 2. seasons row 2081 (absent before the failed run: its ownership preflight passed)'
SELECT to_jsonb(s) AS season_row FROM seasons s WHERE s.year = 2081;

\echo '== 3. Matches of season 2081 or under 2081|issue267-*, with the fixture-signature test'
WITH pair AS (
    SELECT id FROM (SELECT DISTINCT ON (organization_id) id FROM clubs
                     WHERE organization_id IS NOT NULL ORDER BY organization_id, id LIMIT 2) p
)
SELECT m.id::int AS match_id, m.match_key, m.season, m.round_code, m.match_date, m.venue_raw,
       m.home_club_id, m.away_club_id, m.home_goals, m.home_behinds, m.home_score,
       m.away_goals, m.away_behinds, m.away_score, m.result,
       (m.season = 2081 AND starts_with(m.match_key, '2081|issue267-')
        AND m.venue_raw = 'ISSUE-267 Fixture Oval' AND m.round_code = '1'
        AND m.match_date = DATE '2081-03-05'
        AND m.home_club_id IN (SELECT id FROM pair) AND m.away_club_id IN (SELECT id FROM pair)) AS fixture_signature
  FROM matches m
 WHERE m.season = 2081 OR starts_with(m.match_key, '2081|issue267-')
 ORDER BY m.id;

\echo '== 4. club_seasons of season 2081, with the fixture-signature test'
WITH pair AS (
    SELECT id FROM (SELECT DISTINCT ON (organization_id) id FROM clubs
                     WHERE organization_id IS NOT NULL ORDER BY organization_id, id LIMIT 2) p
)
SELECT cs.id::int AS club_season_id, cs.club_id, cs.played, cs.wins, cs.draws, cs.losses,
       cs.points_for, cs.points_against, cs.ladder_rank, cs.is_premier, cs.finals_played,
       src.key AS source, cs.import_batch_id,
       (cs.club_id IN (SELECT id FROM pair) AND src.key = 'afltables' AND cs.import_batch_id IS NULL
        AND NOT cs.is_premier AND COALESCE(cs.finals_played, 0) = 0) AS fixture_signature
  FROM club_seasons cs
  LEFT JOIN sources src ON src.id = cs.source_id
 WHERE cs.season = 2081
 ORDER BY cs.club_id;

\echo '== 5a. matches overrides under 2081|issue267-* or keyed to a season-2081 match'
SELECT o.entity_key, o.field_group, o.is_active, o.override_values, o.admin_user_id,
       starts_with(o.entity_key, '2081|issue267-') AS fixture_key,
       EXISTS (SELECT 1 FROM matches m WHERE m.match_key = o.entity_key) AS resolves_to_a_match
  FROM data_overrides o
 WHERE o.entity_type = 'matches'
   AND (starts_with(o.entity_key, '2081|issue267-')
        OR o.entity_key IN (SELECT match_key FROM matches WHERE season = 2081))
 ORDER BY o.entity_key, o.field_group;

\echo '== 5b. matches audit rows noted issue-267 replay, or on a season-2081 / 2081|issue267-* match'
SELECT to_jsonb(d) - 'old_values' - 'new_values' AS audit_row,
       m.match_key AS row_match_key,
       (d.note = 'issue-267 replay') AS fixture_note
  FROM data_edits d
  LEFT JOIN matches m ON m.id = d.row_id
 WHERE d.table_name = 'matches'
   AND (d.note = 'issue-267 replay'
        OR d.row_id IN (SELECT id FROM matches
                         WHERE season = 2081 OR starts_with(match_key, '2081|issue267-')))
 ORDER BY d.row_id, d.field_group;

\echo '== 6. Every foreign key into seasons: rows referencing the season-2081 row (catalogue-enumerated)'
SELECT c.conrelid::regclass::text AS referencing_table, a.attname AS referencing_column,
       ra.attname AS referenced_column, cardinality(c.conkey) AS key_columns,
       CASE WHEN cardinality(c.conkey) = 1 THEN
           (xpath('/row/n/text()', query_to_xml(
               format('SELECT count(*) AS n FROM %s WHERE %I IN (SELECT %I FROM seasons WHERE year = 2081)',
                      c.conrelid::regclass, a.attname, ra.attname),
               false, true, '')))[1]::text::bigint
       END AS rows_on_2081
  FROM pg_constraint c
  JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
 WHERE c.contype = 'f' AND c.confrelid = 'seasons'::regclass
 ORDER BY rows_on_2081 DESC NULLS FIRST, referencing_table, referencing_column;

\echo '== 7. Every foreign key into matches: rows on a season-2081 / 2081|issue267-* match (catalogue-enumerated)'
SELECT c.conrelid::regclass::text AS referencing_table, a.attname AS referencing_column,
       ra.attname AS referenced_column, cardinality(c.conkey) AS key_columns,
       CASE WHEN cardinality(c.conkey) = 1 THEN
           (xpath('/row/n/text()', query_to_xml(
               format('SELECT count(*) AS n FROM %s WHERE %I IN (SELECT %I FROM matches '
                      'WHERE season = 2081 OR starts_with(match_key, %L))',
                      c.conrelid::regclass, a.attname, ra.attname, '2081|issue267-'),
               false, true, '')))[1]::text::bigint
       END AS rows_on_namespace_matches
  FROM pg_constraint c
  JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
 WHERE c.contype = 'f' AND c.confrelid = 'matches'::regclass
 ORDER BY rows_on_namespace_matches DESC NULLS FIRST, referencing_table, referencing_column;
\echo '   A NULL count is a multi-column key this census does not evaluate: inspect it by hand.'

\echo '== 8. Summary: the expect_* values for the recovery, and what must be zero for it to proceed'
WITH pair AS (
    SELECT id FROM (SELECT DISTINCT ON (organization_id) id FROM clubs
                     WHERE organization_id IS NOT NULL ORDER BY organization_id, id LIMIT 2) p
),
ns_matches AS (
    SELECT m.*,
           (m.season = 2081 AND starts_with(m.match_key, '2081|issue267-')
            AND m.venue_raw = 'ISSUE-267 Fixture Oval' AND m.round_code = '1'
            AND m.match_date = DATE '2081-03-05'
            AND m.home_club_id IN (SELECT id FROM pair) AND m.away_club_id IN (SELECT id FROM pair)) AS fx
      FROM matches m
     WHERE m.season = 2081 OR starts_with(m.match_key, '2081|issue267-')
),
ns_ladder AS (
    SELECT cs.*,
           (cs.club_id IN (SELECT id FROM pair)
            AND cs.source_id = (SELECT id FROM sources WHERE key = 'afltables')
            AND cs.import_batch_id IS NULL AND NOT cs.is_premier
            AND COALESCE(cs.finals_played, 0) = 0) AS fx
      FROM club_seasons cs WHERE cs.season = 2081
)
SELECT
    (SELECT count(*) FROM ns_matches WHERE fx)                                        AS expect_matches,
    (SELECT count(*) FROM match_period_scores p
      WHERE p.match_id IN (SELECT id FROM ns_matches WHERE fx))                       AS expect_period_rows,
    (SELECT count(*) FROM data_overrides
      WHERE entity_type = 'matches' AND starts_with(entity_key, '2081|issue267-'))    AS expect_overrides,
    (SELECT count(*) FROM data_edits
      WHERE table_name = 'matches' AND note = 'issue-267 replay')                     AS expect_edits,
    (SELECT count(*) FROM ns_ladder WHERE fx)                                         AS expect_club_seasons,
    (SELECT count(*) FROM seasons WHERE year = 2081 AND league = 'AFL')               AS expect_season,
    -- Each of these must be 0, or the recovery refuses before deleting anything.
    (SELECT count(*) FROM ns_matches WHERE fx IS NOT TRUE)                                  AS foreign_matches,
    (SELECT count(*) FROM ns_ladder WHERE fx IS NOT TRUE)                                   AS foreign_club_seasons,
    (SELECT count(*) FROM data_overrides o
      WHERE o.entity_type = 'matches'
        AND o.entity_key IN (SELECT match_key FROM ns_matches)
        AND NOT starts_with(o.entity_key, '2081|issue267-'))                          AS foreign_overrides,
    (SELECT count(*) FROM data_edits d
      WHERE d.table_name = 'matches' AND d.note IS DISTINCT FROM 'issue-267 replay'
        AND d.row_id IN (SELECT id FROM ns_matches))                                  AS foreign_edits_on_namespace_matches,
    (SELECT count(*) FROM data_edits d
      WHERE d.table_name = 'matches' AND d.note = 'issue-267 replay'
        AND d.row_id IN (SELECT id FROM matches)
        AND d.row_id NOT IN (SELECT id FROM ns_matches WHERE fx))                     AS noted_edits_on_foreign_matches,
    (SELECT count(*) FROM seasons WHERE year = 2081 AND league IS DISTINCT FROM 'AFL') AS foreign_season,
    (SELECT count(*) FROM club_seasons)                                               AS club_seasons_total;

\echo '   club_seasons_total: the failed run''s historical baseline was 1624 and its end state 1626.'
\echo '   Sections 6 and 7: any referencing table other than matches/club_seasons (6) or'
\echo '   match_period_scores (7) with a non-zero count makes the recovery refuse.'

ROLLBACK;
\echo '== Done.'
