\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
\ir identity.sql
\ir canonical-gates.sql
\ir snapshot.sql
\ir assert-post.sql
SELECT 'I316_POSTCHECK=' || jsonb_build_object('status','PASS','receipt',current_setting('afldb.i316.receipt')::jsonb,
 'snapshot',current_setting('afldb.i316.snapshot')::jsonb)::text;
COMMIT;
