-- verifier-db.sql (R6 r7, MED-2): PROSPECTIVE, owner-applied on production as the database superuser or owner (e.g.
-- `sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d afldb_prod -f verifier-db.sql`). Never applied by Claude to production.
-- The least privilege A-2 section 5's one read-only transaction needs (the verifier connects by peer authentication only:
-- pg-auth-lines.txt maps OS user afldb-verify to role afldb_verify; arm cannot authenticate as that OS user):
--   SELECT count(*), max(name) FROM afldb_meta.schema_migrations                       -> USAGE on afldb_meta, SELECT (name)
--   pg_database, shobj_description(), pg_stat_database for afldb_restore_test          -> catalog reads every role has
-- No other table, no write, no function, no role membership; read-only by default; at most 2 connections.
BEGIN;
CREATE ROLE afldb_verify LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE afldb_verify SET default_transaction_read_only = on;
ALTER ROLE afldb_verify SET statement_timeout = '20s';
GRANT CONNECT ON DATABASE afldb_prod TO afldb_verify;
GRANT USAGE ON SCHEMA afldb_meta TO afldb_verify;
GRANT SELECT (name) ON afldb_meta.schema_migrations TO afldb_verify;
COMMIT;
