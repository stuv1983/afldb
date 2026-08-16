-- =====================================================================
-- AFLDB — reconcile every role's privileges with the intended model
-- =====================================================================
-- Run this against a database whenever its grants might have drifted:
--
--   npm run db:privileges                      # uses AFLDB_OWNER_DATABASE_URL
--   psql "$AFLDB_OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql
--   sudo -u postgres psql -d afldb_dev -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql
--
-- It exists because the grant model has three ways of getting lost, and
-- the migration runner cannot fix any of them — every migration is
-- recorded as applied, so re-running it is a no-op:
--
--   1. `pg_restore --no-privileges` (docs/backup-restore.md §6) restores
--      the tables and NONE of their ACLs.
--   2. Re-running 00_install_postgres.sh used to re-grant afldb_app
--      SELECT on everything, undoing migrations 031/038/039.
--   3. Running 02_add_auth_role.sh after the migrations means every
--      `IF EXISTS (afldb_auth)` guard in migrations 023/024/030/034/037
--      was skipped, so the auth role has no table grants at all.
--
-- Idempotent, and safe to run at any point in a build: every role and
-- every schema is guarded, so it does the part of the model that the
-- database is ready for and says what it skipped.
--
-- SOURCE OF TRUTH for afldb_app is afldb_meta.app_readable_tables
-- (migration 039), not a list in this file. That is the whole point:
-- the registry is data, so a dump carries it, so recovery can rebuild
-- grants from the backup itself rather than from whatever this file
-- happened to say on the day it was written. Public tables absent from
-- the registry are REVOKED here, which is what makes forgetting to
-- register a new operational table safe.
--
-- afldb_auth and afldb_import are small, fixed sets that belong to
-- specific migrations, so they are enumerated below with the migration
-- that established each one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Schema-level access
-- ---------------------------------------------------------------------
DO $$
DECLARE
  role_name text;
  schema_name text;
BEGIN
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';

  FOREACH role_name IN ARRAY ARRAY['afldb_app', 'afldb_import', 'afldb_backup', 'afldb_auth'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_owner') THEN
    EXECUTE 'GRANT CREATE ON SCHEMA public TO afldb_owner';
  END IF;

  -- Import pipeline internals (migrations 014, 025) and the AFLW read
  -- model the public site queries (026).
  FOREACH schema_name IN ARRAY ARRAY['staging', 'staging_aflw', 'aflw'] LOOP
    IF to_regnamespace(schema_name) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app') THEN
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO afldb_app', schema_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO afldb_import', schema_name);
      END IF;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_app — SELECT on exactly the registered tables, nothing else
-- ---------------------------------------------------------------------
DO $$
DECLARE
  readable text[];
  t record;
  granted  int := 0;
  revoked  int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app') THEN
    RAISE NOTICE 'afldb_app: role absent, skipped';
    RETURN;
  END IF;

  -- Fail closed rather than guessing. Before migration 039 there is no
  -- registry, and inventing one here ("everything that is not obviously
  -- operational") is exactly the rule that leaked auth_users and
  -- site_media. A fresh install has no tables yet anyway.
  IF to_regclass('afldb_meta.app_readable_tables') IS NULL THEN
    RAISE NOTICE 'afldb_app: afldb_meta.app_readable_tables absent (pre-039); run npm run db:migrate, then this script';
    RETURN;
  END IF;

  SELECT coalesce(array_agg(name), ARRAY[]::text[])
    INTO readable
    FROM afldb_meta.app_readable_tables;

  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname
  LOOP
    IF t.relname = ANY (readable) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO afldb_app', t.relname);
      granted := granted + 1;
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_app', t.relname);
      revoked := revoked + 1;
    END IF;
  END LOOP;

  -- Migration 039's inversion, reasserted: a table created after this
  -- point is unreadable until it is registered.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE SELECT ON TABLES FROM afldb_app';

  -- The staging and AFLW schemas hold no operational table, so they keep
  -- the blanket read the migrations gave them.
  IF to_regnamespace('staging') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA staging TO afldb_app';
  END IF;
  IF to_regnamespace('staging_aflw') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA staging_aflw TO afldb_app';
  END IF;
  IF to_regnamespace('aflw') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA aflw TO afldb_app';
  END IF;

  RAISE NOTICE 'afldb_app: % public tables readable, % revoked', granted, revoked;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_import — the statistical tables only (migrations 010, 011, 023, 039)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  operational text[];
  t record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    RAISE NOTICE 'afldb_import: role absent, skipped';
    RETURN;
  END IF;

  -- Operational = public tables the app role may not read. The import
  -- role has no business in them either (migration 039): it can neither
  -- rewrite a password hash nor truncate the published page's images.
  IF to_regclass('afldb_meta.app_readable_tables') IS NULL THEN
    RAISE NOTICE 'afldb_import: registry absent (pre-039), skipped';
    RETURN;
  END IF;

  SELECT coalesce(array_agg(c.relname), ARRAY[]::text[])
    INTO operational
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND c.relname NOT IN (SELECT name FROM afldb_meta.app_readable_tables);

  FOR t IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname
  LOOP
    IF t.relname = ANY (operational) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', t.relname);
    ELSIF t.relkind IN ('v', 'm') THEN
      -- A view is not a reload target; the importer only reads them.
      EXECUTE format('GRANT SELECT ON public.%I TO afldb_import', t.relname);
    ELSE
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO afldb_import',
        t.relname);
    END IF;
  END LOOP;

  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO afldb_import';

  -- Migration 023's intended, deliberately narrow submission access. The
  -- pipeline does its submission writes on the auth pool; this is what
  -- the promotion path reads.
  IF to_regclass('public.data_submissions') IS NOT NULL THEN
    GRANT SELECT ON data_submissions TO afldb_import;
    GRANT UPDATE (status, promoted_at, import_batch_id, error)
      ON data_submissions TO afldb_import;
  END IF;
  IF to_regclass('public.data_submission_rows') IS NOT NULL THEN
    GRANT SELECT ON data_submission_rows TO afldb_import;
  END IF;

  -- Future statistical tables: the import role's default privilege stays,
  -- and 039 keeps operational tables out of its reach by revoking above.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO afldb_import';

  IF to_regnamespace('staging') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA staging TO afldb_import';
  END IF;
  IF to_regnamespace('staging_aflw') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA staging_aflw TO afldb_import';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA staging_aflw TO afldb_import';
  END IF;
  IF to_regnamespace('aflw') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA aflw TO afldb_import';
  END IF;

  RAISE NOTICE 'afldb_import: statistical tables writable, % operational tables revoked',
    coalesce(array_length(operational, 1), 0);
