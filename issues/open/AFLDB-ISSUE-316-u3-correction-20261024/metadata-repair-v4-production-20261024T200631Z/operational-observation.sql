\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL timezone='UTC';
-- Production-only identity. Never replaced by the disposable fixture.
DO $identity$
BEGIN
 IF current_database() <> 'afldb_prod'
 OR current_user <> 'postgres' OR session_user <> 'postgres'
 OR (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) <> 66668
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7674454702926115004'
 THEN RAISE EXCEPTION 'I316 production identity refused'; END IF;
END $identity$;
SELECT 'I316_IDENTITY=' || jsonb_build_object('database',current_database(),'user',current_user,
 'oid',(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),
 'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'read_only',current_setting('transaction_read_only'))::text;
-- Bounded read-only stop/go observation, not exclusion of future DDL.
DO $operational$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
   WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'
   AND (state IN ('idle in transaction','idle in transaction (aborted)')
     OR (state='active' AND query ~* '\m(create|alter|drop|truncate|reindex|cluster|vacuum|grant|revoke|comment|security|refresh)\M')))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_locks
   WHERE database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
     AND pid IS DISTINCT FROM pg_backend_pid() AND locktype='relation'
     AND mode IN ('AccessExclusiveLock','ShareRowExclusiveLock','ShareUpdateExclusiveLock'))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts WHERE database=current_database())
 THEN RAISE EXCEPTION 'I316 active/known DDL or unresolved schema transaction: do not execute'; END IF;
END $operational$;
SELECT 'I316_OPERATIONAL_DATABASE_GATE_PASS';

SELECT 'I316_SEPARATE_SESSIONS=' || jsonb_build_object(
 'database',current_database(),'read_only',current_setting('transaction_read_only'),
 'sessions',COALESCE((SELECT jsonb_agg(jsonb_build_object('pid',pid,'state',state,'ddl',state='active' AND query ~* '\m(create|alter|drop|truncate|reindex|cluster|vacuum|grant|revoke|comment|security|refresh)\M','migration_application',application_name ~* 'migrat|deploy|rebuild|schema|rollover|transition|apply')) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'),'[]'::jsonb),
 'unsafe_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state IN ('idle in transaction','idle in transaction (aborted)') OR (state='active' AND query ~* '\m(create|alter|drop|truncate|reindex|cluster|vacuum|grant|revoke|comment|security|refresh)\M') OR application_name ~* 'migrat|deploy|rebuild|schema|rollover|transition|apply')),
 'unsafe_relation_locks',(SELECT count(*) FROM pg_catalog.pg_locks WHERE database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND pid IS DISTINCT FROM pg_backend_pid() AND locktype='relation' AND mode IN ('AccessExclusiveLock','ShareRowExclusiveLock','ShareUpdateExclusiveLock')),
 'prepared_transactions',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()))::text;
ROLLBACK;
\echo I316_SEPARATE_DATABASE_OBSERVATION_COMPLETE
