-- AFLDB-ISSUE-272: read-only census of duplicate-match CANDIDATES in `matches`.
--
-- Operator-run only (runbook issues/open/AFLDB-ISSUE-272.md §17.6). UNRUN and NOT syntax-checked: it was
-- written without database access. Read-only transaction, 30 s statement timeout, 5 s lock timeout. Prints
-- no credentials: role and database names only. Plain SQL plus psql \echo / \pset; no \gset or \if. It
-- contains no INSERT, UPDATE, DELETE or DDL, and ends in ROLLBACK.
--
-- WHAT THIS MEASURES. Candidates, not damage:
--   * Section 1 counts the groups of more than one match sharing (season, match_date, home_club_id,
--     away_club_id), how many include a row that breaks the canonical round contract (below), and how
--     many include a row of each provenance class (below). Section 1b splits the groups by season;
--     section 1c counts the WHOLE table by provenance class and round-contract result.
--   * Section 2 lists every row of every candidate group with its key, round checks, score, provenance
--     class, raw provenance columns, creating batch, player-stat row count and active `matches` override
--     count, for review. Its unrestricted row total is printed before the capped listing.
--   * Section 3 counts every match that breaks the round contract, twin or no twin (a legacy upload of
--     `R1` for a fixture no canonical row held has no twin, but its key is still non-canonical), with the
--     singleton count (no other row on that season/date/pairing) printed separately; 3b breaks the
--     breaches down by check combination with example spellings; 3c lists them.
--   * Section 4 is supplementary: one season/date/pairing whose rows disagree on which club is home.
--     Its unrestricted totals are printed before the capped listing.
--   Every capped listing (LIMIT) is preceded by an unrestricted total, so truncation is visible.
--
-- THE CANONICAL ROUND CONTRACT checked here is the one every canonical writer applies
-- (readMatchResultsRound in src/lib/ingest/datasets.ts; normalise_results_round / FINALS_CODES in
-- tools/migration/import_fitzroy_core.py; translateAflRound / finalRound in
-- src/lib/acquisition/afl-api-rounds.ts), reported as four separate checks:
--   * spelling: home-and-away round_code is the bare decimal number with no sign, padding, `R` or space
--     (`0` or `[1-9][0-9]*`); every other round is exactly one of EF/QF/SF/PF/GF/WF, upper case.
--     A recognised non-canonical spelling (`gf`, ` GF`, `R1`, `01`, `R01`) is reported as such, NOT
--     accepted: recognising a finals code is not enough.
--   * type: the round_type the code reads as (EF elimination_final, QF qualifying_final, SF semi_final,
--     PF preliminary_final, GF grand_final, WF wildcard_final, a number home_and_away) equals round_type.
--   * number: home_and_away carries round_number and its decimal spelling equals the code's digits;
--     every other round_type carries a NULL round_number.
--   * is_final: is_final = (round_type <> 'home_and_away'), as the writers set it.
--   matches_round_number_ck and matches_is_final_ck (src/db/migrations/003_matches.sql) already enforce the
--   NULL/NOT NULL half of the number check and the is_final check, so those counts are expected to be 0;
--   a non-zero count there means the constraint is not in force on the target. The code-versus-number
--   comparison, the spelling and the code-versus-type checks are NOT enforced by any constraint.
--
-- PROVENANCE CLASSES (attribution, section 1/1c/2/3):
--   * match_results_upload_batch: import_batch_id names a batch with tool 'admin-upload' and target
--     'match_results'. The only POSITIVE upload signal here.
--   * no_provenance_unknown_origin: source_id, source_record_id and import_batch_id are ALL NULL. Origin
--     unknown. Older match_results uploads may have stored none of the three, but other historical
--     writers may have too. These rows are NOT labelled upload-created and NOT confirmed ISSUE-272
--     damage; they are counted and listed separately so they can be reviewed.
--   * other_provenance: anything else (a source, a record id, or a batch from another tool).
--   The absence of the batch signal does NOT exclude historical upload involvement. No retained-submission
--   signal is used: data_submission_rows record what a file said, not which match a promotion created or
--   updated, so matching a retained row to a match would rest on a fixture that merely looks the same.
--
-- A candidate is NOT confirmed ISSUE-272 damage. Two rows can share a season, date and pairing because of
-- a genuine second fixture on one day, a source that numbers a round differently (the AFL API's Opening
-- Round offset), a club-identity or alias difference in the key (AFLDB-ISSUE-306), a date or rekey
-- correction that left an older row, an admin-created match, or residue of a test fixture. Each group
-- needs review. This file repairs nothing.
--
-- The classification CTEs (`c`, `k`, `r`) are repeated verbatim in each statement that needs it: a READ ONLY
-- transaction cannot create a view, and this file creates nothing.
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

