{
# AFLDB-ISSUE-316 metadata-repair-v5 principal discovery (owner instruction 2026-10-25).
# READ ONLY. Runs as arm, no sudo, writes nothing on the host. Streamed to `bash -s`.
# Never prints a password, secret or full DSN: only role/host/port/database names and
# whether a password component is present. Catalog privilege functions/ACLs only; no write.
set -u -o pipefail
export LC_ALL=C
stop() { printf 'I316_DISC_STOP %s\n' "$1"; exit 1; }

host=$(/usr/bin/hostname) || stop host_producer_failed
user=$(/usr/bin/id -un) || stop user_producer_failed
[ "$host" = afldb-prod ] || stop host_mismatch
[ "$user" = arm ] || stop user_mismatch
printf 'I316_DISC_HOST=%s USER=%s\n' "$host" "$user"

R=/home/arm/projects/afldb
ENVF="$R/.env"
[ -r "$ENVF" ] || stop env_file_unreadable
printf 'I316_DISC_ENV_FILE %s\n' "$(/usr/bin/stat -c 'mode=%a owner=%U group=%G' "$ENVF")"
if [ -e /home/arm/.pgpass ]; then
  printf 'I316_DISC_PGPASS present %s\n' "$(/usr/bin/stat -c 'mode=%a owner=%U' /home/arm/.pgpass)"
else
  printf 'I316_DISC_PGPASS absent\n'
fi

RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
# Fixed, named DSN keys only; never a listing of the file.
for key in DATABASE_URL AFLDB_AUTH_DATABASE_URL AFLDB_IMPORT_DATABASE_URL AFLDB_OWNER_DATABASE_URL AFLDB_PROD_DATABASE_URL AFLDB_BACKUP_DATABASE_URL; do
  n=$(/usr/bin/grep -c "^${key}=" "$ENVF") || n=0
  v=$(/usr/bin/sed -n "s/^${key}=//p" "$ENVF" | /usr/bin/tail -1 | /usr/bin/sed 's/^"\(.*\)"$/\1/')
  if [ -z "$v" ]; then printf 'I316_DISC_DSN key=%s lines=%s present=no\n' "$key" "$n"; continue; fi
  if ! printf '%s' "$v" | /usr/bin/grep -Eq "$RE"; then printf 'I316_DISC_DSN key=%s lines=%s present=yes parse=unrecognised\n' "$key" "$n"; unset v; continue; fi
  u=$(printf '%s' "$v" | /usr/bin/sed -E "s#$RE#\2#")
  h=$(printf '%s' "$v" | /usr/bin/sed -E "s#$RE#\5#")
  p=$(printf '%s' "$v" | /usr/bin/sed -E "s#$RE#\7#")
  d=$(printf '%s' "$v" | /usr/bin/sed -E "s#$RE#\8#")
  pw=$(printf '%s' "$v" | /usr/bin/sed -E "s#$RE#\3#")
  [ -n "$pw" ] && pwp=present || pwp=absent
  q=no; case "$v" in *\?*) q=yes;; esac
  unset v pw
  printf 'I316_DISC_DSN key=%s lines=%s present=yes user=%s host=%s port=%s database=%s password_component=%s query_params=%s\n' "$key" "$n" "$u" "$h" "${p:-default}" "$d" "$pwp" "$q"
done

# Database catalog observation through the existing read-only afldb_backup credential.
DSN=$(/usr/bin/sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | /usr/bin/tail -1 | /usr/bin/sed 's/^"\(.*\)"$/\1/') || stop dsn_read_failed
[ -n "$DSN" ] || stop dsn_empty
PGUSER=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\2#")
PGHOST=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\5#")
PGPORT=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\7#"); [ -n "$PGPORT" ] || PGPORT=5432
PGDATABASE=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\8#")
PWENC=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\4#")
PGPASSWORD=$(printf '%b' "${PWENC//%/\\x}"); unset PWENC DSN
[ "$PGDATABASE" = afldb_prod ] && [ "$PGUSER" = afldb_backup ] || { unset PGPASSWORD; stop credential_not_afldb_backup_at_afldb_prod; }
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=60000'
export PGAPPNAME=afldb-i316-v5-principal-discovery PGCONNECT_TIMEOUT=10

