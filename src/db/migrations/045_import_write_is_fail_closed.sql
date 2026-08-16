-- =====================================================================
-- AFLDB 045 — Make afldb_import's write access fail CLOSED too
-- =====================================================================
-- Migration 039 inverted the schema-wide default privilege for afldb_app
-- and gave the reason in as many words: a rule that says "remember to
-- revoke" had leaked a table to the public role twice, and "a control
-- with a 0-for-2 record is not a control". It then left the identical
-- mechanism running for afldb_import:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
--
-- 039 revoked the import role's access to the eleven operational tables
-- that existed that day, which fixed the instance and not the mechanism.
-- The next operational table is fully writable and TRUNCATE-able by the
-- ETL role from the moment its migration runs until somebody happens to
-- run tools/maintenance/privileges.sql — the same failure mode, one role
-- across.
--
-- So this does for afldb_import what 039 did for afldb_app: invert the
-- default, and replace it with a registry that is data, so a dump carries
-- it and a restore can rebuild the grants from the backup rather than
-- from whatever a script said on the day it was written.
--
--   SELECT afldb_meta.grant_import_write('my_new_table');
--
-- Three smaller corrections travel with it, all from the same review:
--
--   SEQUENCES.  039 revoked the import role's access to the operational
--     TABLES and not to their identity sequences, and migration 011 had
--     granted UPDATE on every sequence in `public`. UPDATE on a sequence
--     is what setval() needs, so the ETL role could reset
--     auth_users_id_seq to 1 and make every subsequent login-adjacent
--     INSERT fail on a duplicate key. Nothing asked for that access; it
--     came from the same default privilege.
--
--   site_settings.  The reconciler infers "operational" as the complement
--     of afldb_app's readable registry, and site_settings is deliberately
--     app-readable (034: the home page renders it). That inference
--     therefore classed it as statistical and handed the ETL role
--     DELETE and TRUNCATE on the site's runtime configuration. An
--     explicit registry ends the inference along with the bug.
--
--   afldb_auth SEQUENCES.  023 and 030 grant it USAGE, SELECT on ALL
--     sequences in `public` — nextval on every statistical sequence — for
--     a role whose table grants are an enumerated list of two dozen. It
--     is narrowed here to the sequences behind the tables it may write.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Finding a table's own sequences
-- ---------------------------------------------------------------------
-- An identity column's sequence is linked to its table by a dependency,
-- not by its name, so this is the reliable way to ask "which sequences
-- belong to this table" — and the only way that keeps working if a table
-- is ever renamed.
CREATE OR REPLACE FUNCTION afldb_meta.owned_sequences(p_table text)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
AS $fn$
  SELECT s.relname::text
    FROM pg_class s
    JOIN pg_depend d    ON d.objid      = s.oid
                       AND d.classid    = 'pg_class'::regclass
                       AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class t     ON t.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE s.relkind  = 'S'
     AND n.nspname  = 'public'
     AND t.relname  = p_table;
$fn$;

COMMENT ON FUNCTION afldb_meta.owned_sequences(text) IS
  'The sequences backing a public table''s identity columns, found through the '
  'catalogue dependency rather than by guessing at <table>_<column>_seq.';