\echo '== 0. Target'
SELECT current_database() AS database, current_user AS role,
       current_setting('transaction_read_only') AS transaction_read_only,
       (SELECT count(*) FROM matches) AS matches;

\echo '== 1. Duplicate candidates: more than one match for one (season, match_date, home_club_id, away_club_id)'
\pset expanded on
WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
), grp AS (
  SELECT season, match_date, home_club_id, away_club_id, count(*) AS n,
         bool_or(NOT round_contract_ok) AS any_contract_breach,
         bool_or(spelling <> 'canonical') AS any_noncanonical_spelling,
         count(*) FILTER (WHERE provenance_class = 'match_results_upload_batch') AS upload_batch_rows,
         count(*) FILTER (WHERE provenance_class = 'no_provenance_unknown_origin') AS no_provenance_rows,
         count(*) FILTER (WHERE provenance_class = 'other_provenance') AS other_provenance_rows
    FROM r
   GROUP BY season, match_date, home_club_id, away_club_id
  HAVING count(*) > 1
)
SELECT count(*) AS candidate_groups,
       count(DISTINCT season) AS seasons_with_candidates,
       coalesce(sum(n), 0) AS rows_in_candidate_groups,
       count(*) FILTER (WHERE any_contract_breach) AS groups_with_a_round_contract_breach,
       count(*) FILTER (WHERE any_noncanonical_spelling) AS groups_with_a_noncanonical_spelling,
       count(*) FILTER (WHERE upload_batch_rows > 0) AS groups_with_a_match_results_upload_batch_row,
       count(*) FILTER (WHERE no_provenance_rows > 0) AS groups_with_a_no_provenance_unknown_origin_row,
       count(*) FILTER (WHERE any_contract_breach AND upload_batch_rows > 0) AS breach_groups_with_an_upload_batch_row,
       count(*) FILTER (WHERE any_contract_breach AND no_provenance_rows > 0) AS breach_groups_with_a_no_provenance_row,
       coalesce(sum(upload_batch_rows), 0) AS rows_match_results_upload_batch,
       coalesce(sum(no_provenance_rows), 0) AS rows_no_provenance_unknown_origin,
       coalesce(sum(other_provenance_rows), 0) AS rows_other_provenance
  FROM grp;
\pset expanded off

\echo '== 1b. Candidate groups per season (LIMIT 200; total = seasons_with_candidates in section 1)'
SELECT season, count(*) AS candidate_groups, sum(n) AS rows_in_candidate_groups
  FROM (SELECT season, count(*) AS n
          FROM matches
         GROUP BY season, match_date, home_club_id, away_club_id
        HAVING count(*) > 1) g
 GROUP BY season
 ORDER BY season
 LIMIT 200;

\echo '== 1c. Whole table: matches by provenance class, round-contract result and spelling (unrestricted)'
WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
)
SELECT provenance_class, round_contract_ok, spelling, count(*) AS matches
  FROM r
 GROUP BY provenance_class, round_contract_ok, spelling
 ORDER BY provenance_class, round_contract_ok, spelling;

\echo '== 2. Candidate rows, one line per match (unrestricted total, then LIMIT 500)'
SELECT coalesce(sum(n), 0) AS candidate_rows_total, 500 AS listing_limit
  FROM (SELECT count(*) AS n
          FROM matches
         GROUP BY season, match_date, home_club_id, away_club_id
        HAVING count(*) > 1) g;

WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
), grp AS (
  SELECT season, match_date, home_club_id, away_club_id
    FROM matches
   GROUP BY season, match_date, home_club_id, away_club_id
  HAVING count(*) > 1
)
SELECT m.season, m.match_date, hc.name AS home_club, ac.name AS away_club,
       m.id AS match_id, m.match_key, m.round_code, m.round_number, r.round_type, m.is_final,
       r.round_contract_ok, r.spelling, r.type_check, r.number_check, r.is_final_check,
       m.home_score, m.away_score, m.venue_raw,
       r.provenance_class, m.source_id, s.key AS source, m.source_record_id,
       m.import_batch_id::text AS import_batch_id,
       b.tool AS batch_tool, b.target_table AS batch_target, b.notes AS batch_notes,
       b.completed_at AS batch_completed_at,
       (SELECT count(*) FROM player_match_stats p WHERE p.match_id = m.id) AS player_stat_rows,
       (SELECT count(*) FROM data_overrides o
         WHERE o.entity_type = 'matches' AND o.entity_key = m.match_key AND o.is_active) AS active_match_overrides
  FROM r
  JOIN matches m ON m.id = r.id
  JOIN grp g ON g.season = m.season AND g.match_date = m.match_date
            AND g.home_club_id = m.home_club_id AND g.away_club_id = m.away_club_id
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
  LEFT JOIN sources s ON s.id = m.source_id
  LEFT JOIN import_batches b ON b.id = m.import_batch_id
 ORDER BY m.season, m.match_date, m.home_club_id, m.away_club_id, m.id
 LIMIT 500;

