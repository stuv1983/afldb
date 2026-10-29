\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
\echo I316_TRANSACTION_BEGUN
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10min';
SET LOCAL idle_in_transaction_session_timeout='2min';
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
\ir locks.sql
\echo I316_PROTECTED_LOCKS_ACQUIRED
\ir identity.sql
\ir principal.sql
\ir lock-assert.sql
SELECT id FROM public.data_edits WHERE id=94 FOR UPDATE;
SELECT id FROM public.data_overrides WHERE id=93 FOR SHARE;
SELECT id FROM public.auth_users WHERE id=1 FOR SHARE;
\ir migration-guard.sql
\ir checks.sql
\ir canonical-gates.sql
\ir snapshot.sql
DO $fresh$
BEGIN
 IF current_setting('afldb.i316.snapshot')::jsonb IS DISTINCT FROM current_setting('afldb.i316.before')::jsonb
 THEN RAISE EXCEPTION 'I316 state drift after read-only preflight'; END IF;
END $fresh$;
SELECT 'I316_LOCKED_OPTIONAL_SCHEMA=' || (current_setting('afldb.i316.snapshot')::jsonb->'optional_schema')::text;
\echo I316_POST_LOCK_GUARDS_PASSED
\echo I316_BEFORE_STATE_CAPTURED
\ir repair-body.sql
\echo I316_METADATA_WRITES_COMPLETED
\ir canonical-gates.sql
\ir snapshot.sql
\ir assert-post.sql
\echo I316_IN_TRANSACTION_ASSERTIONS_PASSED
SELECT 'I316_PRECOMMIT=' || current_setting('afldb.i316.receipt');
COMMIT;
\echo I316_COMMIT_ACKNOWLEDGED
