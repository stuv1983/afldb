\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
\ir identity.sql
-- SHARE ROW EXCLUSIVE serialises audit writers; SHARE locks protect every fingerprinted
-- canonical/derived/history class until commit. No DDL or privilege mutation.
\ir locks.sql
SELECT id FROM public.data_edits WHERE id=94 FOR UPDATE;
SELECT id FROM public.data_overrides WHERE id=93 FOR SHARE;
SELECT id FROM public.auth_users WHERE id=1 FOR SHARE;
\ir checks.sql
\ir canonical-gates.sql
\ir snapshot.sql
DO $fresh$
BEGIN
 IF current_setting('afldb.i316.snapshot')::jsonb IS DISTINCT FROM current_setting('afldb.i316.before')::jsonb
 THEN RAISE EXCEPTION 'I316 state drift after read-only preflight'; END IF;
END $fresh$;
\ir repair-body.sql
\ir canonical-gates.sql
\ir snapshot.sql
\ir assert-post.sql
SELECT 'I316_PRECOMMIT=' || current_setting('afldb.i316.receipt');
COMMIT;
\echo I316_COMMIT_ACKNOWLEDGED
