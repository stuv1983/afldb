-- Production-only identity. Never replaced by the disposable fixture.
DO $identity$
BEGIN
 IF current_database() <> 'afldb_prod'
 OR current_user <> 'afldb_owner' OR session_user <> 'afldb_owner'
 OR (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) <> 66668
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7674454702926115004'
 THEN RAISE EXCEPTION 'I316 production identity refused'; END IF;
END $identity$;
SELECT 'I316_IDENTITY=' || jsonb_build_object('database',current_database(),'user',current_user,
 'oid',(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),
 'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'read_only',current_setting('transaction_read_only'))::text;
