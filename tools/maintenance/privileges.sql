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
-- SOURCE OF TRUTH is a pair of registries, not a list in this file:
--
--   afldb_meta.app_readable_tables      what afldb_app may SELECT  (039)
--   afldb_meta.import_writable_tables   what afldb_import may write (045)
--
-- That is the whole point: the registries are data, so a dump carries
-- them, so recovery can rebuild grants from the backup itself rather than
-- from whatever this file happened to say on the day it was written.
-- Public relations absent from a registry are REVOKED here, which is what
-- makes forgetting to register a new operational table safe.
--
-- Until migration 045 the import role's scope was inferred as "everything
-- afldb_app cannot read". That inference was wrong in both directions: it
-- classed site_settings — app-readable by design, since the home page
-- renders it — as an ETL table and handed the importer TRUNCATE on the
-- site's runtime configuration. Two registries, no inference.
--
-- afldb_auth is a small, fixed set that belongs to specific migrations,
-- so it is enumerated below with the migration that established each
-- grant, and everything outside that list is revoked from it.
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
-- Registry hygiene — a name outlives the table that claimed it
-- ---------------------------------------------------------------------
-- A registry row is only ever created for a table that exists, so a row
-- with no matching relation means the table was dropped. Left in place it
-- is a loaded gun: a LATER table that happens to reuse the name is
-- granted on the next run of this script, with nothing having decided
-- that afresh.
DO $$
DECLARE
  removed text[];
BEGIN
  IF to_regclass('afldb_meta.app_readable_tables') IS NOT NULL THEN
    WITH gone AS (
      DELETE FROM afldb_meta.app_readable_tables r
       WHERE to_regclass('public.' || quote_ident(r.name)) IS NULL
      RETURNING r.name
    )
    SELECT array_agg(name ORDER BY name) INTO removed FROM gone;
    IF removed IS NOT NULL THEN
      RAISE NOTICE 'app_readable_tables: dropped % stale entr(y/ies): %',
        array_length(removed, 1), array_to_string(removed, ', ');
    END IF;
  END IF;

  IF to_regclass('afldb_meta.import_writable_tables') IS NOT NULL THEN
    WITH gone AS (
      DELETE FROM afldb_meta.import_writable_tables r
       WHERE to_regclass('public.' || quote_ident(r.name)) IS NULL
      RETURNING r.name
    )
    SELECT array_agg(name ORDER BY name) INTO removed FROM gone;
    IF removed IS NOT NULL THEN
      RAISE NOTICE 'import_writable_tables: dropped % stale entr(y/ies): %',
        array_length(removed, 1), array_to_string(removed, ', ');
    END IF;
  END IF;
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

  -- A read-only role has no business advancing a sequence, and nothing in
  -- the public site inserts anything. Stated rather than assumed, because
  -- an install script re-run is exactly how a blanket sequence grant
  -- comes back.
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM afldb_app';

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

  RAISE NOTICE 'afldb_app: % public relations readable, % revoked', granted, revoked;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_import — the registered statistical tables only
