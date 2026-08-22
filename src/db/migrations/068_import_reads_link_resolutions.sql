-- ---------------------------------------------------------------------
-- 068 — the importer may read human identity decisions (AFLDB-ISSUE-044)
-- ---------------------------------------------------------------------
-- A repeatable honours reload has to answer one question before it
-- rewrites a row: did an admin already decide who this is? Until now it
-- could not. Migration 066 gave afldb_import INSERT on
-- player_link_resolutions so a link could record its own audit row, but
-- no SELECT, so the destructive loaders in tools/migration/import_awards.py
-- rebuilt every honours row from legacy source state and silently
-- discarded the later human decision.
--
-- Reading the append-only audit trail is the only way to tell a human
-- link from an import-derived one: the honours row itself stores the
-- OUTCOME (player_id + link_status_value = 'resolved') and the legacy
-- vocabulary maps 'from_draft' onto the same 'resolved', so the row
-- cannot distinguish the two on its own.
--
-- SELECT only. The table stays append-only from every role's side: no
-- UPDATE, no DELETE, no TRUNCATE, and it deliberately remains OUT of
-- afldb_meta.import_writable_tables, whose reconciliation loop would
-- grant full DML. Mirrored in tools/maintenance/privileges.sql beside
-- the 066 grants, after the import revoke loop.
--
-- Deployment order, as for 066: this migration and
-- `npm run db:privileges` must be applied BEFORE the importer code that
-- depends on the grant, or the honours loaders fail closed on the
-- resolution read.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT ON player_link_resolutions TO afldb_import;
  END IF;
END
$$;
