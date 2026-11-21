#!/usr/bin/env bash
# AFLDB-ISSUE-348: READ-ONLY privilege check for i348-postload-check.sh `snap` and the sealed runner's `digest` (run e, 22 Nov 2026).
# PRODUCTION (host afldb-prod), as arm, ONE connection. Uses the SAME credential path as i348-postload-check.sh (envval / RE /
# creds() copied verbatim): AFLDB_BACKUP_DATABASE_URL from the checkout's .env into PG* variables of this process only; the DSN and
# the password are never on argv and never printed; the role must be afldb_backup and the database afldb_prod.
# ONE transaction: BEGIN ... READ ONLY with the session assertions of `snap` (role, database, read-only); the SQL reads ONLY
# pg_catalog (pg_class, pg_attribute, pg_namespace via regnamespace) and calls has_table_privilege / has_column_privilege /
# has_schema_privilege / pg_has_role / current_setting / to_regclass. It names no user relation in a FROM or JOIN, uses no \copy,
# no count over a user table: NO table row is read. ROLLBACK.
# Relations checked = the union of the FROM lists of i348-postload-check.sh (snap) and sealed/draftguru-surface-digest.sql
# (grep, run e): data_edits data_overrides draft_persons draft_picks external_identities import_batches player_link_resolutions
# players sources. `snap` reads whole rows (to_jsonb(t)), so every column needs SELECT.
# What a PASS proves: on the day it runs, afldb_backup holds SELECT on those relations and every column, USAGE on schema public,
# no row-level security applies, and it has no write privilege. In PostgreSQL 16 the has_* functions honour pg_read_all_data
# membership. It does not prove the state on the load day, nor that the 120 s statement timeout suffices: `snap pre` before the load
# remains the gate.
# Command inventory: hostname id sed tail printf psql grep awk date (read-only); no temp file; stdin closed.
#   Run (workstation Git Bash): tr -d '\r' < i348-privcheck.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s
# Dry run (never on afldb-prod): I348_PRIV_DRYRUN=1 bash i348-privcheck.sh   -> host-guard and env-file refusal paths only.
main() {
set -u -o pipefail; export LC_ALL=C
ENV_FILE=${I348_ENV_FILE:-/home/arm/projects/afldb/.env}
EXPECT_DB=${I348_EXPECT_DB:-afldb_prod}
EXPECT_HOST=${I348_EXPECT_HOST:-afldb-prod}
PGBIN=${I348_PGBIN:-/usr/lib/postgresql/16/bin}
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-20}"; }
envval() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
creds() {   # creds VAR ROLE: PG* for psql from the env file; refuses any other role or database
  local v; v=$(envval "$1"); [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v BASH_REMATCH
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
echo "== i348 privcheck $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
if [ "${I348_PRIV_DRYRUN:-0}" = 1 ]; then
  [ "$(hostname)" != "$EXPECT_HOST" ] || stop "the dry-run switch is refused on $EXPECT_HOST" 2
  echo "DRY RUN on $(hostname): host check would refuse (host is not $EXPECT_HOST)"
  [ -r "$ENV_FILE" ] && echo "DRY RUN: env file readable" || echo "DRY RUN: env file $ENV_FILE unreadable -> production run would STOP 3"
  exit 0
fi
[ "$(hostname)" = "$EXPECT_HOST" ] || stop "host is $(hostname), not $EXPECT_HOST" 3
[ -r "$ENV_FILE" ] || stop "env file unreadable" 3
creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "backup DSN missing or not afldb_backup@$EXPECT_DB" 3
OUT=$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=2000' \
  PGAPPNAME=afldb-i348-privcheck "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -At -F '|' -f - 2>&1 <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO \$chk\$ BEGIN IF current_user <> 'afldb_backup' OR current_database() <> '$EXPECT_DB' OR current_setting('transaction_read_only') <> 'on' THEN RAISE EXCEPTION 'i348 privcheck: unexpected session identity'; END IF; END \$chk\$;
SELECT 'session', current_user, current_database(), current_setting('transaction_read_only'), current_setting('server_version');
SELECT 'member_pg_read_all_data', pg_has_role(current_user, 'pg_read_all_data', 'MEMBER');
SELECT 'schema_usage_public', has_schema_privilege(current_user, 'public', 'USAGE');
SELECT 'table', t.name, CASE WHEN c.oid IS NULL THEN 'missing' WHEN has_table_privilege(current_user, c.oid, 'SELECT') THEN 't' ELSE 'f' END,
       c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
       (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                                       AND NOT has_column_privilege(current_user, c.oid, a.attnum, 'SELECT')),
       (has_table_privilege(current_user, c.oid, 'INSERT') OR has_table_privilege(current_user, c.oid, 'UPDATE')
         OR has_table_privilege(current_user, c.oid, 'DELETE') OR has_table_privilege(current_user, c.oid, 'TRUNCATE'))
  FROM unnest(ARRAY['data_edits','data_overrides','draft_persons','draft_picks','external_identities','import_batches',
                    'player_link_resolutions','players','sources']) AS t(name)
  LEFT JOIN pg_catalog.pg_class c ON c.oid = to_regclass('public.' || t.name)
 ORDER BY t.name;
ROLLBACK;
SQL
); RC=$?
unset PGPASSWORD
printf '%s\n' "$OUT"
echo "psql exit $RC"
F=0
grep -q '^session|afldb_backup|'"$EXPECT_DB"'|on|16' <<< "$OUT" || { echo "FAIL session identity"; F=1; }
grep -qx 'member_pg_read_all_data|t' <<< "$OUT" && echo "INFO afldb_backup is a member of pg_read_all_data" || echo "INFO afldb_backup is NOT a pg_read_all_data member (the per-table lines decide)"
grep -qx 'schema_usage_public|t' <<< "$OUT" || { echo "FAIL no USAGE on schema public"; F=1; }
[ "$(grep -c '^table|' <<< "$OUT")" = 9 ] || { echo "FAIL expected 9 table lines"; F=1; }
grep '^table|' <<< "$OUT" | awk -F'|' '$3 != "t" || $4 != "f" || $5 != "f" || $7 != "0" || $8 != "f" { print "FAIL " $0; bad = 1 } END { exit bad }' || F=1
[ "$RC" = 0 ] && [ "$F" = 0 ] && echo "PRIVCHECK RESULT PASS (afldb_backup: SELECT on all 9 relations and every column, USAGE on public, no RLS, no write privilege)" \
  || { echo "PRIVCHECK RESULT FAIL"; exit 1; }
}
main "$@" < /dev/null