\echo '== 3. Matches that break the canonical round contract, twin or no twin (totals, breakdown, then LIMIT 200)'
\pset expanded on
WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
), t AS (
  SELECT r.*,
         (SELECT count(*) FROM matches o
           WHERE o.id <> r.id AND o.season = r.season AND o.match_date = r.match_date
             AND o.home_club_id = r.home_club_id AND o.away_club_id = r.away_club_id) AS same_fixture_rows
    FROM r
   WHERE NOT r.round_contract_ok
)
SELECT count(*) AS round_contract_breaches_total,
       count(*) FILTER (WHERE same_fixture_rows = 0) AS singleton_breaches_no_same_fixture_row,
       count(*) FILTER (WHERE same_fixture_rows > 0) AS breaches_with_a_same_fixture_row,
       count(*) FILTER (WHERE spelling = 'noncanonical_finals_code') AS spelling_noncanonical_finals_code,
       count(*) FILTER (WHERE spelling = 'noncanonical_number') AS spelling_noncanonical_number,
       count(*) FILTER (WHERE spelling = 'unrecognised') AS spelling_unrecognised,
       count(*) FILTER (WHERE type_check <> 'ok') AS type_check_failures,
       count(*) FILTER (WHERE number_check <> 'ok') AS number_check_failures,
       count(*) FILTER (WHERE is_final_check <> 'ok') AS is_final_check_failures,
       count(*) FILTER (WHERE provenance_class = 'match_results_upload_batch') AS provenance_match_results_upload_batch,
       count(*) FILTER (WHERE provenance_class = 'no_provenance_unknown_origin') AS provenance_no_provenance_unknown_origin,
       count(*) FILTER (WHERE provenance_class = 'other_provenance') AS provenance_other,
       count(*) FILTER (WHERE same_fixture_rows = 0 AND provenance_class = 'no_provenance_unknown_origin')
         AS singleton_breaches_no_provenance_unknown_origin,
       200 AS listing_limit
  FROM t;
\pset expanded off

\echo '== 3b. Round-contract breaches by check combination, with up to ten distinct round_code spellings each (unrestricted)'
WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
)
SELECT spelling, round_type, type_check, number_check, is_final_check, provenance_class,
       count(*) AS matches,
       (array_agg(DISTINCT coalesce(round_code, '(null)') ORDER BY coalesce(round_code, '(null)')))[1:10]
         AS round_code_examples
  FROM r
 WHERE NOT round_contract_ok
 GROUP BY spelling, round_type, type_check, number_check, is_final_check, provenance_class
 ORDER BY count(*) DESC, spelling, round_type;

