-- =====================================================================
-- AFLDB 081 — Super Admin clear of disposable NL search telemetry
-- =====================================================================
-- AFLDB-ISSUE-119. /admin/nl-search can read and export telemetry but has
-- no way to retire it, so operational NL logging accumulates with no safe
-- exit. This migration adds the only new database capability that reset
-- needs: one fixed, owner-defined function the auth role may EXECUTE and
-- nothing else.
--
-- NUMBERING. 079 is the highest migration on `main`; 080 is already
-- committed on branch `opus/gridley-corpus` (080_external_grids.sql), so
-- this takes 081. The gap on this branch is deliberate and harmless --
-- tools/db/migrate.ts keys afldb_meta.schema_migrations by FILENAME and
-- applies pending files in name order, so it neither requires contiguous
-- numbers nor cares that 080 arrives later.
--
-- WHAT MAY BE CLEARED, AND WHAT MAY NOT
--
-- Migrations 046/047/049 established three different kinds of record and
-- deliberately kept them apart:
--
--   nl_search_log      what the ENGINE did.     Append-only telemetry.
--   nl_search_feedback what a READER said.      Append-only fact.
--   nl_search_review   what an ADMIN concluded. Mutable judgement.
--
-- Only the first is disposable, and only where nothing durable depends on
-- it. A log row is retained when:
--
--   * a nl_search_review row references it (a human decision about that
--     exact search -- 047 compares the table to an issue tracker kept
--     separate from the error it was filed from);
--   * a nl_search_feedback row carries its client_ref (049: a reader
--     having pressed "no" at 8:04pm is a fact that happened); or
--   * it is an ANCESTOR, to any depth, of a row retained for either
--     reason. parent_search_id (047) is what makes a reformulation chain
--     readable; keeping the reviewed leaf and dropping the question it
--     rephrased would leave the review pointing at a search whose context
--     has been destroyed.
--
-- Ancestry only. A disposable CHILD of a retained row is deleted, and so
-- is a disposable SIBLING hanging off a retained ancestor: retention
-- follows the parent chain upward, not the whole connected component.
--
-- app_health_events (052) is not NL telemetry and loses no row. Its
-- related_search_id is ON DELETE SET NULL, so links to cleared logs are
-- detached by the FK the schema already declares, and the number of those
-- detachments is returned so the audit event can record it.
--
-- WHY DELETE AND NOT TRUNCATE
--
-- Eligibility is per row, so TRUNCATE cannot express it: it would take
-- the reviewed and feedback-matched evidence with it, needs a wider
-- privilege than anything this application holds, and drags in sequence
-- restart and CASCADE hazards that nothing here wants. A single DELETE
-- also settles the self-reference cleanly -- parent_search_id is NO
-- ACTION, whose check fires at end of statement, so one statement may
-- remove a disposable parent and its disposable children together.
-- Identity sequences are never reset; ids stay monotonic.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT A DELETE GRANT
--
-- afldb_auth is one shared role: public feedback submission, sign-in, and
-- every human administrator all connect as it. Granting it DELETE on
-- nl_search_log would hand that shared role arbitrary deletion of the
-- table forever, to satisfy one Super Admin-only operation. Instead the
-- role gets EXECUTE on this function and nothing else, so the only
-- deletion it can express is the one written below. The function is
-- owned by afldb_owner, takes no parameters, builds no dynamic SQL, and
-- pins search_path, so there is no input to subvert and no schema to
-- shadow.
--
-- It deliberately does NOT check who is calling. PostgreSQL sees only the
-- shared role, so any actor id the function could test would be supplied
-- by the same caller it is meant to constrain -- security theatre. Human
-- authorisation stays at the canonical server boundary
-- (requireSuperAdmin(), src/lib/auth/session.ts), which revalidates the
-- signed session against the database; this function bounds what SQL that
-- boundary is able to reach.
-- =====================================================================

