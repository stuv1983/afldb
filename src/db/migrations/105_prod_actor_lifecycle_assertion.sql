-- =====================================================================
-- AFLDB 105 — In-transaction PROD actor viability assertion (AFLDB-ISSUE-251)
-- =====================================================================
-- AFLDB-ISSUE-251's PROD adoption write (runProdAdoptionWrite,
-- tools/rebuild/draftguru/register_issue224_s9_players.ts) must re-read the selected
-- attribution actor AUTHORITATIVELY inside the same transaction that performs the 92
-- registrations, before the first registration write -- so nothing can disable, demote or
-- un-enrol that actor between selection and commit. `afldb_import` (the write role) holds no
-- general SELECT on `auth_users` (migration 023 grants that table only to `afldb_auth`), and
-- this migration deliberately does not widen that: instead it adds one narrow SECURITY DEFINER
-- capability, following migration 081's `nl_search_telemetry_clear()` pattern exactly --
-- `afldb_import` gets EXECUTE on a function that runs as `afldb_owner`, and nothing more.
--
-- WHAT THE FUNCTION DOES AND DOES NOT DO
--
-- It accepts the one thing the caller has: an `auth_users.id`. It proves that row is a viable,
-- non-fixture Super Admin using EXACTLY `isViableSuperAdmin()`'s four conditions
-- (src/lib/auth/admin-lifecycle.ts) plus the production fixture-domain rule every other
-- promotion gate already applies (tools/db/promotion-inventory.ts:
-- TEST_FIXTURE_EMAIL_SQL/RESERVED_TEST_TLDS/RESERVED_EXAMPLE_DOMAINS). It returns `void` and
-- raises on refusal: no role, no email, no credential flag and no timestamp is ever handed back
-- to the caller, so a widened grant on this function still discloses nothing about accounts it
-- refuses. It is called for its side effect -- the row lock below -- as much as for the boolean
-- answer.
--
-- THE LOCK IS THE POINT
--
-- `SELECT ... FOR SHARE` takes a row-level share lock that blocks a concurrent UPDATE/DELETE
-- (disable, demote, credential wipe) against this exact `auth_users` row until whichever
-- transaction holds it ends. Called as the write transaction's first act, before any of the 92
-- registration writes, that lock is held for the remaining lifetime of the SAME transaction --
-- PostgreSQL releases row locks at COMMIT or ROLLBACK, never earlier -- which is what makes the
-- assertion authoritative rather than a snapshot moments old: the actor cannot be invalidated
-- between this call and the caller's own COMMIT. FOR SHARE rather than FOR UPDATE: this
-- transaction only needs to prevent the row changing under it, never to change the row itself,
-- and FOR SHARE additionally lets two concurrent viability checks against the same actor
-- coexist (each takes a share lock; share locks do not conflict with each other), where FOR
-- UPDATE would serialise them for no safety benefit.
--
-- NO DYNAMIC SQL, FIXED SEARCH PATH, FULLY-QUALIFIED RELATION
--
-- Exactly the same reasons migration 081 gives: SECURITY DEFINER executes as the owner, so an
-- unpinned search_path would let a same-named object earlier on some other role's search_path
-- shadow `auth_users`, and dynamic SQL built from the one input this function takes would be a
-- self-inflicted injection surface for no reason -- the whole body is static, parameterised SQL.
-- `pg_catalog, pg_temp` is the same minimal path 081 pins, and `public.auth_users` is written out
-- in full rather than relying on any search_path resolving it.
--
-- WHY THIS IS NOT A GENERAL "WHO IS THIS ACTOR" READ
--
-- It is deliberately narrower than the SQL function this issue's implementation report proposed
-- as an alternative (`afldb_actor_lifecycle_state(user_id) RETURNS (role, is_active,
-- has_password, has_totp)`): that shape returns account state to the caller, which is more than
-- an attribution-only mutation needs and more than this grant should disclose. Returning `void`
-- and raising means `afldb_import` learns only "viable" or "not viable, and why" (in the
-- exception message, which this migration keeps free of the row's email/role for anything beyond
-- what the caller already supplied as `p_actor_id`), never the row's credential state as data it
-- could store, log or branch on beyond a single pass/fail.
--
-- NEVER hard-codes `current_database() = 'afldb_prod'`: the CLI (`resolveProdTarget`,
-- `assertProdBoundary`) owns the environment/database boundary; this function owns only account
-- viability/fixture-domain refusal, so it also runs correctly against the isolated
-- `code_test_db` rehearsal (AFLDB-ISSUE-251 §7, tools/rebuild/draftguru/issue251_prod_rehearsal.ts)
-- without ever creating a database literally named `afldb_prod`.
-- =====================================================================

CREATE FUNCTION public.assert_viable_super_admin_actor(p_actor_id integer)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_role          text;
  v_disabled_at   timestamptz;
  v_password_hash text;
  v_totp_secret   text;
  v_email         text;
