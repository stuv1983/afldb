-- AFLDB V2 release: read-only permission-surface read-back (D-V2-PROD-EXEC-1 package, 2026-10-30).
--
-- PURPOSE. Evidence for the privileges 43/43 requirement WITHOUT running any integration test on
-- production. tests/integration/privileges.test.ts is catalogue-only, but its guard (rightly)
-- refuses any database that is not *_test, and that guard is not bypassed. Instead this file
-- extracts every catalogue input those 43 assertions read, plus the effective privileges they
-- evaluate, and is run IDENTICALLY on two targets:
--   (1) the isolated *_test clone of the frozen window dump after the exact A-REL sequence, on
--       which the unmodified suite must pass 43/43 (isolated test evidence); and
--   (2) afldb_prod after A-REL, as afldb_backup (production read-back; no test code, no write).
-- The two outputs are compared with docs/v2/evidence/production-execution-20261030/snapshot-compare.mjs
-- (mode `permissions`). The comparison never claims the suite ran on production.
--
-- READ ONLY. One READ ONLY transaction, rolled back. SELECT only: no DDL, DML, temp object,
-- sequence call or side-effecting function. Database name, OIDs, timestamps and applied_at are
-- never compared (they legitimately differ between production and a restored clone).
--
-- RUN: psql -X -q -v ON_ERROR_STOP=1 -f permission-readback.sql > <target>.permissions.txt
--      (connection from the libpq environment only, never a DSN or password in argv).
--
-- OUTPUT: one fact per line, "<section>|<fields>", the whole output sorted COLLATE "C".
--   I|  identity, informational, never compared
--   S|  database-local stored facts (owners, ACLs, column ACLs, default ACLs, routine security
--       attributes and bodies, registries, ledger names/checksums, triggers, sequence
--       dependencies, ordered column lists)  -> must be identical
--   E|  effective privileges of afldb_app, afldb_auth, afldb_import (granted only) -> must be identical
--   C|  cluster-level role attributes, memberships, database privileges -> recorded, differences listed
--   A|  the suite's two role-level assertions on THIS cluster's values -> every line must end "|ok"
--
-- Scope: every schema except pg_catalog, information_schema, pg_toast and pg_* ; objects that are
-- members of an extension (pg_trgm, unaccent) are excluded, because their owner is whoever
-- installed the extension on that cluster and the suite asserts nothing about them.

\set QUIET 1
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

