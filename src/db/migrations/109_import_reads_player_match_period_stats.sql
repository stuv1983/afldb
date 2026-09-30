-- ---------------------------------------------------------------------
-- 109 — the importer may read player_match_period_stats (AFLDB-ISSUE-253)
-- ---------------------------------------------------------------------
-- The Data Editor's deleteMatch (src/db/queries/match-admin.ts) runs as
-- afldb_import. Its AFLDB-ISSUE-180 pre-check refuses a match that still
-- carries quarter-by-quarter player statistics, and to do that it reads
-- player_match_period_stats. Migration 062 granted afldb_import nothing
-- on that table, so the read fails with "permission denied for table
-- player_match_period_stats" and every match deletion throws.
--
-- SELECT only, the migration-068/108 shape. No INSERT, UPDATE, DELETE or
-- TRUNCATE, and the table deliberately stays OUT of
-- afldb_meta.import_writable_tables: AFLDB-ISSUE-142 Decision A still
-- holds (no writer exists; registering it would hand the reconciliation
-- loop's full DML to nothing). Mirrored in
-- tools/maintenance/privileges.sql after the import revoke loop.
--
-- Deployment order, as for 066, 068 and 108: this migration and
-- `npm run db:privileges` restore match deletion; no code change is
-- needed for Defect A.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT ON TABLE public.player_match_period_stats TO afldb_import;
  END IF;
END
$$;
