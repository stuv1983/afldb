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