CREATE FUNCTION public.nl_search_telemetry_clear()
RETURNS TABLE (
  deleted_log_rows          bigint,
  retained_log_rows         bigint,
  retained_review_rows      bigint,
  retained_feedback_rows    bigint,
  detached_app_health_links bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_deleted       bigint;
  v_linked_before bigint;
  v_linked_after  bigint;
BEGIN
  -- ---------------------------------------------------------------
  -- The cutoff
  -- ---------------------------------------------------------------
  -- SHARE ROW EXCLUSIVE blocks writers (INSERT/UPDATE/DELETE take ROW
  -- EXCLUSIVE, which conflicts) while leaving every reader untouched,
  -- and conflicts with itself so two clears can never interleave. The
  -- locks are held until the CALLING transaction commits, which is what
  -- gives the operation a defined boundary: everything eligible and
  -- committed by the time the last lock is acquired is cleared, and a
  -- writer blocked here -- including a deferred after() log insert --
  -- commits afterwards and survives as post-clear telemetry.
  --
  -- Child before parent, matching the direction the application's own
  -- writers take these tables (a review or a health event is written
  -- against a log row that already exists), so this cannot deadlock
  -- against them by approaching the same pair from opposite ends.
  LOCK TABLE public.nl_search_review   IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.nl_search_feedback IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.app_health_events  IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.nl_search_log      IN SHARE ROW EXCLUSIVE MODE;

  -- Attached links, counted before and after rather than predicted from
  -- the retained set. The FK's SET NULL destroys the evidence it would
  -- take to count them afterwards, and a second copy of the closure
  -- below -- written to predict the same number -- is exactly the kind
  -- of duplicate that drifts. Under the locks above nothing else can
  -- move this count, so the difference IS the detachment.
  SELECT count(*) INTO v_linked_before
    FROM public.app_health_events
   WHERE related_search_id IS NOT NULL;

  WITH RECURSIVE protected AS (
    -- Seeds: log rows something durable points at.
    SELECT r.search_log_id AS id
      FROM public.nl_search_review r
    UNION
    -- 049 correlates feedback by client_ref rather than by a foreign
    -- key, so this is a join and not an FK walk. Feedback whose deferred
    -- log never landed matches nothing here and is untouched either way:
    -- this query only ever adds log rows to keep.
    SELECT l.id
      FROM public.nl_search_log l
      JOIN public.nl_search_feedback f ON f.client_ref = l.client_ref
     WHERE l.client_ref IS NOT NULL
  ),
  retained AS (
    SELECT p.id FROM protected p
    UNION
    -- Upward, one generation per iteration, to whatever depth the chain
    -- actually has -- not the single hop a plain join would give. UNION
    -- rather than UNION ALL: dedup against everything already retained
    -- is what terminates this on a chain that revisits an id.
    SELECT l.parent_search_id
      FROM public.nl_search_log l
      JOIN retained rt ON rt.id = l.id
     WHERE l.parent_search_id IS NOT NULL
  )
  -- One statement, so the surviving self-referencing set goes together
  -- and the NO ACTION check at end of statement sees a consistent table.
  -- NOT EXISTS rather than NOT IN: the same rows, but immune to the NULL
  -- semantics that make NOT IN match nothing at all if the set ever
  -- acquires one.
  DELETE FROM public.nl_search_log l
   WHERE NOT EXISTS (SELECT 1 FROM retained rt WHERE rt.id = l.id);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- The FK's SET NULL runs as an after-statement trigger, so it has
  -- already happened by the time this reads the table.
  SELECT count(*) INTO v_linked_after
    FROM public.app_health_events
   WHERE related_search_id IS NOT NULL;

  -- Reported rather than assumed: the caller writes these into the audit
  -- row in the same transaction, and every retained figure is measured
  -- from the tables as they now stand rather than from the closure that
  -- produced them, so a wrong closure shows up as a wrong count instead
  -- of being confirmed by its own arithmetic.
  RETURN QUERY
  SELECT
    v_deleted,
    (SELECT count(*) FROM public.nl_search_log),
    (SELECT count(*) FROM public.nl_search_review),
    (SELECT count(*) FROM public.nl_search_feedback),
    v_linked_before - v_linked_after;
END
$fn$;

COMMENT ON FUNCTION public.nl_search_telemetry_clear() IS
  'AFLDB-ISSUE-119. Deletes disposable nl_search_log rows -- everything '
  'not carrying a review, not matching reader feedback by client_ref, and '
  'not an ancestor of such a row at any depth -- and returns deleted, '
  'retained and detached-link counts for the caller''s audit event. Never '
  'deletes a review, a feedback row or an app_health_events row, never '
  'truncates, and never resets a sequence. EXECUTE belongs to afldb_auth '
  'alone; human authorisation is requireSuperAdmin() in the Server Action.';

-- ---------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------
-- Ownership is part of the security contract, not an accident of who ran
-- the migration: SECURITY DEFINER executes as the owner, so a function
-- left owned by a superuser on an install that migrates as postgres would
-- be a far wider capability than the one described above. Set before the
-- grants below so the recorded grantor is the intended owner too.
--
-- An operator running as a role with no membership in afldb_owner gets a
-- NOTICE rather than a failed migration -- the same way privileges.sql
-- treats the role grant it may not be entitled to make -- because
-- aborting here would take the whole migration with it on a half-set-up
-- cluster. privileges.sql is the catch-up for that case.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_owner') THEN
    RAISE NOTICE 'nl_search_telemetry_clear(): afldb_owner absent, ownership left as created';
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.nl_search_telemetry_clear() OWNER TO afldb_owner';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE
      'nl_search_telemetry_clear(): owner left as %, not afldb_owner -- rerun as a member of afldb_owner',
      pg_get_userbyid(
        (SELECT proowner FROM pg_proc WHERE oid = 'public.nl_search_telemetry_clear()'::regprocedure)
      );
  END;
END
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
-- A new function is executable by PUBLIC by default, which for a
-- SECURITY DEFINER function means every role in the cluster inherits the
-- owner's ability to run it. Revoking PUBLIC is therefore the grant that
-- matters, and it is what keeps afldb_app, afldb_import and afldb_backup
-- out: none of them is named below, and none of them holds anything here
-- except through PUBLIC.
REVOKE ALL ON FUNCTION public.nl_search_telemetry_clear() FROM PUBLIC;

-- Guarded the way 046/047/049/052 guard their afldb_auth grants: the role
-- does not exist yet on a fresh install (02_add_auth_role.sh runs after
-- the schema migrations), and tools/maintenance/privileges.sql is the
-- catch-up for that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT EXECUTE ON FUNCTION public.nl_search_telemetry_clear() TO afldb_auth;
  END IF;
END
$$;
