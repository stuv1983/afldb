-- AFLDB-ISSUE-276 -- READ-ONLY residue and ownership report for tests/integration/settle-afl-api-issue276.test.ts
--
-- Run against afldb_test only, e.g. (flags before the file, per the Windows psql note):
--   psql "$AFLDB_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f issues/open/AFLDB-ISSUE-276-RESIDUE.sql
-- One READ ONLY transaction, rolled back: it cannot write. Nothing here is a delete; this file never
-- produces a statement that removes anything.
--
-- STATUS: NOT RUN. This script has never been executed against any database.
--
-- WHAT "NAMESPACE" MEANS. A row is IN THE NAMESPACE when it can be FOUND by:
--   * provider-id prefix        CD_M2026ISSUE276   (A fresh, B existing, C lifecycle, D corroborated)
--   * keep-alive match key      CD_M2026ISSUE276-keepalive
--   * the four exact fixture keys   2026|PF|<2026-06-15|16|17|22>|<Hawthorn>|<Brisbane Lions>
--   * batch marker              snapshot=issue276-integration;  in import_batches.notes
--   * data_issues key           the namespace string anywhere in issue_key
--   * stored payload content    an afl_api payload whose raw_payload contains an exact quoted fixture id
-- Being in the namespace is NOT ownership. An exact match key in particular only finds a row; it
-- proves nothing about who created it, and the test never deletes on that basis.
--
-- WHAT "OWNED" MEANS HERE. The test proves ownership from its in-memory run ledger (batch ids RETURNED
-- by the writer; ids RETURNED by its own seed INSERTs), which a later psql session cannot see. This
-- script therefore applies the strongest tests the database itself can show, and labels each row:
--   OWNED-WRITER   matches: source afl_api, source_record_id in the namespace, import_batch_id is a
--                  marker batch.   Other tables: they cite a marker batch.
--   OWNED-SEED     matches whose notes carry 'AFLDB-ISSUE-276 integration fixture; run=<uuid>'
--                  (the keep-alive, and case D's foreign-owned row).
--   UNPROVEN       in the namespace but neither of the above (a pre-existing row, a row from another
--                  suite or person, or a mismatch). Report it; do not delete it on this evidence.
-- Marker-batch and notes markers are evidence, not proof: anyone can type them. A residue operator
-- who wants to remove UNPROVEN rows must establish their origin independently.
--
-- EXPECTED. Before the first run and after a clean run: every count in section 1 is 0 for BOTH classes,
-- sections 1b, 1c, 2 (payloads) and 3 (precondition) return no rows. Section 4 is a capture to compare
-- before/after a run (the test itself restores and asserts equality; these digests let a human see it).

BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

-- 1. COUNTS BY TABLE AND OWNERSHIP CLASS ---------------------------------------------------------
WITH
  ids AS (SELECT unnest(ARRAY['CD_M2026ISSUE276A','CD_M2026ISSUE276B','CD_M2026ISSUE276C','CD_M2026ISSUE276D']::text[]) AS id),
  fixture_keys AS (
    SELECT '2026|PF|' || d.dt || '|' || h.name || '|' || a.name AS k
      FROM (VALUES ('2026-06-15'), ('2026-06-16'), ('2026-06-17'), ('2026-06-22')) AS d(dt),
           clubs h, clubs a
     WHERE h.legacy_club_hist = 'Hawthorn' AND a.legacy_club_hist = 'Brisbane Lions'
    UNION ALL SELECT 'CD_M2026ISSUE276-keepalive'
  ),
  mb AS (SELECT id FROM import_batches WHERE position('snapshot=issue276-integration;'::text in coalesce(notes, '')) > 0),
  afl AS (SELECT id FROM sources WHERE key = 'afl_api'),
  ns_matches AS (
    SELECT m.id,
           CASE
             WHEN m.source_id = (SELECT id FROM afl) AND starts_with(coalesce(m.source_record_id, ''), 'CD_M2026ISSUE276')
                  AND m.import_batch_id IN (SELECT id FROM mb) THEN 'OWNED'
             WHEN position('AFLDB-ISSUE-276 integration fixture; run='::text in coalesce(m.notes, '')) > 0 THEN 'OWNED'
             ELSE 'UNPROVEN'
           END AS cls
      FROM matches m
     WHERE m.match_key IN (SELECT k FROM fixture_keys)
        OR starts_with(m.match_key, 'CD_M2026ISSUE276')
        OR starts_with(coalesce(m.source_record_id, ''), 'CD_M2026ISSUE276')
  ),
  rows_by_table AS (
    SELECT 1 AS ord, 'matches' AS tbl, cls FROM ns_matches
    UNION ALL SELECT 2, 'match_period_scores (of namespace matches)', 'OWNED'
      FROM match_period_scores s JOIN ns_matches n ON n.id = s.match_id AND n.cls = 'OWNED'
    UNION ALL SELECT 2, 'match_period_scores (of namespace matches)', 'UNPROVEN'
      FROM match_period_scores s JOIN ns_matches n ON n.id = s.match_id AND n.cls = 'UNPROVEN'
    UNION ALL SELECT 3, 'player_match_stats (of namespace matches; MUST be 0 always)', 'UNPROVEN'
      FROM player_match_stats s JOIN ns_matches n ON n.id = s.match_id
    UNION ALL SELECT 4, 'canonical_applications',
           CASE WHEN a.import_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM canonical_applications a
     WHERE starts_with(a.external_record_id, 'CD_M2026ISSUE276')
        OR (a.target_table = 'matches' AND a.target_key->>'match_key' IN (SELECT k FROM fixture_keys))
    UNION ALL SELECT 5, 'promotion_candidates',
           CASE WHEN c.created_by_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM promotion_candidates c WHERE starts_with(c.external_record_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 6, 'data_issues (open + resolved; key shapes afl_api|<family>|<id>|.. and afl_api|apply|<family>|<id>|..)',
           CASE WHEN split_part(i.issue_key, '|', 1) = 'afl_api'
                 AND (CASE WHEN split_part(i.issue_key, '|', 2) = 'apply'
                           THEN split_part(i.issue_key, '|', 4) ELSE split_part(i.issue_key, '|', 3) END) IN (SELECT id FROM ids)
                 AND EXISTS (SELECT 1 FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM data_issues i WHERE position('CD_M2026ISSUE276'::text in coalesce(i.issue_key, '')) > 0
    UNION ALL SELECT 7, 'import_rejections',
           CASE WHEN r.import_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM import_rejections r WHERE starts_with(r.source_record_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 8, 'staging.afl_api_match',
           CASE WHEN x.projected_by_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM staging.afl_api_match x WHERE x.source_id = (SELECT id FROM afl) AND starts_with(x.external_record_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 9, 'staging.afl_api_player_match',
           CASE WHEN x.projected_by_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM staging.afl_api_player_match x WHERE x.source_id = (SELECT id FROM afl) AND starts_with(x.provider_match_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 10, 'staging.source_records (afl_api)',
           CASE WHEN r.last_batch_id IN (SELECT id FROM mb) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM staging.source_records r WHERE r.source_id = (SELECT id FROM afl) AND starts_with(r.external_record_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 11, 'staging.source_record_versions (afl_api)',
           CASE WHEN v.opened_by_batch_id IN (SELECT id FROM mb)
                 AND (v.closed_by_batch_id IS NULL OR v.closed_by_batch_id IN (SELECT id FROM mb)) THEN 'OWNED' ELSE 'UNPROVEN' END
      FROM staging.source_record_versions v WHERE v.source_id = (SELECT id FROM afl) AND starts_with(v.external_record_id, 'CD_M2026ISSUE276')
    UNION ALL SELECT 12, 'afltables staging rows keyed by a fixture match key (this file stages none)', 'UNPROVEN'
      FROM staging.afltables_match x
     WHERE x.source_id = (SELECT id FROM sources WHERE key = 'afltables') AND x.external_record_id IN (SELECT k FROM fixture_keys)
    UNION ALL SELECT 13, 'import_batches carrying the marker (one per settle run of the file)', 'OWNED' FROM mb
  )
SELECT t.ord, t.tbl AS "table",
       count(*) FILTER (WHERE r.cls = 'OWNED')    AS owned,
       count(*) FILTER (WHERE r.cls = 'UNPROVEN') AS unproven
  FROM (VALUES
         (1, 'matches'), (2, 'match_period_scores (of namespace matches)'),
         (3, 'player_match_stats (of namespace matches; MUST be 0 always)'), (4, 'canonical_applications'),
         (5, 'promotion_candidates'),
         (6, 'data_issues (open + resolved; key shapes afl_api|<family>|<id>|.. and afl_api|apply|<family>|<id>|..)'),
         (7, 'import_rejections'), (8, 'staging.afl_api_match'), (9, 'staging.afl_api_player_match'),
         (10, 'staging.source_records (afl_api)'), (11, 'staging.source_record_versions (afl_api)'),
         (12, 'afltables staging rows keyed by a fixture match key (this file stages none)'),
         (13, 'import_batches carrying the marker (one per settle run of the file)')
       ) AS t(ord, tbl)
  LEFT JOIN rows_by_table r ON r.ord = t.ord
 GROUP BY t.ord, t.tbl
 ORDER BY t.ord;

-- 1b. The namespace matches, one row each, with the evidence behind each class. ----------------------
SELECT m.id, m.match_key, s.key AS source_key, m.source_record_id, m.import_batch_id,
       (b.id IS NOT NULL) AS batch_has_marker, m.is_final, m.match_date,
       substring(m.notes from 'AFLDB-ISSUE-276 integration fixture; run=[0-9a-f-]+') AS seed_marker,
       CASE
         WHEN s.key = 'afl_api' AND starts_with(coalesce(m.source_record_id, ''), 'CD_M2026ISSUE276') AND b.id IS NOT NULL
           THEN 'OWNED-WRITER'
         WHEN position('AFLDB-ISSUE-276 integration fixture; run='::text in coalesce(m.notes, '')) > 0 THEN 'OWNED-SEED'
         ELSE 'UNPROVEN'
       END AS ownership
  FROM matches m
  LEFT JOIN sources s ON s.id = m.source_id
  LEFT JOIN import_batches b ON b.id = m.import_batch_id AND position('snapshot=issue276-integration;'::text in coalesce(b.notes, '')) > 0
 WHERE m.match_key IN (
         SELECT '2026|PF|' || d.dt || '|' || h.name || '|' || a.name
           FROM (VALUES ('2026-06-15'), ('2026-06-16'), ('2026-06-17'), ('2026-06-22')) AS d(dt), clubs h, clubs a
          WHERE h.legacy_club_hist = 'Hawthorn' AND a.legacy_club_hist = 'Brisbane Lions')
    OR starts_with(m.match_key, 'CD_M2026ISSUE276')
    OR starts_with(coalesce(m.source_record_id, ''), 'CD_M2026ISSUE276')
 ORDER BY m.match_key;

-- 1c. The findings in the namespace (both key shapes), and the marker batches. -------------------------
SELECT id, issue_type, issue_key, (resolved_at IS NOT NULL) AS resolved, resolution
  FROM data_issues
 WHERE position('CD_M2026ISSUE276'::text in coalesce(issue_key, '')) > 0
 ORDER BY id;

SELECT id, status, started_at, completed_at, notes
  FROM import_batches
 WHERE position('snapshot=issue276-integration;'::text in coalesce(notes, '')) > 0
 ORDER BY id;

-- 2. PAYLOAD ROWS CARRYING NAMESPACE EVIDENCE IN THEIR STORED CONTENT ------------------------------
--    Inspects actual staging.source_payloads rows of the afl_api source (families match, match_roster,
--    player_match_stats only). A payload is content-addressed and may be shared, so this is not a count
--    of surviving version references: each row is selected because its STORED raw_payload contains an
--    exact quoted fixture value, then classified by who still cites it. Unrelated orphan payloads (no
--    marker in their content) are never selected, so they cannot be mistaken for residue.
--    The six markers below are the four fixture provider ids and the two rewritten player ids; the
--    player ids are `CD_I276` + the two ids in tests/fixtures/afl_api/match/{02,03}-*.json
--    (CD_I297354, CD_I500001), exactly the test's FIXTURE_PLAYER_IDS. Change them together.
WITH
  afl AS (SELECT id FROM sources WHERE key = 'afl_api'),
  markers AS (
    SELECT unnest(ARRAY[
      '"CD_M2026ISSUE276A"', '"CD_M2026ISSUE276B"', '"CD_M2026ISSUE276C"', '"CD_M2026ISSUE276D"',
      '"CD_I276297354"', '"CD_I276500001"'
    ]::text[]) AS t
  ),
  hits AS (
    SELECT p.family, p.payload_hash, p.first_stored_at
      FROM (SELECT family, payload_hash, first_stored_at, raw_payload::text AS body
              FROM staging.source_payloads
             WHERE source_id = (SELECT id FROM afl) AND family IN ('match', 'match_roster', 'player_match_stats')) p
     WHERE EXISTS (SELECT 1 FROM markers m WHERE position(m.t in p.body) > 0)
  )
SELECT h.family, h.payload_hash, h.first_stored_at,
       c.cited_by_versions, c.cited_by_fixture_versions,
       CASE
         WHEN c.cited_by_versions = 0 THEN 'RESIDUE: uncited payload whose stored content carries a fixture marker'
         WHEN c.cited_by_versions = c.cited_by_fixture_versions THEN 'WITH FIXTURE VERSIONS: residue only together with them'
         ELSE 'SHARED: also cited by a non-fixture version (not residue)'
       END AS classification
  FROM hits h
 CROSS JOIN LATERAL (
   SELECT count(*)::int AS cited_by_versions,
          (count(*) FILTER (WHERE starts_with(v.external_record_id, 'CD_M2026ISSUE276')))::int AS cited_by_fixture_versions
     FROM staging.source_record_versions v
    WHERE v.source_id = (SELECT id FROM afl) AND v.family = h.family AND v.payload_hash = h.payload_hash
 ) c
 ORDER BY h.family, h.payload_hash;

-- 3. PRECONDITION (NOT residue): rows that would make a run refuse possible_existing_match. ----------
--    Same predicate as the planner's sameFixtureIdentity(): season, oriented clubs, differing match_key,
--    and at most ONE of round_code / match_date different from a case's (PF, date). Namespace rows
--    (including the keep-alive and the seeded foreign-owned row) are excluded. Expected: no rows.
--    A hit is a precondition problem to report, never something to delete.
SELECT m.id, m.match_key, m.round_code, m.match_date, m.source_id, d.dt AS conflicts_with_case_date
  FROM matches m
 CROSS JOIN (VALUES (DATE '2026-06-15'), (DATE '2026-06-16'), (DATE '2026-06-17'), (DATE '2026-06-22')) AS d(dt)
 WHERE m.season = 2026
   AND m.home_club_id = (SELECT id FROM clubs WHERE legacy_club_hist = 'Hawthorn')
   AND m.away_club_id = (SELECT id FROM clubs WHERE legacy_club_hist = 'Brisbane Lions')
   AND NOT starts_with(m.match_key, 'CD_M2026ISSUE276')
   AND NOT starts_with(coalesce(m.source_record_id, ''), 'CD_M2026ISSUE276')
   AND m.match_key NOT LIKE '2026|PF|' || d.dt::text || '|%'
   AND ((m.round_code IS DISTINCT FROM 'PF')::int + (m.match_date IS DISTINCT FROM d.dt)::int) <= 1
 ORDER BY d.dt, m.id;

-- 4. CAPTURE (NOT residue): the shared season-2026 derived rows the writer's recompute changes. ----------
--    Take this before a run and after it and compare. The test captures the same columns itself, restores
--    them if they moved and asserts equality; these are for a human cross-check.
--    Excluded on purpose: club_seasons.id (identity, reissued by every recompute) and sequence positions.
SELECT s.year, s.status, s.match_count, s.club_count, s.first_match_date, s.last_match_date,
       s.data_through_date, s.last_loaded_round, s.completed_at,
       md5(to_jsonb(s)::text) AS seasons_row_md5
  FROM seasons s WHERE s.year = 2026;

SELECT count(*) AS club_seasons_2026_rows,
       coalesce(md5(string_agg((to_jsonb(c) - 'id')::text, '|' ORDER BY c.club_id)), '') AS club_seasons_md5_excluding_id,
       count(*) FILTER (WHERE c.import_batch_id IS NOT NULL) AS with_import_batch_id,
       (SELECT count(*) FROM matches WHERE season = 2026 AND NOT is_final) AS non_final_2026_matches
  FROM club_seasons c WHERE c.season = 2026;

SELECT count(*) AS player_season_stats_2026_rows,
       coalesce(md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.player_id)), '') AS player_season_stats_md5_whole_rows,
       coalesce(md5(string_agg(p.player_id::text || ':' || p.brownlow_status::text || ':' || coalesce(p.brownlow_votes::text, 'null'), '|' ORDER BY p.player_id)), '') AS brownlow_columns_md5
  FROM player_season_stats p WHERE p.season = 2026;

ROLLBACK;
