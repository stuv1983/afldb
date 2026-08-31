-- =====================================================================
-- AFLDB 072 — dob_conflict ownership: pass-scoped, idempotent writes
-- =====================================================================
-- AFLDB-ISSUE-090. Two AFL Tables birth-date enrichment passes wrote
-- unresolved dob_conflict rows with contradictory lifecycle semantics:
-- the club-list pass stacked a duplicate row on every rerun (no delete,
-- no ON CONFLICT, no ownership predicate); the register pass deleted
-- every unresolved dob_conflict/dob_internal_conflict row regardless of
-- which pass created it. Neither could express which pass owns a
-- finding, because both write details->>'source' = 'afltables'.
--
-- This migration repairs existing data ONE TIME and adds the structural
-- guard the new importer code (enrich_birth_dates.py,
-- enrich_birth_dates_from_club_lists.py) now relies on: one unresolved
-- dob_conflict row per player, carrying a versioned disputed_by map
-- keyed by pass ('register' / 'club_list'), each assertion retaining its
-- own source identity and existing_at_detection baseline.
--
-- Order (AFLDB-ISSUE-090.md Sec 12.1):
--   1.  fail-closed preconditions, over UNRESOLVED rows, before any
--       destructive step
--   2/3. normalise safely-attributable unresolved legacy rows to v2
--   4-9. losslessly union and dedupe duplicate unresolved dob_conflict
--        groups; survivor = MIN(id), so detected_at/first-detection is
--        preserved on the row that stays
--  10.  delete the merged loser rows only
--  11.  recompute players.dob_disputed for the affected player set only
--       -- never a global sweep
--  12.  add uq_data_issues_open_dob_per_player (D2)
--  13.  resolved history (resolved_at IS NOT NULL) is read for
--       fingerprint comparisons by the importers but is NEVER written by
--       this migration -- every statement below filters resolved_at IS
--       NULL.
--
-- Non-goals, deliberately out of scope (see AFLDB-ISSUE-090.md Sec 4):
--   * dob_internal_conflict merge logic -- none exists (Sec 9); a
--     duplicate unresolved group there aborts the migration for
--     deliberate review instead of being guessed at.
--   * external_identity_conflict (D4, follow-up).
--   * player_birth_evidence (already idempotent by unique-key upsert).
--   * any production cleanup design -- this migration is written to be
--     safe whether or not the target database holds duplicates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fail-closed preconditions (Sec 12.2), evaluated over UNRESOLVED
--    rows only, before any destructive step. Nothing is silently
--    attributed, transformed or skipped: every check names the
--    offending id(s)/entity_id(s) and aborts the whole migration.
-- ---------------------------------------------------------------------

-- 12.2.7 entity_type must be 'player' on every dob_conflict /
-- dob_internal_conflict row -- the ownership/population model assumes it.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
     AND entity_type <> 'player';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: dob_conflict/dob_internal_conflict row(s) with entity_type <> ''player'': id(s) %', bad;
  END IF;
END $$;

-- 12.2.1/2 an unresolved legacy-shape dob_conflict row must carry
-- exactly one of register/club_list -- both is ambiguous ownership,
-- neither (with no disputed_by either) is unattributable.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT entity_id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND NOT (details ? 'disputed_by')
     AND (details ? 'register') AND (details ? 'club_list');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) carry BOTH legacy register and club_list keys -- ownership ambiguous: entity_id(s) %', bad;
  END IF;

  SELECT string_agg(DISTINCT entity_id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND NOT (details ? 'disputed_by')
     AND NOT (details ? 'register') AND NOT (details ? 'club_list');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) carry NEITHER a legacy ownership key nor disputed_by -- unattributable: entity_id(s) %', bad;
  END IF;
END $$;

-- 12.2.3 a disputed_by payload's declared version must be exactly 2.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND details ? 'version' AND (details->>'version') <> '2';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) carry an unrecognised payload version: id(s) %', bad;
  END IF;
END $$;