-- ---------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afldb_meta.import_writable_tables (
  name       text PRIMARY KEY,
  added_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE afldb_meta.import_writable_tables IS
  'The public tables afldb_import (the ETL role) may write. Authoritative, the '
  'same way afldb_meta.app_readable_tables is for afldb_app: '
  'tools/maintenance/privileges.sql grants exactly these and revokes the rest. '
  'Add a row with afldb_meta.grant_import_write(), never by hand.';

-- Seed with what the ETL actually reloads: every public table except the
-- operational ones and site_settings. Derived from the catalogue so the
-- migration cannot mis-transcribe the ~50 tables it is preserving.
--
-- Views and materialized views are excluded deliberately. The importer
-- only ever reads one, and the reconciler grants it SELECT on those
-- separately — a view is not a reload target.
INSERT INTO afldb_meta.import_writable_tables (name)
SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname <> ALL (ARRAY[
     'auth_users', 'auth_sessions', 'auth_audit_log',
     'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
     'beta_join_requests', 'data_submissions', 'data_submission_rows',
     'admin_invites', 'site_media',
     -- App-readable but not the ETL's business: a super admin's runtime
     -- choices, written by afldb_auth from /admin/settings.
     'site_settings'
   ])
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- The one-liner a future statistical migration calls
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afldb_meta.grant_import_write(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  seq text;
BEGIN
  IF to_regclass('public.' || quote_ident(table_name)) IS NULL THEN
    RAISE EXCEPTION 'public.% does not exist, so it cannot be registered writable', table_name;
  END IF;

  INSERT INTO afldb_meta.import_writable_tables (name)
  VALUES (table_name)
  ON CONFLICT (name) DO NOTHING;

  -- The role is absent on a cluster whose migrations run before role
  -- setup; privileges.sql applies the grant later in that case.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO afldb_import',
      table_name);
    -- The importer loads players and matches with explicit ids and then
    -- fast-forwards the sequence with setval(), which needs UPDATE.
    FOR seq IN SELECT name FROM afldb_meta.owned_sequences(table_name) LOOP
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO afldb_import', seq);
    END LOOP;
  END IF;
END
$fn$;

COMMENT ON FUNCTION afldb_meta.grant_import_write(text) IS
  'Register a public table as writable by afldb_import AND grant the DML, TRUNCATE '
  'and its sequences, in one statement so the registry and the catalogue cannot '
  'disagree. Call this from any migration creating a table the ETL reloads.';

-- ---------------------------------------------------------------------
-- The counterparts, so un-registering is not a manual DELETE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afldb_meta.revoke_app_read(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  DELETE FROM afldb_meta.app_readable_tables WHERE name = table_name;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app')
     AND to_regclass('public.' || quote_ident(table_name)) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON public.%I FROM afldb_app', table_name);
  END IF;
END
$fn$;

COMMENT ON FUNCTION afldb_meta.revoke_app_read(text) IS
  'Un-register a table and revoke afldb_app''s SELECT together. The inverse of '
  'grant_app_read(); dropping the table itself needs no call, since the reconciler '
  'clears registry rows whose table no longer exists.';

CREATE OR REPLACE FUNCTION afldb_meta.revoke_import_write(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  seq text;
BEGIN
  DELETE FROM afldb_meta.import_writable_tables WHERE name = table_name;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import')
     AND to_regclass('public.' || quote_ident(table_name)) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', table_name);
    FOR seq IN SELECT name FROM afldb_meta.owned_sequences(table_name) LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM afldb_import', seq);
    END LOOP;
  END IF;
END
$fn$;

COMMENT ON FUNCTION afldb_meta.revoke_import_write(text) IS
  'Un-register a table and revoke afldb_import''s write access and its sequences '
  'together. The inverse of grant_import_write().';

-- ---------------------------------------------------------------------
-- Invert the import default, then restate the model explicitly
-- ---------------------------------------------------------------------
DO $$
DECLARE
  operational CONSTANT text[] := ARRAY[
    'auth_users', 'auth_sessions', 'auth_audit_log',
    'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
    'beta_join_requests', 'data_submissions', 'data_submission_rows',
    'admin_invites', 'site_media', 'site_settings'
  ];
  t text;
  seq text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    RAISE NOTICE 'afldb_import absent; run tools/maintenance/privileges.sql once the role exists';
    RETURN;
  END IF;

  -- The inversion itself. Only `public` is touched: staging, staging_aflw
  -- and aflw (migrations 014/025/026) hold no operational table and keep
  -- their blanket defaults, which is what makes a staging reload work
  -- without registering anything.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM afldb_import';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM afldb_import';

  -- Everything the ETL writes today stays writable: those grants existed
  -- only because of the default privilege, so without this they would
  -- survive until the next restore and then vanish.
  FOR t IN SELECT name FROM afldb_meta.import_writable_tables ORDER BY name LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO afldb_import', t);
      FOR seq IN SELECT name FROM afldb_meta.owned_sequences(t) LOOP
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO afldb_import', seq);
      END LOOP;
    END IF;
  END LOOP;

  -- The operational tables, and now their sequences: 039 did the tables,
  -- and a sequence the ETL can setval() is a way into the table it feeds
  -- whether or not the table itself is revoked.
  FOREACH t IN ARRAY operational LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', t);
      FOR seq IN SELECT name FROM afldb_meta.owned_sequences(t) LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM afldb_import', seq);
      END LOOP;
    END IF;
  END LOOP;

  -- Migration 023's deliberately narrow submission access, restated for
  -- the third time (023, then 039) because this file is what a rebuilt
  -- database is reconciled against.
  IF to_regclass('public.data_submissions') IS NOT NULL THEN
    GRANT SELECT ON data_submissions TO afldb_import;
    GRANT UPDATE (status, promoted_at, import_batch_id, error)
      ON data_submissions TO afldb_import;
  END IF;
  IF to_regclass('public.data_submission_rows') IS NOT NULL THEN
    GRANT SELECT ON data_submission_rows TO afldb_import;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_auth keeps only the sequences behind its own tables
-- ---------------------------------------------------------------------
DO $$
DECLARE
  -- The tables afldb_auth may write (023, 024, 030, 034, 037). Only these
  -- have sequences it needs to advance; its grants on the statistical
  -- tables are SELECT alone, which uses no sequence at all.
  writable CONSTANT text[] := ARRAY[
    'auth_users', 'auth_sessions', 'auth_audit_log',
    'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
    'beta_join_requests', 'data_submissions', 'data_submission_rows',
    'admin_invites', 'site_settings', 'site_media'
  ];
  t text;
  seq text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM afldb_auth';

  FOREACH t IN ARRAY writable LOOP
    FOR seq IN SELECT name FROM afldb_meta.owned_sequences(t) LOOP
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO afldb_auth', seq);
    END LOOP;
  END LOOP;
END
$$;
