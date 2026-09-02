-- =====================================================================
-- AFLDB 082 — Repair double-encoded jsonb in auth_audit_log.detail
-- =====================================================================
-- AFLDB-ISSUE-121. `auth_audit_log.detail` is jsonb (migration 023), but
-- every row ever written to it holds a jsonb STRING SCALAR whose contents
-- are JSON text, not the jsonb OBJECT the column was declared for.
--
-- THE DEFECT
--
-- src/lib/auth/session.ts bound the payload as `${JSON.stringify(detail)}`.
-- That is one encoding too many. postgres.js learns each parameter's real
-- type from the server's ParameterDescription and then encodes the value
-- with its own serializer for that type; the serializer registered for
-- jsonb (OID 3802) is JSON.stringify. An already-stringified object is
-- therefore stringified again, and what lands in the column is:
--
--   SELECT jsonb_typeof(detail) FROM auth_audit_log;       -->  'string'
--   SELECT detail->>'deletedLogRows' FROM auth_audit_log;  -->  NULL
--
-- An explicit `::jsonb` cast does not help, because the parameter is
-- encoded before the cast is applied. Only `sql.json()` binds a jsonb
-- parameter correctly, which is what session.ts now does.
--
-- Migration 048 diagnosed and repaired the identical defect in
-- nl_search_log's three jsonb columns and explicitly left this column
-- alone: nothing read it structurally at the time, so changing its write
-- path was "a separate decision with its own blast radius". ISSUE-119 is
-- that decision arriving. Its Clear Search Telemetry action writes a
-- detail payload -- deleted and retained row counts -- that exists to be
-- read back, and on dev row 632 it read back as an opaque string. This
-- migration is the deferred half of 048.
--
-- NO DATA WAS LOST. The payloads are intact; they carry one surplus layer
-- of JSON encoding, and unwrapping it is exact.
--
-- NUMBERING. 081 is the highest migration on `dev` and 080 belongs to
-- `opus/gridley-corpus` (080_external_grids.sql, still unmerged), so this
-- takes 082. A scan of every local and remote ref on 2026-09-01 found no
-- 082_* migration anywhere in history. The 080 gap on this branch is
-- harmless for the reason 081 already recorded: tools/db/migrate.ts keys
-- afldb_meta.schema_migrations by FILENAME and applies pending files in
-- name order, so it neither requires contiguous numbers nor cares that
-- 080 arrives later.
--
-- PRIVILEGES ARE UNCHANGED. No new table and no new function: afldb_auth
-- keeps the INSERT/SELECT migration 023 granted, and the REVOKE in 031
-- still keeps afldb_app out. Nothing here needs a grant_app_read()
-- registration or a privileges.sql edit. The UPDATE below runs as the
-- migration owner, not as afldb_auth, so the table's append-only grant
-- shape is not weakened in order to perform it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Repair
-- ---------------------------------------------------------------------
-- Tighter than 048's repair, deliberately. 048 unwrapped every jsonb
-- string scalar it found, which was safe there only because those three
-- columns can hold nothing but an object or an array. This column is the
-- audit trail: unwrapping a string that is NOT a JSON object would either
-- fail the whole migration on a malformed value or, worse, silently
-- reinterpret a legitimate scalar as structure it never had.
--
-- So both conditions must hold. `jsonb_typeof(detail) = 'string'` selects
-- only the double-encoded shape, leaving NULLs and already-correct
-- objects untouched, so no row is rewritten that does not need it.
-- `IS JSON OBJECT` (PostgreSQL 16) then proves the decoded text parses as
-- a JSON OBJECT before anything is cast, so an unparseable or genuinely
-- scalar value is left alone for step 2 to report rather than being
-- mangled here. `detail #>> '{}'` extracts the scalar as its raw text,
-- and casting that text back to jsonb parses it as the object it was
-- always meant to be.
--
-- Self-limiting: once a value is an object, jsonb_typeof stops returning
-- 'string' and a re-run matches nothing.
UPDATE auth_audit_log
   SET detail = (detail #>> '{}')::jsonb
 WHERE jsonb_typeof(detail) = 'string'
   AND (detail #>> '{}') IS JSON OBJECT;

-- ---------------------------------------------------------------------
-- 2. Refuse to guess
-- ---------------------------------------------------------------------
-- Anything still not an object cannot be repaired by rule, and the
-- constraint in step 3 would reject it. Failing here rather than there
-- names the rows: the CHECK's own violation message reports one row and
-- no id, which is not enough to decide what a surprising audit payload
-- ought to become. Migrations run inside a transaction (tools/db/
-- migrate.ts), so this rolls the repair back with it and leaves the
-- database on 081.
--
-- Expected to fire never. Every writer of this column has always been
-- insertAuditRow(), whose detail parameter is typed
-- `Record<string, unknown> | null`, so an object or NULL is the only
-- shape that has ever been offered to it.
DO $$
DECLARE
  offenders bigint;
  sample    text;
BEGIN
  -- The count is of ALL offending rows; the sample is capped, so a large
  -- number of surprises is reported honestly rather than as "20".
  SELECT count(*) INTO offenders
    FROM auth_audit_log
   WHERE detail IS NOT NULL
     AND jsonb_typeof(detail) <> 'object';

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO sample
    FROM (
      SELECT id
        FROM auth_audit_log
       WHERE detail IS NOT NULL
         AND jsonb_typeof(detail) <> 'object'
       ORDER BY id
       LIMIT 20
    ) AS bad;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      'auth_audit_log.detail holds % row(s) that are neither NULL nor a JSON object and '
      'could not be repaired by rule (first ids: %). AFLDB-ISSUE-121: inspect them with '
      'SELECT id, jsonb_typeof(detail), detail FROM auth_audit_log WHERE detail IS NOT '
      'NULL AND jsonb_typeof(detail) <> ''object'', and decide each case explicitly. '
      'Nothing has been changed.',
      offenders, sample;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3. Guard the repair at the database
-- ---------------------------------------------------------------------
-- The same guard 048 added to nl_search_log, for the same reason: a
-- future regression in the write path should be caught by the database
-- rather than by an administrator wondering why every
-- `detail->>'deletedLogRows'` is NULL. A scalar is never a valid detail
-- payload -- the column records the named fields of an administrative
-- event -- while NULL stays valid, because the trail also records events
-- that carry no payload at all (admin.login, admin.logout).
--
-- Wrapped in an existence check so re-running the file is not an error.
-- The runner already refuses to re-apply an entry recorded in
-- afldb_meta.schema_migrations, but a hand-run against a database that
-- got this far and stopped should not require dropping the constraint
-- first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'auth_audit_log_detail_is_object_ck'
       AND conrelid = 'public.auth_audit_log'::regclass
  ) THEN
    ALTER TABLE auth_audit_log
      ADD CONSTRAINT auth_audit_log_detail_is_object_ck
      CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object');
  END IF;
END
$$;