END
$$;

-- ---------------------------------------------------------------------
-- afldb_auth — the operational tables (migrations 023, 024, 030, 032, 034, 037)
-- ---------------------------------------------------------------------
-- Every one of these grants lives inside an `IF EXISTS (afldb_auth)`
-- guard in its migration, so all of them are silently skipped when the
-- role is created after the migrations run. This is the catch-up, and it
-- is generated from the same list rather than the partial one that used
-- to sit in 02_add_auth_role.sh (which stopped at migration 023).
DO $$
DECLARE
  spec CONSTANT text[][] := ARRAY[
    -- table,                  privileges                              migration
    ['auth_users',             'SELECT, INSERT, UPDATE'],           -- 023
    ['auth_sessions',          'SELECT, INSERT, UPDATE'],           -- 023
    ['auth_audit_log',         'SELECT, INSERT'],                   -- 023
    ['beta_access_codes',      'SELECT, INSERT, UPDATE'],           -- 023
    ['beta_allowed_emails',    'SELECT, INSERT, UPDATE'],           -- 023
    ['beta_login_tokens',      'SELECT, INSERT, UPDATE'],           -- 023
    ['data_submissions',       'SELECT, INSERT, UPDATE'],           -- 023
    ['data_submission_rows',   'SELECT, INSERT, UPDATE, DELETE'],   -- 023
    ['beta_join_requests',     'SELECT, INSERT, UPDATE'],           -- 024
    ['admin_invites',          'SELECT, INSERT, UPDATE'],           -- 030
    ['site_settings',          'SELECT, INSERT, UPDATE'],           -- 034
    ['site_media',             'SELECT, INSERT, UPDATE, DELETE'],   -- 037
    -- Read-only: validation resolves submitted names against these.
    ['players',                'SELECT'],                           -- 023
    ['player_clubs',           'SELECT'],                           -- 023
    ['clubs',                  'SELECT'],                           -- 023
    ['club_aliases',           'SELECT'],                           -- 023
    ['seasons',                'SELECT'],                           -- 023
    ['awards',                 'SELECT'],                           -- 023
    ['award_nominations',      'SELECT'],                           -- 023
    ['award_winners',          'SELECT'],                           -- 023
    ['import_batches',         'SELECT'],                           -- 023
    ['matches',                'SELECT'],                           -- 032
    ['venues',                 'SELECT'],                           -- 032
    ['venue_aliases',          'SELECT']                            -- 032
  ];
  i int;
  applied int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    RAISE NOTICE 'afldb_auth: role absent, skipped';
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(spec, 1) LOOP
    IF to_regclass('public.' || quote_ident(spec[i][1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO afldb_auth', spec[i][2], spec[i][1]);
      applied := applied + 1;
    END IF;
  END LOOP;

  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afldb_auth';

  RAISE NOTICE 'afldb_auth: grants applied on % of % tables', applied, array_length(spec, 1);
END
$$;

-- ---------------------------------------------------------------------
-- afldb_backup — reads everything, writes nothing
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_backup') THEN
    RAISE NOTICE 'afldb_backup: role absent, skipped';
    RETURN;
  END IF;

  -- Role membership, unlike a table grant, needs superuser or ADMIN on
  -- the role being granted. That holds when the install script runs this
  -- as postgres and not when an operator runs `npm run db:privileges` as
  -- afldb_owner, so a refusal here is expected rather than a failure --
  -- and letting it abort would take the table grants above with it.
  BEGIN
    EXECUTE 'GRANT pg_read_all_data TO afldb_backup';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'afldb_backup: pg_read_all_data needs a superuser; unchanged';
  END;
END
$$;
