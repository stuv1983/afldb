-- =====================================================================
-- AFLDB 020 — Attendance provenance
-- =====================================================================
-- 1,651 matches have no attendance figure:
--
--   1,585  1897-1920, before crowds were recorded at all
--      29  2020
--      37  2021
--
-- Both available raw match sources are also NULL for every one of these,
-- so this is genuine source absence, not a join that failed.
--
-- The 2020 and 2021 gaps are tempting to fill: several matches in those
-- seasons genuinely were played to empty stands. But "we have no figure"
-- and "the figure was zero" are different claims, and only the second
-- one asserts something about the match. Writing 0 without a citation
-- would manufacture a fact.
--
-- This migration records WHY each figure is absent, so a confirmed
-- zero-crowd match can later be stored as a real 0 — distinguishable
-- from the unknowns around it — the moment a source supports it.
-- =====================================================================

ALTER TABLE matches
  ADD COLUMN attendance_status coverage_status,
  ADD COLUMN attendance_source_id smallint REFERENCES sources(id);

COMMENT ON COLUMN matches.attendance_status IS
  'Why attendance is present or absent. complete = the figure is known (including a genuine 0); not_collected = no source recorded it. Never infer 0 from not_collected.';
COMMENT ON COLUMN matches.attendance_source_id IS
  'Where a known figure came from. Required before a zero-crowd match may be stored as 0.';

UPDATE matches
   SET attendance_status = CASE
         WHEN attendance IS NOT NULL THEN 'complete'
         ELSE 'not_collected'
       END::coverage_status;

ALTER TABLE matches ALTER COLUMN attendance_status SET NOT NULL;

-- A number and its status must agree, in both directions.
ALTER TABLE matches
  ADD CONSTRAINT matches_attendance_status_ck CHECK (
    (attendance_status = 'complete' AND attendance IS NOT NULL)
    OR (attendance_status <> 'complete' AND attendance IS NULL)
  );

-- A zero crowd is an extraordinary claim, so it must cite a source.
-- Unknown attendance stays NULL and needs no citation.
ALTER TABLE matches
  ADD CONSTRAINT matches_zero_attendance_ck CHECK (
    attendance IS NULL OR attendance > 0 OR attendance_source_id IS NOT NULL
  );

CREATE INDEX ix_matches_attendance_unknown ON matches (season)
  WHERE attendance_status <> 'complete';

-- --------------------------------------------------------------------
-- Record the gap rather than leaving it implicit
-- --------------------------------------------------------------------
INSERT INTO data_issues (entity_type, entity_id, issue_type, severity,
                         description, details)
SELECT 'season', s.year, 'attendance_not_recorded', 'info',
       format('%s of %s matches in %s have no recorded attendance.',
              s.missing, s.total, s.year),
       jsonb_build_object('missing', s.missing, 'total', s.total,
                          'reason', CASE WHEN s.year <= 1920
                                         THEN 'crowds were not recorded in this era'
                                         ELSE 'not published by any available source' END)
FROM (
    SELECT season AS year,
           count(*) FILTER (WHERE attendance IS NULL) AS missing,
           count(*) AS total
    FROM matches GROUP BY season
) s
WHERE s.missing > 0;