-- 12.2.4 disputed_by shape: an object of pass -> array of objects, each
-- assertion carrying 'asserted'. Each check below assumes the previous
-- one already passed (a RAISE EXCEPTION aborts the whole migration), so
-- by the time the array-element check runs every disputed_by value is
-- already proven to be a genuine JSON array -- jsonb_array_elements on a
-- non-array would otherwise raise a raw, uncontrolled error.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND details ? 'disputed_by'
     AND jsonb_typeof(details->'disputed_by') <> 'object';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) have a non-object disputed_by: id(s) %', bad;
  END IF;

  SELECT string_agg(DISTINCT d.id::text, ', ') INTO bad
    FROM data_issues d, jsonb_each(d.details->'disputed_by') AS kv(pass_key, assertions)
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
     AND d.details ? 'disputed_by'
     AND jsonb_typeof(d.details->'disputed_by') = 'object'
     AND jsonb_typeof(kv.assertions) <> 'array';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) have a disputed_by pass key whose value is not an array: id(s) %', bad;
  END IF;

  SELECT string_agg(DISTINCT d.id::text, ', ') INTO bad
    FROM data_issues d,
         jsonb_each(d.details->'disputed_by') AS kv(pass_key, assertions),
         jsonb_array_elements(kv.assertions) AS a
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
     AND d.details ? 'disputed_by'
     AND jsonb_typeof(d.details->'disputed_by') = 'object'
     AND (jsonb_typeof(a) <> 'object' OR NOT (a ? 'asserted'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) have a disputed_by assertion that is not an object, or is missing "asserted": id(s) %', bad;
  END IF;
END $$;

-- 12.2.5 asserted / existing_at_detection (v2) and register / club_list /
-- existing (legacy) must be parseable ISO dates -- the same format check
-- (^\d{4}-\d{2}-\d{2}$) the two importers already apply.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT d.id::text, ', ') INTO bad
    FROM data_issues d,
         jsonb_each(d.details->'disputed_by') AS kv(pass_key, assertions),
         jsonb_array_elements(kv.assertions) AS a
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
     AND d.details ? 'disputed_by'
     AND jsonb_typeof(d.details->'disputed_by') = 'object'
     AND (
       NOT (a->>'asserted' ~ '^\d{4}-\d{2}-\d{2}$')
       OR (a ? 'existing_at_detection'
           AND NOT (a->>'existing_at_detection' ~ '^\d{4}-\d{2}-\d{2}$'))
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) have an unparseable date inside disputed_by: id(s) %', bad;
  END IF;

  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND NOT (details ? 'disputed_by')
     AND (
       (details ? 'register' AND NOT (details->>'register' ~ '^\d{4}-\d{2}-\d{2}$'))
       OR (details ? 'club_list' AND NOT (details->>'club_list' ~ '^\d{4}-\d{2}-\d{2}$'))
       OR (details ? 'existing' AND NOT (details->>'existing' ~ '^\d{4}-\d{2}-\d{2}$'))
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved legacy-shape dob_conflict row(s) have an unparseable date: id(s) %', bad;
  END IF;
END $$;

-- 12.2.6 a club_list external_id must match ^club-list:[a-z0-9-]+: so
-- club is deterministic (Sec 6.1/6.2).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT d.id::text, ', ') INTO bad
    FROM data_issues d,
         jsonb_array_elements(coalesce(d.details->'disputed_by'->'club_list', '[]'::jsonb)) AS a
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
     AND d.details ? 'disputed_by'
     AND jsonb_typeof(d.details->'disputed_by') = 'object'
     AND NOT (a->>'external_id' ~ '^club-list:[a-z0-9-]+:');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) have a club_list assertion with an unrecognised external_id shape: id(s) %', bad;
  END IF;

  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
     AND NOT (details ? 'disputed_by')
     AND details ? 'club_list'
     AND NOT (details->>'external_id' ~ '^club-list:[a-z0-9-]+:');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved legacy club-list dob_conflict row(s) have an unrecognised external_id shape: id(s) %', bad;
  END IF;
END $$;