--                (migrations 010, 011, 023, 039, 045)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  writable text[];
  readable text[];
  t record;
  seq text;
  granted int := 0;
  revoked int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    RAISE NOTICE 'afldb_import: role absent, skipped';
    RETURN;
  END IF;

  IF to_regclass('afldb_meta.import_writable_tables') IS NULL THEN
    RAISE NOTICE 'afldb_import: registry absent (pre-045), skipped; run npm run db:migrate, then this script';
    RETURN;
  END IF;

  SELECT coalesce(array_agg(name), ARRAY[]::text[])
    INTO writable FROM afldb_meta.import_writable_tables;

  -- Views are not reload targets, so they are not in the write registry.
  -- The importer reads them, and the app-readable registry is the list of
  -- views that are not operational.
  SELECT coalesce(array_agg(name), ARRAY[]::text[])
    INTO readable FROM afldb_meta.app_readable_tables;

  FOR t IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname
  LOOP
    IF t.relkind IN ('v', 'm') THEN
      IF t.relname = ANY (readable) THEN
        EXECUTE format('GRANT SELECT ON public.%I TO afldb_import', t.relname);
      ELSE
        EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', t.relname);
      END IF;
    ELSIF t.relname = ANY (writable) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO afldb_import',
        t.relname);
      -- setval() after a bulk load with explicit ids needs UPDATE on the
      -- sequence (migration 011); nothing else here does.
      FOR seq IN SELECT name FROM afldb_meta.owned_sequences(t.relname::text) LOOP
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO afldb_import', seq);
      END LOOP;
      granted := granted + 1;
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM afldb_import', t.relname);
      -- Migration 039 revoked the operational TABLES and left their
      -- sequences reachable. UPDATE on a sequence is what setval() needs,
      -- so auth_users_id_seq alone is enough to break every login-adjacent
      -- insert with a duplicate key.
      FOR seq IN SELECT name FROM afldb_meta.owned_sequences(t.relname::text) LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM afldb_import', seq);
      END LOOP;
      revoked := revoked + 1;
    END IF;
  END LOOP;

  -- Migration 045's inversion, reasserted alongside 039's: a table created
  -- after this point is neither readable by the site nor writable by the
  -- ETL until something registers it.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM afldb_import';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public '
          'REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM afldb_import';

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

  -- Migration 066 (AFLDB-ISSUE-027): required mutation audits commit in
  -- the same import-role transaction as the mutation. INSERT only —
  -- append-only from afldb_import's side, and deliberately NOT
  -- registered in import_writable_tables, whose loop above would grant
  -- full DML. The revoke loop strips these each run; re-grant them here.
  IF to_regclass('public.data_edits') IS NOT NULL THEN
    GRANT INSERT ON data_edits TO afldb_import;
    GRANT USAGE ON SEQUENCE data_edits_id_seq TO afldb_import;
  END IF;
  IF to_regclass('public.player_link_resolutions') IS NOT NULL THEN
    GRANT INSERT ON player_link_resolutions TO afldb_import;
    GRANT USAGE ON SEQUENCE player_link_resolutions_id_seq TO afldb_import;
    -- Migration 068 (AFLDB-ISSUE-044): a repeatable honours reload must
    -- read the append-only decisions it is forbidden to overwrite. The
    -- honours row stores only the outcome, and the legacy vocabulary maps
    -- 'from_draft' onto the same 'resolved', so a human link cannot be
    -- told from an import-derived one without this read. Still no UPDATE,
    -- DELETE or TRUNCATE: the table stays append-only.
    GRANT SELECT ON player_link_resolutions TO afldb_import;
  END IF;
  IF to_regclass('public.player_link_suggestions') IS NOT NULL THEN
    -- Migration 070 (AFLDB-ISSUE-078): a keyed reload that retires a
    -- source fact deletes a player_achievements row, and
    -- player_link_suggestions.target_id points at it without a foreign
    -- key. An orphan there is NOT unsurfaced -- the "Reader suggestions"
    -- panel renders every open row unjoined -- so the loader refuses to
    -- retire a referenced row unless the curator names it explicitly.
    -- This read is what lets it see them. Read only: no INSERT, UPDATE,
    -- DELETE or TRUNCATE for the import role.
    GRANT SELECT ON player_link_suggestions TO afldb_import;
  END IF;

  -- Staging is the importer's own workspace and holds no operational
  -- table, so it keeps its blanket grants and its default privileges.
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

  RAISE NOTICE 'afldb_import: % registered tables writable, % relations revoked',
    granted, revoked;
END
$$;

