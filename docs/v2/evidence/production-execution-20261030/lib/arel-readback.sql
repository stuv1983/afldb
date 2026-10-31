-- AFLDB V2 release: A-REL read-back (D-V2-PROD-EXEC-1 package, Stage 9 gate). Read only, SELECT only.
-- Run identically on the rehearsal clones (as afldb_owner) and on afldb_prod (as afldb_backup):
--   psql -X -q -At -v ON_ERROR_STOP=1 -f arel-readback.sql
-- Exactly 12 lines, each "<check>|ok" or "<check>|FAIL|<observed>". Any FAIL, or a count other than 12, stops.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
WITH t(name) AS (VALUES ('award_proposals'), ('award_proposal_decisions'), ('derived_award_results'),
                        ('brownlow_eligibility_decisions'), ('derived_award_projections'),
                        ('brownlow_correction_receipts')),
dacl AS (
  SELECT string_agg(a::text, ',' ORDER BY a::text) AS acl
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
   CROSS JOIN LATERAL unnest(d.defaclacl) a
   WHERE n.nspname = 'staging' AND d.defaclobjtype = 'r' AND pg_get_userbyid(d.defaclrole) = 'afldb_owner'
),
checks(k, ok, seen) AS (
  SELECT 'ledger-rows-117', count(*) = 117, count(*)::text FROM afldb_meta.schema_migrations
  UNION ALL SELECT 'ledger-last-117', max(name COLLATE "C") = '117_brownlow_provider_eligibility_unknown.sql', max(name COLLATE "C")
    FROM afldb_meta.schema_migrations
  UNION ALL SELECT 'table-' || t.name, to_regclass('public.' || t.name) IS NOT NULL, coalesce(to_regclass('public.' || t.name)::text, 'absent') FROM t
  UNION ALL SELECT 'index-115', to_regclass('public.ix_afl_api_identity_adjudications_supersedes_id') IS NOT NULL, 'checked'
  UNION ALL SELECT 'eligible-nullable-117', NOT a.attnotnull, a.attnotnull::text
    FROM pg_attribute a WHERE a.attrelid = 'staging.afl_api_brownlow_vote'::regclass AND a.attname = 'eligible'
  UNION ALL SELECT 'trigger-116-enabled', g.tgenabled = 'O', g.tgenabled::text
    FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.brownlow_correction_receipts') AND g.tgname = 'brownlow_receipt_immutable'
  UNION ALL SELECT 'staging-default-acl', coalesce(acl, '') = 'afldb_app=r/afldb_owner,afldb_import=arwdD/afldb_owner', coalesce(acl, 'none') FROM dacl
)
SELECT CASE WHEN ok THEN k || '|ok' ELSE k || '|FAIL|' || seen END FROM checks ORDER BY k COLLATE "C";
ROLLBACK;
