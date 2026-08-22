-- ---------------------------------------------------------------------
-- 066 — required mutation audits commit atomically (AFLDB-ISSUE-027)
-- ---------------------------------------------------------------------
-- Until now every audited statistical mutation committed as
-- afldb_import and then wrote its required data_edits (057) or
-- player_link_resolutions (056) row afterwards on the separate
-- afldb_auth pool, because afldb_import held no grant on either audit
-- table. The two role-scoped transactions could disagree: the mutation
-- committed while the required audit failed.
--
-- This migration lets the mutation role append its own required audit
-- row inside the same transaction as the mutation, so an audit failure
-- rolls the whole mutation back. INSERT only: no SELECT, UPDATE,
-- DELETE or TRUNCATE, and the tables deliberately stay OUT of
-- afldb_meta.import_writable_tables, whose reconciliation loop would
-- grant full DML and destroy the append-only property. Mirrored in
-- tools/maintenance/privileges.sql after the import revoke loop (the
-- data_submissions narrow-grant precedent).
--
-- afldb_auth keeps its existing SELECT, INSERT: admin review pages
-- read the audit trail, and confirmUnlinked (audit-only, no
-- statistical write) still inserts on the auth pool.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT INSERT ON data_edits TO afldb_import;
    GRANT USAGE ON SEQUENCE data_edits_id_seq TO afldb_import;
    GRANT INSERT ON player_link_resolutions TO afldb_import;
    GRANT USAGE ON SEQUENCE player_link_resolutions_id_seq TO afldb_import;
  END IF;
END
$$;
