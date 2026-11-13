-- AFLDB-ISSUE-348 / PLAN-REVIEW D-4: aggregates ONLY, for a granted read-only production session
-- (REPEATABLE READ READ ONLY, TimeZone=Etc/UTC, identity asserted first, per AGENT-PROTOCOL section 6).
-- Expected on production (reviewed 2026-11-14: 6,845 DraftGuru picks, 31 DraftGuru persons without
-- identity rows): picks_audited_insert = 35, persons_audited_only = 31, persons_with_marker = 31,
-- draftguru_persons_without_identity = 31. Any other value means the guard's discriminator does not
-- select exactly the D-336-2 rows and must be re-reviewed before the acquisition.
-- It reads no row text, no name and no URL.
WITH ds AS (SELECT id FROM sources WHERE key = 'draftguru'),
audited AS (  -- the discriminator: a data_edits row of the I336 audited-insert group (tool: AUDIT_FIELD_GROUP)
  SELECT dp.id, dp.draft_person_id
    FROM draft_picks dp, ds
   WHERE dp.source_id = ds.id
     AND EXISTS (SELECT 1 FROM data_edits e
                  WHERE e.table_name = 'draft_picks' AND e.row_id = dp.id
                    AND e.field_group = 'source_insert')
)
SELECT
  (SELECT count(*) FROM draft_picks dp, ds WHERE dp.source_id = ds.id)                          AS draftguru_picks,
  (SELECT count(*) FROM audited)                                                                AS picks_audited_insert,
  (SELECT count(*) FROM draft_picks dp, ds
    WHERE dp.source_id = ds.id
      AND EXISTS (SELECT 1 FROM data_edits e WHERE e.table_name = 'draft_picks' AND e.row_id = dp.id)) AS picks_with_any_data_edits,
  (SELECT count(*) FROM draft_picks dp, ds
    WHERE dp.source_id = ds.id
      AND EXISTS (SELECT 1 FROM data_overrides o
                   WHERE o.entity_type = 'draft_picks' AND o.is_active
                     AND o.entity_key = dp.source_id::text || '|' || dp.player_url || '|'
                                        || dp.draft_year::text || '|' || dp.draft_kind))        AS picks_with_active_override,
  (SELECT count(DISTINCT a.draft_person_id) FROM audited a)                                     AS persons_of_audited_picks,
  (SELECT count(*) FROM draft_persons p, ds   -- persons created by the corrections: every pick of theirs is audited
    WHERE p.source_id = ds.id
      AND EXISTS (SELECT 1 FROM audited a WHERE a.draft_person_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM draft_picks k
                       WHERE k.draft_person_id = p.id
                         AND k.id NOT IN (SELECT id FROM audited)))                             AS persons_audited_only,
  (SELECT count(*) FROM draft_persons p, ds
    WHERE p.source_id = ds.id
      AND p.confidence_notes LIKE 'AFLDB-ISSUE-336 bounded insert%')                            AS persons_with_marker,
  (SELECT count(*) FROM draft_persons p, ds
    WHERE p.source_id = ds.id
      AND NOT EXISTS (SELECT 1 FROM external_identities x
                       WHERE x.source_id = p.source_id AND x.external_id = p.player_url))       AS draftguru_persons_without_identity;
