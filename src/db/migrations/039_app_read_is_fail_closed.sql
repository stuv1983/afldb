-- =====================================================================
-- AFLDB 039 — Make afldb_app's read access fail CLOSED
-- =====================================================================
-- Three times now a table has reached the public role by accident:
-- migration 023's auth tables (fixed by 031), migration 037's site_media
-- (fixed by 038), and both times the author had written a header
-- explaining that no grant was intended. The grant did not come from
-- them. It came from the schema-wide default privilege set up in
-- tools/maintenance:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
--     GRANT SELECT ON TABLES TO afldb_app;
--
-- That rule means FORGETTING GRANTS ACCESS. 031 responded by requiring
-- every future operational table to add its own REVOKE, and 037 is the
-- proof that a rule written in prose does not hold: the author read
-- 031's warning, reasoned about it, and still shipped the leak. A
-- control with a 0-for-2 record is not a control.
--
-- So this inverts the default. After this migration a table created in
-- `public` is unreadable by afldb_app until something says otherwise,
-- and the failure mode of forgetting flips from "a table leaks to the
-- internet, silently, until someone happens to run the privileges test"
-- to "a public page raises permission denied the first time it is
-- opened in development". The second is enormously cheaper, and it is
-- the one that cannot ship unnoticed.
--
-- What replaces the default privilege is a registry —
-- afldb_meta.app_readable_tables — listing the public tables afldb_app
-- may SELECT. It is a TABLE rather than a list in a script on purpose:
-- it is data, so pg_dump carries it, so a restore can rebuild the whole
-- grant model from it. That closes the hole documented in
-- docs/backup-restore.md §6, where `pg_restore --no-privileges`
-- recreated every table under the old default privilege and handed
-- afldb_app SELECT on the auth tables again with nothing to notice.
-- tools/maintenance/privileges.sql is the reconciler that reads it.
--
-- Adding a statistical table from now on is one line:
--
--   SELECT afldb_meta.grant_app_read('my_new_table');
--
-- which registers it and grants it together, so the two cannot drift.
-- An operational table simply says nothing, and is safe by default.
--
-- This migration also closes the same hole for afldb_import, which the
-- identical default-privileges mechanism had quietly handed
-- SELECT/INSERT/UPDATE/DELETE (migration 010 added TRUNCATE) on every
-- operational table: it could rewrite a password hash in auth_users,
-- delete the audit rows that would show it, or TRUNCATE site_media —
-- the declared source of truth for the published apex page. Nothing in
-- the codebase ever asked it to. src/lib/ingest/pipeline.ts does all of
-- its submission reads and writes on the auth pool; the import role's
-- connection touches only the statistical tables and import_batches.
-- Its default privilege is left in place — it is a trusted ETL role and
-- every future statistical table genuinely needs it — but its access to
-- the operational tables is removed and pinned back to what migration
-- 023 actually intended.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS afldb_meta;

-- ---------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afldb_meta.app_readable_tables (
  name       text PRIMARY KEY,
  added_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE afldb_meta.app_readable_tables IS
  'The public tables afldb_app (the role every public page runs as) may '
  'SELECT. Authoritative: tools/maintenance/privileges.sql grants exactly '
  'these and revokes everything else in `public`, which is how a restored '
  'or reinstalled database gets its grant model back. Add a row with '
  'afldb_meta.grant_app_read(), never by hand.';

-- Seed it with what is readable today: every public table except the
-- operational ones. Derived from the catalogue rather than typed out, so
-- the migration cannot mis-transcribe the ~50 tables it is preserving.
INSERT INTO afldb_meta.app_readable_tables (name)
SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND c.relname <> ALL (ARRAY[
     'auth_users', 'auth_sessions', 'auth_audit_log',
     'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
     'beta_join_requests', 'data_submissions', 'data_submission_rows',
     'admin_invites', 'site_media'
   ])
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- The one-liner a future statistical migration calls
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afldb_meta.grant_app_read(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF to_regclass('public.' || quote_ident(table_name)) IS NULL THEN
    RAISE EXCEPTION 'public.% does not exist, so it cannot be registered readable', table_name;
  END IF;

  INSERT INTO afldb_meta.app_readable_tables (name)
  VALUES (table_name)
  ON CONFLICT (name) DO NOTHING;

  -- The role is absent on a cluster whose migrations run before role
  -- setup; privileges.sql applies the grant later in that case.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app') THEN
    EXECUTE format('GRANT SELECT ON public.%I TO afldb_app', table_name);
  END IF;
END
$fn$;

COMMENT ON FUNCTION afldb_meta.grant_app_read(text) IS
  'Register a public table as readable by afldb_app AND grant the SELECT, '
  'in one statement so the registry and the catalogue cannot disagree. '
  'Call this from any migration creating a table a public page reads.';

-- ---------------------------------------------------------------------
-- Invert the default, then restate the model explicitly
-- ---------------------------------------------------------------------
DO $$
DECLARE
  operational CONSTANT text[] := ARRAY[
    'auth_users', 'auth_sessions', 'auth_audit_log',
    'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
    'beta_join_requests', 'data_submissions', 'data_submission_rows',
    'admin_invites', 'site_media'
  ];
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app') THEN
    RAISE NOTICE 'afldb_app absent; run tools/maintenance/privileges.sql once the role exists';
    RETURN;
  END IF;

  -- The inversion itself. Only the `public` default is touched: staging,
  -- staging_aflw and aflw (migrations 014/025/026) hold no operational
  -- table and keep theirs.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE SELECT ON TABLES FROM afldb_app';

  -- Everything readable today stays readable: the grants existed only
  -- because of the default privilege, so without this they would survive
  -- until the next restore and then vanish.
  FOR t IN
    SELECT name FROM afldb_meta.app_readable_tables ORDER BY name
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON public.%I TO afldb_app', t);
    END IF;
  END LOOP;

  -- Restating 031 and 038 rather than trusting that they ran: this file
  -- is what a rebuilt database is reconciled against.
  FOREACH t IN ARRAY operational LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_app', t);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_import has no business in the operational tables
-- ---------------------------------------------------------------------
DO $$
DECLARE
  operational CONSTANT text[] := ARRAY[
    'auth_users', 'auth_sessions', 'auth_audit_log',
    'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
    'beta_join_requests', 'data_submissions', 'data_submission_rows',
    'admin_invites', 'site_media'
  ];
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY operational LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', t);
    END IF;
  END LOOP;

  -- Migration 023 lines 193-194 are the intended scope, and they were
  -- always narrower than what the role actually held: a column-scoped
  -- UPDATE is meaningless next to a full-table one the default privilege
  -- had already granted. Re-granted here at the width 023 asked for.
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