\echo '== 3c. Round-contract breaches, one line per match (total in section 3; LIMIT 200)'
WITH c AS (
  SELECT m.id, m.season, m.match_date, m.home_club_id, m.away_club_id,
         m.round_code, m.round_number, m.round_type::text AS round_type, m.is_final,
         CASE
           WHEN m.round_code ~ '^(0|[1-9][0-9]*)$'
             OR m.round_code IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'canonical'
           WHEN upper(btrim(m.round_code)) IN ('EF', 'QF', 'SF', 'PF', 'GF', 'WF') THEN 'noncanonical_finals_code'
           WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'noncanonical_number'
           ELSE 'unrecognised'
         END AS spelling,
         CASE upper(btrim(m.round_code))
           WHEN 'EF' THEN 'elimination_final' WHEN 'QF' THEN 'qualifying_final'
           WHEN 'SF' THEN 'semi_final'        WHEN 'PF' THEN 'preliminary_final'
           WHEN 'GF' THEN 'grand_final'       WHEN 'WF' THEN 'wildcard_final'
           ELSE CASE WHEN btrim(m.round_code) ~ '^R?[0-9]+$' THEN 'home_and_away' END
         END AS read_type,
         CASE
           WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
           WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
             THEN 'no_provenance_unknown_origin'
           ELSE 'other_provenance'
         END AS provenance_class
    FROM matches m
    LEFT JOIN import_batches b ON b.id = m.import_batch_id
), k AS (
  SELECT c.*,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.read_type IS NULL THEN 'round_code_unreadable'
              WHEN c.read_type = c.round_type THEN 'ok'
              ELSE 'type_mismatch' END AS type_check,
         CASE WHEN c.round_type IS NULL THEN 'round_type_null'
              WHEN c.round_type = 'home_and_away' THEN
                CASE WHEN c.round_number IS NULL THEN 'round_number_null'
                     WHEN substring(btrim(c.round_code) FROM '^R?([0-9]+)$') = c.round_number::text THEN 'ok'
                     ELSE 'round_number_disagrees' END
              WHEN c.round_number IS NULL THEN 'ok'
              ELSE 'round_number_set_on_non_home_and_away' END AS number_check,
         CASE WHEN c.round_type IS NOT NULL AND c.is_final IS NOT DISTINCT FROM (c.round_type <> 'home_and_away')
              THEN 'ok' ELSE 'is_final_disagrees' END AS is_final_check
    FROM c
), r AS (
  SELECT k.*,
         (k.spelling = 'canonical' AND k.type_check = 'ok' AND k.number_check = 'ok' AND k.is_final_check = 'ok')
           AS round_contract_ok
    FROM k
)
SELECT m.id AS match_id, m.match_key, m.season, m.match_date, m.round_code, m.round_number,
       r.round_type, m.is_final, r.spelling, r.type_check, r.number_check, r.is_final_check,
       r.provenance_class, m.source_id, s.key AS source, m.source_record_id,
       m.import_batch_id::text AS import_batch_id,
       b.tool AS batch_tool, b.target_table AS batch_target, b.notes AS batch_notes,
       (SELECT count(*) FROM matches t
         WHERE t.id <> m.id AND t.season = m.season AND t.match_date = m.match_date
           AND t.home_club_id = m.home_club_id AND t.away_club_id = m.away_club_id) AS same_fixture_rows,
       (SELECT count(*) FROM player_match_stats p WHERE p.match_id = m.id) AS player_stat_rows
  FROM r
  JOIN matches m ON m.id = r.id
  LEFT JOIN sources s ON s.id = m.source_id
  LEFT JOIN import_batches b ON b.id = m.import_batch_id
 WHERE NOT r.round_contract_ok
 ORDER BY m.season, m.match_date, m.id
 LIMIT 200;

\echo '== 4. Supplementary: one season/date/pairing whose rows disagree on the home club (unrestricted totals, then LIMIT 200)'
SELECT count(*) AS pairings_total, coalesce(sum(n), 0) AS rows_total, 200 AS listing_limit
  FROM (SELECT count(*) AS n
          FROM matches
         GROUP BY season, match_date, LEAST(home_club_id, away_club_id), GREATEST(home_club_id, away_club_id)
        HAVING count(*) > 1 AND count(DISTINCT home_club_id) > 1) p;

WITH pairs AS (
  SELECT season, match_date,
         LEAST(home_club_id, away_club_id) AS club_a, GREATEST(home_club_id, away_club_id) AS club_b
    FROM matches
   GROUP BY season, match_date, LEAST(home_club_id, away_club_id), GREATEST(home_club_id, away_club_id)
  HAVING count(*) > 1 AND count(DISTINCT home_club_id) > 1
)
SELECT m.season, m.match_date, m.id AS match_id, m.match_key, m.round_code,
       hc.name AS home_club, ac.name AS away_club,
       CASE
         WHEN b.tool = 'admin-upload' AND b.target_table = 'match_results' THEN 'match_results_upload_batch'
         WHEN m.source_id IS NULL AND m.source_record_id IS NULL AND m.import_batch_id IS NULL
           THEN 'no_provenance_unknown_origin'
         ELSE 'other_provenance'
       END AS provenance_class,
       m.source_id, s.key AS source, m.source_record_id, m.import_batch_id::text AS import_batch_id,
       b.tool AS batch_tool, b.target_table AS batch_target
  FROM matches m
  JOIN pairs p ON p.season = m.season AND p.match_date = m.match_date
              AND p.club_a = LEAST(m.home_club_id, m.away_club_id)
              AND p.club_b = GREATEST(m.home_club_id, m.away_club_id)
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
  LEFT JOIN sources s ON s.id = m.source_id
  LEFT JOIN import_batches b ON b.id = m.import_batch_id
 ORDER BY m.season, m.match_date, m.id
 LIMIT 200;

ROLLBACK;
\echo '== Done.'