-- AFLDB V2 — database reversal of migration 115 (docs/v2/rollback-runbook.md section 5, step 2).
--
-- Migration 115 only adds one index (ix_afl_api_identity_adjudications_supersedes_id) on the existing
-- afl_api_identity_adjudications table; no data, table or constraint is touched. It is NOT needed for an
-- application rollback (the previous release ignores the index) and is reversed only when the database is
-- returned to the exact 001-110 schema and ledger, after rollback-111-114.sql.
--
-- Idempotent: IF EXISTS on the index and a name-keyed ledger delete, so a re-run changes nothing.
-- Rehearsed on isolated PostgreSQL 16 copies: docs/v2/rollback-populated-rehearsal-2026-10-20.md.

\set ON_ERROR_STOP on
BEGIN;
DROP INDEX IF EXISTS public.ix_afl_api_identity_adjudications_supersedes_id;
DELETE FROM afldb_meta.schema_migrations WHERE name = '115_adjudication_supersession_fk_index.sql';
COMMIT;