-- 12.2.8 dob_internal_conflict: no duplicate unresolved group. No merge
-- logic exists for the {"dates": [...]} payload (Sec 9) -- abort for
-- deliberate review rather than invent one.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(entity_id::text, ', ') INTO bad
    FROM (
      SELECT entity_id FROM data_issues
       WHERE issue_type = 'dob_internal_conflict' AND resolved_at IS NULL
       GROUP BY entity_id HAVING count(*) > 1
    ) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: duplicate unresolved dob_internal_conflict row(s) for entity_id(s) % -- no merge logic exists for this shape, review manually', bad;
  END IF;
END $$;

-- 12.2.9 no unrecognised top-level details key for its shape -- an
-- unknown key may encode evidence and must never be silently discarded.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues d
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
     AND EXISTS (
       SELECT 1 FROM jsonb_object_keys(d.details) k
        WHERE k NOT IN ('version', 'disputed_by', 'resolution',
                         'existing', 'register', 'club_list', 'external_id', 'source')
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_conflict row(s) carry an unrecognised details key: id(s) %', bad;
  END IF;

  SELECT string_agg(id::text, ', ') INTO bad
    FROM data_issues d
   WHERE d.issue_type = 'dob_internal_conflict' AND d.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(d.details) k WHERE k NOT IN ('dates'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 072: unresolved dob_internal_conflict row(s) carry an unrecognised details key: id(s) %', bad;
  END IF;
END $$;

-- 12.2.11 report -- do not repair -- any players.dob_disputed
-- inconsistency OUTSIDE the population this migration will touch. That
-- population is exactly the set of entity_ids currently holding an
-- unresolved dob_conflict row; anything outside it is a pre-existing
-- condition this issue does not own (Sec 13).
DO $$
DECLARE bad text;
          affected_ids int[];
BEGIN
  SELECT array_agg(DISTINCT entity_id) INTO affected_ids
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL;

  SELECT string_agg(p.id::text, ', ') INTO bad
    FROM players p
   WHERE NOT (p.id = ANY(coalesce(affected_ids, ARRAY[]::int[])))
     AND p.dob_disputed <> EXISTS (
           SELECT 1 FROM data_issues d
            WHERE d.entity_type = 'player' AND d.entity_id = p.id
              AND d.issue_type IN ('dob_conflict', 'dob_internal_conflict')
              AND d.resolved_at IS NULL);
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'migration 072: players.dob_disputed disagrees with unresolved DOB issue state OUTSIDE the population this migration touches (reported, not repaired -- Sec 12.2 check 11 / Sec 13): player id(s) %', bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2/3. Normalise safely-attributable unresolved legacy rows to v2.
--      Shape A (register) omits external_id -- proven exact from source
--      (Sec 6.2): a player holds at most one register assertion, so the
--      omission loses no discriminating power. Shape B (club_list) is
--      lossless: external_id, asserted and existing are all present, and
--      club is deterministic from the club-list:{file_key}: prefix.
-- ---------------------------------------------------------------------
UPDATE data_issues
   SET details = jsonb_build_object(
         'version', 2,
         'disputed_by', jsonb_build_object('register', jsonb_build_array(
           jsonb_build_object(
             'source', details->>'source',
             'external_id', NULL,
             'asserted', details->>'register',
             'existing_at_detection', details->>'existing'
           )
         )),
         'resolution', 'manual review required'
       )
 WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
   AND NOT (details ? 'disputed_by')
   AND details ? 'register';

UPDATE data_issues
   SET details = jsonb_build_object(
         'version', 2,
         'disputed_by', jsonb_build_object('club_list', jsonb_build_array(
           jsonb_build_object(
             'source', details->>'source',
             'club', substring(details->>'external_id' from '^club-list:([a-z0-9-]+):'),
             'external_id', details->>'external_id',
             'asserted', details->>'club_list',
             'existing_at_detection', details->>'existing'
           )
         )),
         'resolution', 'manual review required'
       )
 WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
   AND NOT (details ? 'disputed_by')
   AND details ? 'club_list';

-- ---------------------------------------------------------------------
-- 4-9. Losslessly union and dedupe duplicate unresolved dob_conflict
--      groups (every row is now v2-shaped). Survivor = MIN(id), so the
--      row that stays keeps its own detected_at -- first detection is
--      preserved rather than reset.
-- ---------------------------------------------------------------------
WITH dupes AS (
  SELECT entity_id, min(id) AS survivor_id
    FROM data_issues
   WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
   GROUP BY entity_id
  HAVING count(*) > 1
),
group_assertions AS (
  -- every (pass_key, assertion) pair across every row of every duplicate
  -- group, deduped on the whole assertion object (jsonb equality is
  -- key/value-based, not textual, so key order never defeats dedupe).
  SELECT DISTINCT d.entity_id, kv.pass_key, a AS assertion
    FROM data_issues d
    JOIN dupes ON dupes.entity_id = d.entity_id
    CROSS JOIN LATERAL jsonb_each(d.details->'disputed_by') AS kv(pass_key, assertions)
    CROSS JOIN LATERAL jsonb_array_elements(kv.assertions) AS a
   WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
),
merged AS (
  SELECT entity_id, jsonb_object_agg(pass_key, assertions) AS disputed_by
    FROM (
      SELECT entity_id, pass_key, jsonb_agg(assertion) AS assertions
        FROM group_assertions
       GROUP BY entity_id, pass_key
    ) per_pass
   GROUP BY entity_id
)
UPDATE data_issues d
   SET details = jsonb_build_object(
         'version', 2,
         'disputed_by', merged.disputed_by,
         'resolution', 'manual review required'
       )
  FROM merged
  JOIN dupes ON dupes.entity_id = merged.entity_id
 WHERE d.id = dupes.survivor_id;

-- 10. Delete the merged loser rows only -- never the survivor, never a
--     resolved row (resolved_at IS NULL is part of every predicate here).
DELETE FROM data_issues d
 USING (
   SELECT entity_id, min(id) AS survivor_id
     FROM data_issues
    WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
    GROUP BY entity_id
   HAVING count(*) > 1
 ) dupes
 WHERE d.issue_type = 'dob_conflict' AND d.resolved_at IS NULL
   AND d.entity_id = dupes.entity_id AND d.id <> dupes.survivor_id;

-- ---------------------------------------------------------------------
-- 11. D5: recompute players.dob_disputed for the affected player set
--     only -- every player who currently holds (or, pre-merge, held) an
--     unresolved dob_conflict row. Never a global sweep (Sec 13).
-- ---------------------------------------------------------------------
UPDATE players p
   SET dob_disputed = EXISTS (
         SELECT 1 FROM data_issues d
          WHERE d.entity_type = 'player' AND d.entity_id = p.id
            AND d.issue_type IN ('dob_conflict', 'dob_internal_conflict')
            AND d.resolved_at IS NULL)
 WHERE p.id IN (
   SELECT DISTINCT entity_id FROM data_issues
    WHERE issue_type = 'dob_conflict' AND resolved_at IS NULL
 );

-- ---------------------------------------------------------------------
-- 12. D2: targeted partial unique index (Sec 11).
--     entity_type is a key column, not a predicate, so a future entity
--     type is never silently over-constrained. issue_type sits in both
--     key and predicate: in the key it keeps dob_conflict and
--     dob_internal_conflict independent (one open row of each is legal
--     per player); in the predicate it bounds the blast radius to just
--     these two issue types. entity_id NULL rows never conflict in a
--     unique index, so table-level findings are unaffected. Resolved
--     history is excluded by the predicate: unlimited resolved rows
--     coexist with one open row.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX uq_data_issues_open_dob_per_player
  ON data_issues (entity_type, entity_id, issue_type)
  WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
    AND resolved_at IS NULL;

COMMENT ON INDEX uq_data_issues_open_dob_per_player IS
  'One unresolved dob_conflict row and one unresolved dob_internal_conflict row per player; resolved history is unconstrained (AFLDB-ISSUE-090).';
