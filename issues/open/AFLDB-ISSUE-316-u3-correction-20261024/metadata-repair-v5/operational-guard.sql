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
-- v5 principal visibility, required by the afldb_owner transport. A non-superuser without
-- pg_read_all_stats sees state/query only for its own role's sessions, so the text checks above
-- cover afldb_owner sessions only. pg_locks and pg_prepared_xacts above remain fully visible.
-- Redacted sessions are tolerated only while update_process_title=on: the condition under which the
-- no-sudo host gate's PostgreSQL process-title scan, run in the same remote session immediately
-- before psql, is meaningful. Otherwise do not execute.
DO $visibility$
BEGIN
 IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
 AND NOT pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE')
 AND current_setting('update_process_title') <> 'on'
 THEN RAISE EXCEPTION 'I316 operational visibility inadequate: do not execute'; END IF;
END $visibility$;
SELECT 'I316_OPERATIONAL_VISIBILITY=' || jsonb_build_object(
 'superuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
 'read_all_stats',pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE'),
 'update_process_title',current_setting('update_process_title'),
 'other_role_client_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database()
   AND pid<>pg_catalog.pg_backend_pid() AND COALESCE(backend_type,'client backend')='client backend' AND usename IS DISTINCT FROM current_user),
 'state_redacted_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database()
   AND pid<>pg_catalog.pg_backend_pid() AND COALESCE(backend_type,'client backend')='client backend' AND state IS NULL))::text;
SELECT 'I316_OPERATIONAL_DATABASE_GATE_PASS';