BEGIN
  -- FOR SHARE: held until the CALLING transaction ends, so a concurrent disable/demote/
  -- credential-wipe against this exact row cannot land before that transaction commits. See the
  -- migration banner for why FOR SHARE (not FOR UPDATE) is the right strength here.
  SELECT role, disabled_at, password_hash, totp_secret, email
    INTO v_role, v_disabled_at, v_password_hash, v_totp_secret, v_email
    FROM public.auth_users
   WHERE id = p_actor_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % does not exist', p_actor_id;
  END IF;

  -- Exactly isViableSuperAdmin()'s four conditions (src/lib/auth/admin-lifecycle.ts), checked in
  -- the same order that module documents them, one failure per branch so the exception message
  -- names the specific reason without ever including the row's email or any credential value.
  IF v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % is role %, not super_admin', p_actor_id, v_role;
  END IF;

  IF v_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % is disabled', p_actor_id;
  END IF;

  IF v_password_hash IS NULL THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % has no password enrolled', p_actor_id;
  END IF;

  IF v_totp_secret IS NULL THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % has no TOTP enrolled', p_actor_id;
  END IF;

  -- The production fixture-domain rule every other promotion gate already applies
  -- (tools/db/promotion-inventory.ts: TEST_FIXTURE_EMAIL_SQL / RESERVED_TEST_TLDS
  -- ('test', 'example', 'invalid', 'localhost') / RESERVED_EXAMPLE_DOMAINS ('example.com',
  -- 'example.net', 'example.org')), inlined here because a SQL migration cannot import a
  -- TypeScript module. tests/register-issue224-s9-dev-write-gate.test.ts pins this file's text
  -- against those exact TypeScript constants so the two can never silently diverge. Malformed
  -- addresses (no '@', an empty local or domain part) are refused alongside reserved domains,
  -- matching TEST_FIXTURE_EMAIL_SQL exactly rather than assuming email is always well-formed.
  IF (
       position('@' in v_email) <= 1
    OR position('@' in v_email) = length(v_email)
    OR rtrim(lower(split_part(v_email, '@', 2)), '.') = ''
    OR rtrim(lower(split_part(v_email, '@', 2)), '.') ~ '(^|\.)(test|example|invalid|localhost)$'
    OR rtrim(lower(split_part(v_email, '@', 2)), '.') ~ '(^|\.)(example\.com|example\.net|example\.org)$'
  ) THEN
    RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users.id % uses a reserved fixture/example email domain', p_actor_id;
  END IF;
END
$fn$;

COMMENT ON FUNCTION public.assert_viable_super_admin_actor(integer) IS
  'AFLDB-ISSUE-251. Asserts the given auth_users.id is an enabled, fully-enrolled, non-fixture '
  'super_admin -- isViableSuperAdmin()''s four conditions plus the production fixture-domain '
  'rule -- and row-locks it FOR SHARE so a concurrent lifecycle change cannot invalidate it '
  'before the caller''s transaction commits. Raises and writes nothing on refusal; returns no '
  'credential material on success. EXECUTE belongs to afldb_import alone -- afldb_import '
  'otherwise holds no SELECT on auth_users (migration 023) and this grants none: SECURITY '
  'DEFINER answers pass/fail without widening the table privilege.';

-- ---------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------
-- Same reasoning as migration 081: SECURITY DEFINER executes as the owner, so this must be
-- afldb_owner and not whatever role happened to run the migration, or the function would run
-- with a wider or narrower capability than intended depending on install history. A NOTICE
-- rather than a failed migration when the running role cannot make the change, for the same
-- reason 081 gives -- aborting here would take the whole migration down on a half-set-up
-- cluster; tools/maintenance/privileges.sql is the catch-up.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_owner') THEN
    RAISE NOTICE 'assert_viable_super_admin_actor(): afldb_owner absent, ownership left as created';
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.assert_viable_super_admin_actor(integer) OWNER TO afldb_owner';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE
      'assert_viable_super_admin_actor(): owner left as %, not afldb_owner -- rerun as a member of afldb_owner',
      pg_get_userbyid(
        (SELECT proowner FROM pg_proc WHERE oid = 'public.assert_viable_super_admin_actor(integer)'::regprocedure)
      );
  END;
END
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
-- A new function is executable by PUBLIC by default, which for a SECURITY DEFINER function
-- means every role in the cluster inherits the owner's ability to run it. Revoking PUBLIC is
-- therefore the grant that matters. EXECUTE goes to afldb_import ONLY: that is the role whose
-- write transaction needs the in-transaction assertion (AFLDB-ISSUE-251 §6). afldb_auth already
-- holds direct SELECT on auth_users (migration 023) and has no reason to call this instead;
-- afldb_app and afldb_backup get nothing here, exactly as they get nothing from 081.
REVOKE ALL ON FUNCTION public.assert_viable_super_admin_actor(integer) FROM PUBLIC;

-- Guarded the way 081 guards its afldb_auth grant: afldb_import always exists by the time this
-- migration runs in practice (it predates 023), but the guard costs nothing and keeps the same
-- shape as every other role-gated grant in this file set.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT EXECUTE ON FUNCTION public.assert_viable_super_admin_actor(integer) TO afldb_import;
  END IF;
END
$$;