WITH
nsp AS (
  SELECT n.oid, n.nspname, n.nspowner, n.nspacl
    FROM pg_namespace n
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND n.nspname !~ '^pg_'
),
ext_member AS (
  SELECT d.classid, d.objid FROM pg_depend d WHERE d.deptype = 'e'
),
rel AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl
    FROM pg_class c JOIN nsp n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     AND NOT EXISTS (SELECT 1 FROM ext_member e
                      WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid)
),
fn AS (
  SELECT p.oid, n.nspname, p.proname, p.prokind, p.proowner, p.prosecdef, p.proconfig,
         p.provolatile, p.pronargs,
         p.prosrc, p.proacl, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN nsp n ON n.oid = p.pronamespace
   WHERE NOT EXISTS (SELECT 1 FROM ext_member e
                      WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid)
),
tested(role) AS (VALUES ('afldb_app'), ('afldb_auth'), ('afldb_import')),
tested_present AS (
  SELECT t.role FROM tested t WHERE EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = t.role)
),
facts(k) AS (
  -- I: identity (informational)
  SELECT format('I|database|%s', current_database())
  UNION ALL SELECT format('I|server_version_num|%s', current_setting('server_version_num'))
  UNION ALL SELECT format('I|session_user|%s', session_user)
  UNION ALL SELECT format('I|transaction_read_only|%s', current_setting('transaction_read_only'))

  -- S1: schemas, owner and ACL
  UNION ALL
  SELECT format('S|schema|%s|owner=%s|%s', n.nspname, pg_get_userbyid(n.nspowner),
           CASE WHEN n.nspacl IS NULL THEN 'acl=default'
                WHEN cardinality(n.nspacl) = 0 THEN 'acl=empty'
                ELSE format('grantee=%s|grantor=%s|priv=%s|grantable=%s',
                       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                       pg_get_userbyid(x.grantor), x.privilege_type, x.is_grantable) END)
    FROM nsp n LEFT JOIN LATERAL aclexplode(n.nspacl) x ON true

  -- S2: relations and sequences, kind, owner and ACL
  UNION ALL
  SELECT format('S|relation|%s.%s|kind=%s|owner=%s|%s', r.nspname, r.relname, r.relkind,
           pg_get_userbyid(r.relowner),
           CASE WHEN r.relacl IS NULL THEN 'acl=default'
                WHEN cardinality(r.relacl) = 0 THEN 'acl=empty'
                ELSE format('grantee=%s|grantor=%s|priv=%s|grantable=%s',
                       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                       pg_get_userbyid(x.grantor), x.privilege_type, x.is_grantable) END)
    FROM rel r LEFT JOIN LATERAL aclexplode(r.relacl) x ON true

  -- S3: column-level ACLs (only columns that carry one)
  UNION ALL
  SELECT format('S|column-acl|%s.%s.%s|grantee=%s|grantor=%s|priv=%s|grantable=%s',
           r.nspname, r.relname, a.attname,
           CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
           pg_get_userbyid(x.grantor), x.privilege_type, x.is_grantable)
    FROM rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                       AND a.attacl IS NOT NULL
    CROSS JOIN LATERAL aclexplode(a.attacl) x

  -- S4: routines: owner, kind, SECURITY DEFINER, pinned settings, body digest, then ACL
  UNION ALL
  SELECT format('S|routine|%s.%s(%s)|kind=%s|owner=%s|secdef=%s|vol=%s|nargs=%s|config=%s|src_md5=%s',
           f.nspname, f.proname, f.args, f.prokind, pg_get_userbyid(f.proowner), f.prosecdef,
           f.provolatile, f.pronargs,
           coalesce(array_to_string(f.proconfig, ','), ''), md5(coalesce(f.prosrc, '')))
    FROM fn f
  UNION ALL
  SELECT format('S|routine-acl|%s.%s(%s)|%s', f.nspname, f.proname, f.args,
           CASE WHEN f.proacl IS NULL THEN 'acl=default'
                WHEN cardinality(f.proacl) = 0 THEN 'acl=empty'
                ELSE format('grantee=%s|grantor=%s|priv=%s|grantable=%s',
                       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                       pg_get_userbyid(x.grantor), x.privilege_type, x.is_grantable) END)
    FROM fn f LEFT JOIN LATERAL aclexplode(f.proacl) x ON true

  -- S5: default ACLs (includes the two staging declarations A-REL executes)
  UNION ALL
  SELECT format('S|default-acl|for=%s|schema=%s|objtype=%s|grantee=%s|grantor=%s|priv=%s|grantable=%s',
           pg_get_userbyid(d.defaclrole),
           CASE WHEN d.defaclnamespace = 0 THEN '*'
                ELSE (SELECT nspname FROM pg_namespace WHERE oid = d.defaclnamespace) END,
           d.defaclobjtype,
           CASE WHEN x.grantee IS NULL THEN 'acl=empty' WHEN x.grantee = 0 THEN 'PUBLIC'
                ELSE pg_get_userbyid(x.grantee) END,
           coalesce(pg_get_userbyid(x.grantor), 'acl=empty'), coalesce(x.privilege_type, 'acl=empty'),
           coalesce(x.is_grantable::text, 'acl=empty'))
    FROM pg_default_acl d LEFT JOIN LATERAL aclexplode(d.defaclacl) x ON true

  -- S6: the fail-closed registries the suite reads (names only; added_at differs by design)
  UNION ALL SELECT format('S|registry|app_readable|%s', t.name) FROM afldb_meta.app_readable_tables t
  UNION ALL SELECT format('S|registry|import_writable|%s', t.name) FROM afldb_meta.import_writable_tables t

  -- S7: migration ledger (name and checksum; applied_at and duration differ by design)
  UNION ALL SELECT format('S|ledger|%s|%s', m.name, m.checksum) FROM afldb_meta.schema_migrations m

  -- S8: user triggers and their enabled state (the 116 append-only trigger among them)
  UNION ALL
  SELECT format('S|trigger|%s.%s|%s|enabled=%s|function=%s.%s', r.nspname, r.relname, tg.tgname,
           tg.tgenabled, fnn.nspname, fp.proname)
    FROM rel r
    JOIN pg_trigger tg ON tg.tgrelid = r.oid AND NOT tg.tgisinternal
    JOIN pg_proc fp ON fp.oid = tg.tgfoid
    JOIN pg_namespace fnn ON fnn.oid = fp.pronamespace

  -- S9: sequence-to-table dependencies, the catalogue input of afldb_meta.owned_sequences()
  --     (migration 045), which six of the suite's assertions call
  UNION ALL
  SELECT format('S|sequence-dep|%s.%s|table=%s.%s|deptype=%s', r.nspname, r.relname,
           tn.nspname, t.relname, d.deptype)
    FROM rel r
    JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_class'::regclass
                    AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
   WHERE r.relkind = 'S'

  -- S10: ordered column lists. The suite enumerates pg_attribute in attnum order
  --      (data_overrides, award_proposals) and reads information_schema.columns
  --      (data_issues.issue_key). pos is the rank among live columns, NOT attnum: a restore
  --      renumbers past dropped columns, so attnum legitimately differs from production.
  UNION ALL
  SELECT format('S|column|%s.%s|pos=%s|%s|%s', r.nspname, r.relname,
           row_number() OVER (PARTITION BY r.oid ORDER BY a.attnum), a.attname,
           format_type(a.atttypid, a.atttypmod))
    FROM rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE r.relkind <> 'S'

  -- E1: table-level privileges of the tested roles (granted only)
  UNION ALL
  SELECT format('E|table|%s|%s.%s|%s', t.role, r.nspname, r.relname, p.priv)
    FROM tested_present t CROSS JOIN rel r
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) p(priv)
   WHERE r.relkind <> 'S' AND has_table_privilege(t.role, r.oid, p.priv)

  -- E2: any-column privileges (what has_any_column_privilege sees in the suite)
  UNION ALL
  SELECT format('E|any-column|%s|%s.%s|%s', t.role, r.nspname, r.relname, p.priv)
    FROM tested_present t CROSS JOIN rel r
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
   WHERE r.relkind <> 'S' AND has_any_column_privilege(t.role, r.oid, p.priv)

  -- E3: column privileges on every column of a relation that carries any column ACL
  UNION ALL
  SELECT format('E|column|%s|%s.%s.%s|%s', t.role, r.nspname, r.relname, a.attname, p.priv)
    FROM tested_present t CROSS JOIN rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
   WHERE EXISTS (SELECT 1 FROM pg_attribute a2
                  WHERE a2.attrelid = r.oid AND a2.attnum > 0 AND a2.attacl IS NOT NULL)
     AND has_column_privilege(t.role, r.oid, a.attnum, p.priv)

  -- E4: sequence privileges
  UNION ALL
  SELECT format('E|sequence|%s|%s.%s|%s', t.role, r.nspname, r.relname, p.priv)
    FROM tested_present t CROSS JOIN rel r
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
   WHERE r.relkind = 'S' AND has_sequence_privilege(t.role, r.oid, p.priv)

  -- E5: schema privileges
  UNION ALL
  SELECT format('E|schema|%s|%s|%s', t.role, n.nspname, p.priv)
    FROM tested_present t CROSS JOIN nsp n
    CROSS JOIN (VALUES ('USAGE'), ('CREATE')) p(priv)
   WHERE has_schema_privilege(t.role, n.oid, p.priv)

  -- E6: routine EXECUTE
  UNION ALL
  SELECT format('E|routine|%s|%s.%s(%s)|EXECUTE', t.role, f.nspname, f.proname, f.args)
    FROM tested_present t CROSS JOIN fn f
   WHERE has_function_privilege(t.role, f.oid, 'EXECUTE')

  -- C1: role attributes of every afldb_* role (cluster-level), except afldb_v2_super: the isolated
  -- cluster's own bootstrap superuser (tools/v2/isolated-pg.ts), which no production cluster has
  UNION ALL
  SELECT format('C|role|%s|super=%s|inherit=%s|createrole=%s|createdb=%s|login=%s|replication=%s|bypassrls=%s',
           r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin,
           r.rolreplication, r.rolbypassrls)
    FROM pg_roles r WHERE r.rolname LIKE 'afldb\_%' AND r.rolname <> 'afldb_v2_super'

  -- C2: memberships touching an afldb_* role (PostgreSQL 16 options included), same exclusion
  UNION ALL
  SELECT format('C|membership|member=%s|of=%s|admin=%s|inherit=%s|set=%s',
           pg_get_userbyid(m.member), pg_get_userbyid(m.roleid), m.admin_option,
           m.inherit_option, m.set_option)
    FROM pg_auth_members m
   WHERE (pg_get_userbyid(m.member) LIKE 'afldb\_%' OR pg_get_userbyid(m.roleid) LIKE 'afldb\_%')
     AND 'afldb_v2_super' NOT IN (pg_get_userbyid(m.member), pg_get_userbyid(m.roleid))

  -- C3: database-level privileges of the tested roles on the current database
  UNION ALL
  SELECT format('C|database|%s|%s|%s', t.role, p.priv,
           has_database_privilege(t.role, current_database(), p.priv))
    FROM tested_present t CROSS JOIN (VALUES ('CONNECT'), ('CREATE'), ('TEMPORARY')) p(priv)

  -- A0: the three tested roles exist
  UNION ALL
  SELECT format('A|role-exists|%s|%s', t.role,
           CASE WHEN EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = t.role) THEN 'ok' ELSE 'FAIL' END)
    FROM tested t

  -- A1: privileges.test.ts 'is an unprivileged login role' on this cluster's values
  UNION ALL
  SELECT format('A|afldb_app-unprivileged|super=%s|bypassrls=%s|createdb=%s|createrole=%s|%s',
           r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
           CASE WHEN NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole)
                THEN 'ok' ELSE 'FAIL' END)
    FROM pg_roles r WHERE r.rolname = 'afldb_app'

  -- A2: privileges.test.ts 'is not a member of a writing role' on this cluster's values
  UNION ALL
  SELECT format('A|afldb_app-not-member-of|%s|%s', w.rolname,
           CASE WHEN pg_has_role('afldb_app', w.oid, 'USAGE') THEN 'FAIL' ELSE 'ok' END)
    FROM pg_roles w
   WHERE w.rolname IN ('afldb_owner', 'afldb_import', 'afldb_auth', 'postgres')
     AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'afldb_app')

  -- A3: privileges.test.ts 'may be executed by afldb_auth and by no other application role'
  --     asserts afldb_backup's EXECUTE only where the role exists. afldb_backup is not one of
  --     the E| roles, so its answer is evaluated here on this cluster's own values.
  UNION ALL
  SELECT format('A|afldb_backup-cannot-execute-telemetry-clear|present=%s|%s',
           EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_backup'),
           CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_backup') THEN 'ok'
                WHEN to_regprocedure('public.nl_search_telemetry_clear()') IS NULL THEN 'FAIL'
                WHEN has_function_privilege('afldb_backup',
                       to_regprocedure('public.nl_search_telemetry_clear()'), 'EXECUTE') THEN 'FAIL'
                ELSE 'ok' END)
)
SELECT k FROM facts ORDER BY k COLLATE "C";

ROLLBACK;