-- ---------------------------------------------------------------------
-- afldb_auth — the operational tables
--              (migrations 023, 024, 030, 032, 034, 037, 046, 047, 049, 052)
-- ---------------------------------------------------------------------
-- Every one of these grants lives inside an `IF EXISTS (afldb_auth)`
-- guard in its migration, so all of them are silently skipped when the
-- role is created after the migrations run. This is the catch-up, and it
-- is generated from the same list rather than the partial one that used
-- to sit in 02_add_auth_role.sh (which stopped at migration 023).
--
-- The list is also subtractive: anything in `public` that is not named
-- here is revoked from afldb_auth. Without that this section could only
-- ever widen the role, so a hand-typed grant made during an incident, or
-- one left behind by an abandoned migration, survived every "reconcile"
-- this script claimed to perform.
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
    ['nl_search_log',          'SELECT, INSERT'],                   -- 046
    ['nl_search_review',       'SELECT, INSERT, UPDATE'],           -- 047
    -- Append-only by grant: no UPDATE, no DELETE (see migration 049).
    ['nl_search_feedback',     'SELECT, INSERT'],                   -- 049
    -- Append-only by grant: no UPDATE, no DELETE (see migration 052).
    ['app_health_events',      'SELECT, INSERT'],                   -- 052
    -- Content immutable; the workflow columns get a column-scoped UPDATE
    -- granted after this loop (see migration 056).
    ['player_link_suggestions', 'SELECT, INSERT'],                  -- 056
    -- Append-only by grant: no UPDATE, no DELETE (see migration 056).
    ['player_link_resolutions', 'SELECT, INSERT'],                  -- 056
    -- Append-only by grant: no UPDATE, no DELETE (see migration 057).
    ['data_edits',              'SELECT, INSERT'],                  -- 057
    -- Regenerated wholesale by the admin refresh action, so unlike the
    -- audit tables this one is fully writable (see migration 067).
    ['player_link_match_candidates', 'SELECT, INSERT, UPDATE, DELETE'], -- 067
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
  -- The tables afldb_auth writes, and so the only sequences it may
  -- advance. Its grants on the statistical tables are SELECT alone.
  written CONSTANT text[] := ARRAY[
    'auth_users', 'auth_sessions', 'auth_audit_log',
    'beta_access_codes', 'beta_allowed_emails', 'beta_login_tokens',
    'beta_join_requests', 'data_submissions', 'data_submission_rows',
    'admin_invites', 'site_settings', 'site_media', 'nl_search_log', 'nl_search_review',
    'nl_search_feedback', 'app_health_events',
    'player_link_suggestions', 'player_link_resolutions', 'data_edits',
    'player_link_match_candidates'
  ];
  named text[] := ARRAY[]::text[];
  i int;
  t record;
  seq text;
  applied int := 0;
  revoked int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    RAISE NOTICE 'afldb_auth: role absent, skipped';
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(spec, 1) LOOP
    named := named || spec[i][1];
    IF to_regclass('public.' || quote_ident(spec[i][1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO afldb_auth', spec[i][2], spec[i][1]);
      applied := applied + 1;
    END IF;
  END LOOP;

  -- Migration 056's column-scoped UPDATE: the workflow columns only, so
  -- the reader's own words stay immutable. Whole-table privileges live in
  -- the spec array; this is the one grant that cannot be expressed there.
  IF to_regclass('public.player_link_suggestions') IS NOT NULL THEN
    GRANT UPDATE (status, resolved_by, resolved_at)
      ON player_link_suggestions TO afldb_auth;
  END IF;

  -- Everything else in `public`, including anything a future migration
  -- adds without thinking about this role.
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND c.relname <> ALL (named)
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM afldb_auth', t.relname);
    revoked := revoked + 1;
  END LOOP;

  -- Sequences, narrowed to the tables above rather than the whole schema
  -- (023 and 030 grant `ALL SEQUENCES IN SCHEMA public`, which is nextval
  -- on every statistical sequence for a role that inserts into none).
  --
  -- owned_sequences() arrives with migration 045. Before it exists the
  -- blanket grant is kept: too wide, but a role that cannot advance the
  -- sequence behind auth_users cannot log anybody in, and this script has
  -- to leave a half-migrated database working.
  IF to_regprocedure('afldb_meta.owned_sequences(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM afldb_auth';
    FOR i IN 1 .. array_length(written, 1) LOOP
      FOR seq IN SELECT name FROM afldb_meta.owned_sequences(written[i]) LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO afldb_auth', seq);
      END LOOP;
    END LOOP;
  ELSE
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afldb_auth';
    RAISE NOTICE 'afldb_auth: sequence grants left schema-wide (pre-045)';
  END IF;

  RAISE NOTICE 'afldb_auth: grants applied on % of % tables, % other relations revoked',
    applied, array_length(spec, 1), revoked;
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
