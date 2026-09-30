-- ---------------------------------------------------------------------
-- 108 — the importer may read the data_edits audit trail (AFLDB-ISSUE-238)
-- ---------------------------------------------------------------------
-- Migration 066 gave afldb_import INSERT on data_edits so a mutation
-- could append its own required audit row in the same transaction, but
-- no SELECT. An AFL API identity correction
-- (tools/migration/correct_afl_api_identity.ts) re-plans after its own
-- write (runbook §8.4, Q2) and, as afldb_import, reads the data_edits
-- audits that can explain a post-correction divergence. Without SELECT
-- that read fails with "permission denied for table data_edits" and
-- every successful apply rolls back.
--
-- SELECT only, the migration-068 shape. INSERT and the sequence USAGE
-- are 066's and are not restated. The table stays append-only from
-- every role's side: no UPDATE, no DELETE, no TRUNCATE, and it
-- deliberately remains OUT of afldb_meta.import_writable_tables, whose
-- reconciliation loop would grant full DML. Mirrored in
-- tools/maintenance/privileges.sql beside the 066 grants, after the
-- import revoke loop (GRANT SELECT, INSERT ON data_edits).
--
-- Deployment order, as for 066 and 068: this migration and
-- `npm run db:privileges` must be applied BEFORE the correction code
-- that depends on the grant, or every correction apply fails closed.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT ON TABLE public.data_edits TO afldb_import;
  END IF;
END
$$;
