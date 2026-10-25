\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
\ir identity.sql
\ir checks.sql
\ir canonical-gates.sql
\ir snapshot.sql
SELECT set_config('afldb.i316.before',current_setting('afldb.i316.snapshot'),false) AS retained_preflight \gset
SELECT 'I316_PREFLIGHT=' || current_setting('afldb.i316.before');
SELECT to_regclass('public.brownlow_eligibility_decisions') IS NOT NULL AS i316_optional_0 \gset
SELECT to_regclass('public.brownlow_correction_receipts') IS NOT NULL AS i316_optional_1 \gset
COMMIT;
