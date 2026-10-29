\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
\ir identity.sql
\ir canonical-gates.sql
SELECT set_config('afldb.i316.postcommit','true',true) AS postcommit_mode \gset
\ir snapshot.sql
\ir assert-post.sql
SELECT 'I316_POSTCHECK=' || jsonb_build_object('status',CASE WHEN current_setting('afldb.i316.environment_status')='CLEAN' THEN 'PASS' ELSE 'CONCURRENT_SCHEMA_DRIFT' END,'u3_confirmable',current_setting('afldb.i316.environment_status')='CLEAN','receipt',current_setting('afldb.i316.receipt')::jsonb,
 'snapshot',current_setting('afldb.i316.snapshot')::jsonb)::text;
COMMIT;
SELECT current_setting('afldb.i316.environment_status')='CLEAN' AS i316_clean \gset
\if :i316_clean
\echo I316_POSTCOMMIT_VERIFICATION_PASSED
\else
\echo I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL
\endif