db_out=$(/usr/bin/psql -X -q -At -P pager=off -v ON_ERROR_STOP=1 -f - <<'I316_DISC_SQL'
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog;
DO $identity$
BEGIN
 IF current_database() <> 'afldb_prod' OR current_user <> 'afldb_backup' OR session_user <> 'afldb_backup'
 OR (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) <> 66668
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7674454702926115004'
 OR current_setting('transaction_read_only') <> 'on'
 THEN RAISE EXCEPTION 'I316 production identity refused'; END IF;
END $identity$;
SELECT 'I316_DISC_IDENTITY=' || jsonb_build_object('database',current_database(),'user',current_user,
  'oid',(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())::text,
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'read_only',current_setting('transaction_read_only'),'server_version_num',current_setting('server_version_num'),
  'observed_utc',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text;

-- Every non-builtin role: attributes and direct memberships. No password material.
SELECT 'I316_DISC_ROLE=' || jsonb_build_object('role',r.rolname,'super',r.rolsuper,'inherit',r.rolinherit,
  'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,'login',r.rolcanlogin,'replication',r.rolreplication,
  'bypassrls',r.rolbypassrls,'connlimit',r.rolconnlimit,'valid_until_set',r.rolvaliduntil IS NOT NULL,
  'member_of',(SELECT COALESCE(jsonb_agg(g.rolname ORDER BY g.rolname),'[]'::jsonb) FROM pg_catalog.pg_auth_members m
     JOIN pg_catalog.pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid),
  'members',(SELECT COALESCE(jsonb_agg(u.rolname ORDER BY u.rolname),'[]'::jsonb) FROM pg_catalog.pg_auth_members m
     JOIN pg_catalog.pg_roles u ON u.oid=m.member WHERE m.roleid=r.oid),
  'settings',(SELECT COALESCE(jsonb_agg(jsonb_build_object('database',CASE WHEN s.setdatabase=0 THEN '*' ELSE (SELECT datname FROM pg_catalog.pg_database WHERE oid=s.setdatabase) END,'config',s.setconfig)),'[]'::jsonb)
     FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=r.oid))::text
FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY r.rolname;

SELECT 'I316_DISC_DATABASE=' || jsonb_build_object('database',d.datname,'owner',pg_catalog.pg_get_userbyid(d.datdba),
  'acl',d.datacl::text)::text FROM pg_catalog.pg_database d WHERE d.datname=current_database();
SELECT 'I316_DISC_SCHEMA=' || jsonb_build_object('schema',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',n.nspacl::text)::text
FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','staging','afldb_meta') ORDER BY n.nspname;

-- The audit table, its note column and its id generator.
SELECT 'I316_DISC_DATA_EDITS=' || jsonb_build_object(
  'owner',pg_catalog.pg_get_userbyid(c.relowner),'relkind',c.relkind,'acl',c.relacl::text,
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'note_column_acl',(SELECT attacl::text FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attname='note'),
  'column_acls',(SELECT COALESCE(jsonb_agg(jsonb_build_object('column',attname,'acl',attacl::text) ORDER BY attnum),'[]'::jsonb)
     FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attnum>0 AND attacl IS NOT NULL),
  'id_identity',(SELECT attidentity FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attname='id'),
  'id_sequence',pg_catalog.pg_get_serial_sequence('public.data_edits','id'),
  'id_sequence_owner',(SELECT pg_catalog.pg_get_userbyid(s.relowner) FROM pg_catalog.pg_class s WHERE s.oid=pg_catalog.pg_get_serial_sequence('public.data_edits','id')::regclass),
  'id_sequence_acl',(SELECT s.relacl::text FROM pg_catalog.pg_class s WHERE s.oid=pg_catalog.pg_get_serial_sequence('public.data_edits','id')::regclass),
  'user_triggers',(SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),
  'rules',(SELECT count(*) FROM pg_catalog.pg_rewrite WHERE ev_class=c.oid),
  'policies',(SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid=c.oid))::text
FROM pg_catalog.pg_class c WHERE c.oid='public.data_edits'::regclass;

-- Exhaustive: every role able to perform each of the two writes, by catalog privilege function.
SELECT 'I316_DISC_WRITE_CAPABLE=' || jsonb_build_object(
  'update_note',(SELECT COALESCE(jsonb_agg(r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM pg_catalog.pg_roles r
     WHERE pg_catalog.has_column_privilege(r.oid,'public.data_edits'::regclass,'note','UPDATE')),
  'insert',(SELECT COALESCE(jsonb_agg(r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM pg_catalog.pg_roles r
     WHERE pg_catalog.has_table_privilege(r.oid,'public.data_edits'::regclass,'INSERT')),
  'both_login_roles',(SELECT COALESCE(jsonb_agg(r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM pg_catalog.pg_roles r
     WHERE r.rolcanlogin AND pg_catalog.has_column_privilege(r.oid,'public.data_edits'::regclass,'note','UPDATE')
       AND pg_catalog.has_table_privilege(r.oid,'public.data_edits'::regclass,'INSERT')))::text;

-- Per candidate login role: the complete inherited v4 capability set (two writes, read set, plain locks,
-- schema usage, identity functions). SHARE / SHARE ROW EXCLUSIVE LOCK in PostgreSQL 16 needs UPDATE,
-- DELETE or TRUNCATE (ownership and superuser imply them).
WITH rels(rel) AS (VALUES ('public.data_edits'),('public.auth_users'),('public.data_overrides'),('public.matches'),
  ('public.player_match_stats'),('public.match_period_scores'),('public.player_match_period_stats'),('public.player_career_stats'),
  ('public.player_season_stats'),('public.player_club_season_stats'),('public.player_clubs'),('public.players'),('public.clubs'),
  ('public.club_seasons'),('public.seasons'),('public.import_batches'),('public.import_rejections'),('public.canonical_applications'),
  ('public.brownlow_season_votes'),('public.brownlow_round_votes'),('public.brownlow_vote_entry_state'),('public.brownlow_season_authority'),
  ('public.auth_audit_log'),('staging.afltables_player_match'),('staging.afltables_match'),('staging.afl_api_lineup'),
  ('staging.afl_api_brownlow_vote'),('afldb_meta.schema_migrations'),('public.brownlow_eligibility_decisions'),('public.brownlow_correction_receipts')),
present AS (SELECT rel, pg_catalog.to_regclass(rel) AS oid FROM rels),
cand AS (SELECT r.oid, r.rolname FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND r.rolname !~ '^pg_')
SELECT 'I316_DISC_CANDIDATE=' || jsonb_build_object('role',cand.rolname,
  'update_note',pg_catalog.has_column_privilege(cand.oid,'public.data_edits'::regclass,'note','UPDATE'),
  'update_other_data_edits_columns',(SELECT COALESCE(jsonb_agg(a.attname ORDER BY a.attnum),'[]'::jsonb) FROM pg_catalog.pg_attribute a
     WHERE a.attrelid='public.data_edits'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'note'
       AND pg_catalog.has_column_privilege(cand.oid,'public.data_edits'::regclass,a.attname,'UPDATE')),
  'insert_data_edits',pg_catalog.has_table_privilege(cand.oid,'public.data_edits'::regclass,'INSERT'),
  'delete_data_edits',pg_catalog.has_table_privilege(cand.oid,'public.data_edits'::regclass,'DELETE'),
  'truncate_data_edits',pg_catalog.has_table_privilege(cand.oid,'public.data_edits'::regclass,'TRUNCATE'),
  'id_sequence_usage',pg_catalog.has_sequence_privilege(cand.oid,pg_catalog.pg_get_serial_sequence('public.data_edits','id'),'USAGE'),
  'schema_usage',jsonb_build_object('public',pg_catalog.has_schema_privilege(cand.oid,'public','USAGE'),
     'staging',pg_catalog.has_schema_privilege(cand.oid,'staging','USAGE'),'afldb_meta',pg_catalog.has_schema_privilege(cand.oid,'afldb_meta','USAGE')),
  'schema_create',jsonb_build_object('public',pg_catalog.has_schema_privilege(cand.oid,'public','CREATE'),
     'staging',pg_catalog.has_schema_privilege(cand.oid,'staging','CREATE'),'afldb_meta',pg_catalog.has_schema_privilege(cand.oid,'afldb_meta','CREATE')),
  'database_connect',pg_catalog.has_database_privilege(cand.oid,current_database(),'CONNECT'),
  'database_create',pg_catalog.has_database_privilege(cand.oid,current_database(),'CREATE'),
  'pg_control_system_execute',pg_catalog.has_function_privilege(cand.oid,'pg_catalog.pg_control_system()','EXECUTE'),
  'relations_present',(SELECT count(*) FROM present WHERE oid IS NOT NULL),
  'select_missing',(SELECT COALESCE(jsonb_agg(rel ORDER BY rel),'[]'::jsonb) FROM present WHERE oid IS NOT NULL
     AND NOT pg_catalog.has_table_privilege(cand.oid,oid,'SELECT')),
  'lock_missing',(SELECT COALESCE(jsonb_agg(rel ORDER BY rel),'[]'::jsonb) FROM present WHERE oid IS NOT NULL
     AND NOT (pg_catalog.has_table_privilege(cand.oid,oid,'UPDATE') OR pg_catalog.has_table_privilege(cand.oid,oid,'DELETE')
              OR pg_catalog.has_table_privilege(cand.oid,oid,'TRUNCATE'))),
  'owns',(SELECT COALESCE(jsonb_agg(rel ORDER BY rel),'[]'::jsonb) FROM present p JOIN pg_catalog.pg_class c ON c.oid=p.oid
     WHERE c.relowner=cand.oid))::text
FROM cand ORDER BY cand.rolname;

-- Relation owners for the protected/lock set (optional relations reported as present/absent).
WITH rels(rel) AS (VALUES ('public.data_edits'),('public.auth_users'),('public.data_overrides'),('public.matches'),
  ('public.player_match_stats'),('public.match_period_scores'),('public.player_match_period_stats'),('public.player_career_stats'),
  ('public.player_season_stats'),('public.player_club_season_stats'),('public.player_clubs'),('public.players'),('public.clubs'),
  ('public.club_seasons'),('public.seasons'),('public.import_batches'),('public.import_rejections'),('public.canonical_applications'),
  ('public.brownlow_season_votes'),('public.brownlow_round_votes'),('public.brownlow_vote_entry_state'),('public.brownlow_season_authority'),
  ('public.auth_audit_log'),('staging.afltables_player_match'),('staging.afltables_match'),('staging.afl_api_lineup'),
  ('staging.afl_api_brownlow_vote'),('afldb_meta.schema_migrations'),('public.brownlow_eligibility_decisions'),('public.brownlow_correction_receipts'))
SELECT 'I316_DISC_RELATION_OWNERS=' || jsonb_object_agg(rel, COALESCE((SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass(rel)),'<absent>'))::text FROM rels;

-- Which roles the running services use now (counts only; no query text).
SELECT 'I316_DISC_SESSIONS=' || COALESCE(jsonb_agg(jsonb_build_object('usename',usename,'application_name',application_name,'state',state,'n',n) ORDER BY usename,application_name,state),'[]'::jsonb)::text
FROM (SELECT usename, application_name, state, count(*) AS n FROM pg_catalog.pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_catalog.pg_backend_pid() AND backend_type='client backend'
      GROUP BY usename, application_name, state) s;

-- Migration ledger state (count and newest names only).
SELECT 'I316_DISC_MIGRATIONS=' || jsonb_build_object('count',(SELECT count(*) FROM afldb_meta.schema_migrations),
  'newest',(SELECT jsonb_agg(name ORDER BY name DESC) FROM (SELECT name FROM afldb_meta.schema_migrations ORDER BY name DESC LIMIT 3) x))::text;
ROLLBACK;
I316_DISC_SQL
)
db_rc=$?
unset PGPASSWORD
printf '%s\n' "$db_out"
printf 'I316_DISC_DB_EXIT %s\n' "$db_rc"
[ "$db_rc" -eq 0 ] || stop database_discovery_failed
printf 'I316_DISC_DECISION=COMPLETE\n'
exit 0
}
