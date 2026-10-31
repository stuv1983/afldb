#!/bin/bash
# V2-GAP-006 release package: isolated verification of the P6/P7 SQL block. Touches no production and no host service.
#
#   bash p6-p7-verify.sh <p6-p7.sql> [<old-rev2.sql>]
#
# Builds a THROWAWAY PostgreSQL cluster in RAM-backed /dev/shm: unix-socket only (listen_addresses is empty, so no TCP
# port exists), private directory, removed on exit. It creates roles afldb_import / afldb_auth / afldb_app, a stand-in
# public.data_edits with its sequence, and afldb_meta.schema_migrations, then runs the exact SQL file the package
# prints (the text between <<'SQL' and SQL) under many grant states and checks the exit status and the output.
# Scenario A is the state the owner observed on production at T0 of revision 2.
set -uo pipefail
export LC_ALL=C
SQLFILE=${1:?usage: p6-p7-verify.sh <p6-p7.sql> [<old-rev2.sql>]}
OLDFILE=${2:-}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
W=$(mktemp -d /dev/shm/gap006-p6-XXXXXX); chmod 700 "$W"
trap '"$PGBIN/pg_ctl" -D "$W/data" -m immediate stop >/dev/null 2>&1; rm -rf "$W"' EXIT
fails=0
"$PGBIN/initdb" -D "$W/data" -U pgsim --auth=trust -E UTF8 --locale=C > "$W/initdb.log" 2>&1 || { echo "initdb failed"; exit 9; }
"$PGBIN/pg_ctl" -D "$W/data" -w -l "$W/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories=$W -c shared_buffers=16MB -c max_connections=10 -c fsync=off" start > /dev/null || { echo "start failed"; exit 9; }
echo "throwaway cluster: $("$PGBIN/postgres" --version) socket-only at $W, listen_addresses empty"
P() { "$PGBIN/psql" -X -q -h "$W" -U pgsim -v ON_ERROR_STOP=1 "$@"; }
P -d postgres -c "CREATE DATABASE afldb_prod_sim" || exit 9
P -d afldb_prod_sim -c "CREATE ROLE afldb_import NOLOGIN; CREATE ROLE afldb_auth NOLOGIN; CREATE ROLE afldb_app NOLOGIN;" || exit 9
P -d afldb_prod_sim <<'SQL' || exit 9
CREATE SCHEMA afldb_meta;
CREATE TABLE afldb_meta.schema_migrations (name text PRIMARY KEY);
INSERT INTO afldb_meta.schema_migrations
  SELECT lpad(i::text, 3, '0') || '_stand_in.sql' FROM generate_series(1, 116) AS i;
INSERT INTO afldb_meta.schema_migrations VALUES ('117_brownlow_provider_eligibility_unknown.sql');
CREATE TABLE public.data_edits (id bigserial PRIMARY KEY, table_name text, note text);
SQL

reset_state() { # A: what the owner reported on production, plus afldb_auth as privileges.sql grants it
  P -d afldb_prod_sim -c "SET client_min_messages = warning;
    CREATE TABLE IF NOT EXISTS public.data_edits (id bigserial PRIMARY KEY, table_name text, note text);
    REVOKE ALL ON public.data_edits FROM PUBLIC, afldb_import, afldb_auth, afldb_app;
    REVOKE ALL ON SEQUENCE public.data_edits_id_seq FROM PUBLIC, afldb_import, afldb_auth, afldb_app;
    GRANT SELECT, INSERT ON public.data_edits TO afldb_import;
    GRANT USAGE ON SEQUENCE public.data_edits_id_seq TO afldb_import;
    GRANT SELECT, INSERT ON public.data_edits TO afldb_auth;
    DELETE FROM afldb_meta.schema_migrations WHERE name NOT LIKE '%_stand_in.sql' AND name <> '117_brownlow_provider_eligibility_unknown.sql';
    INSERT INTO afldb_meta.schema_migrations
      SELECT lpad(i::text, 3, '0') || '_stand_in.sql' FROM generate_series(1, 116) AS i ON CONFLICT DO NOTHING;
    INSERT INTO afldb_meta.schema_migrations VALUES ('117_brownlow_provider_eligibility_unknown.sql') ON CONFLICT DO NOTHING;" || exit 9
}
# run <file>: writes $W/out and returns psql's exit status
run() { "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$W" -U pgsim -d afldb_prod_sim -f "$1" > "$W/out" 2>&1; return $?; }
# scenario <label> <expected rc> <expected text in output> <setup SQL, may be empty>
scenario() {
  local label=$1 rc=$2 want=$3 setup=$4
  reset_state
  [ -z "$setup" ] || P -d afldb_prod_sim -c "$setup" || { echo "  SETUP-ERR $label"; fails=$((fails + 1)); return; }
  run "$SQLFILE"; local got=$?
  if [ "$got" = "$rc" ] && grep -qF -- "$want" "$W/out"; then echo "  ok    $label -> exit $got, found: $want"
  else echo "  FAIL  $label -> exit $got (want $rc), wanted text: $want"; sed 's/^/        | /' "$W/out"; fails=$((fails + 1)); fi
}

echo "== passing states"
scenario "A  production as reported (import S+I+seq, auth S+I, app none)" 0 "P6 PASS, P7 PASS" ""
reset_state; run "$SQLFILE"; cp "$W/out" "$W/outA"
grep -qF "afldb_app (informational, not asserted): select=f insert=f update=f delete=f truncate=f" "$W/outA" && echo "  ok    A reports afldb_app separately: select=f insert=f update=f delete=f truncate=f" || { echo "  FAIL  A app report"; fails=$((fails + 1)); }
echo "---- scenario A full output (what the owner should see, apart from timing) ----"; sed 's/^/  | /' "$W/outA"; echo "---- end ----"
scenario "B  auth has SELECT only (INSERT not asserted)" 0 "P6 PASS, P7 PASS" "REVOKE INSERT ON public.data_edits FROM afldb_auth;"
scenario "C  app also holds SELECT+INSERT (reported, never gated)" 0 "afldb_app (informational, not asserted): select=t insert=t update=f delete=f truncate=f" "GRANT SELECT, INSERT ON public.data_edits TO afldb_app;"
scenario "D  afldb_app role absent (reported)" 0 "afldb_app (informational, not asserted): role absent" "DROP OWNED BY afldb_app; DROP ROLE afldb_app;"
P -d afldb_prod_sim -c "CREATE ROLE afldb_app NOLOGIN;" 2>/dev/null
scenario "E  PUBLIC SELECT (inherited by app, reported)" 0 "afldb_app (informational, not asserted): select=t" "GRANT SELECT ON public.data_edits TO PUBLIC;"

echo "== failing states (each must exit 3 with its own message)"
scenario "F  import lacks SELECT" 3 "afldb_import lacks SELECT" "REVOKE SELECT ON public.data_edits FROM afldb_import;"
scenario "G  import lacks INSERT" 3 "afldb_import lacks INSERT" "REVOKE INSERT ON public.data_edits FROM afldb_import;"
scenario "H  import lacks sequence USAGE" 3 "afldb_import lacks USAGE on data_edits_id_seq" "REVOKE USAGE ON SEQUENCE public.data_edits_id_seq FROM afldb_import;"
scenario "I  import holds UPDATE" 3 "afldb_import holds UPDATE, DELETE or TRUNCATE" "GRANT UPDATE ON public.data_edits TO afldb_import;"
scenario "J  import holds DELETE" 3 "afldb_import holds UPDATE, DELETE or TRUNCATE" "GRANT DELETE ON public.data_edits TO afldb_import;"
scenario "K  import holds TRUNCATE" 3 "afldb_import holds UPDATE, DELETE or TRUNCATE" "GRANT TRUNCATE ON public.data_edits TO afldb_import;"
scenario "L  PUBLIC UPDATE reaches import" 3 "afldb_import holds UPDATE, DELETE or TRUNCATE" "GRANT UPDATE ON public.data_edits TO PUBLIC;"
scenario "M  auth lacks SELECT" 3 "afldb_auth lacks SELECT" "REVOKE SELECT ON public.data_edits FROM afldb_auth;"
scenario "N  auth holds DELETE" 3 "afldb_auth holds UPDATE, DELETE or TRUNCATE" "GRANT DELETE ON public.data_edits TO afldb_auth;"
scenario "O  ledger has 116 rows" 3 "P7 FAIL" "DELETE FROM afldb_meta.schema_migrations WHERE name = '001_stand_in.sql';"
scenario "P  ledger latest is not 117_brownlow..." 3 "P7 FAIL" "INSERT INTO afldb_meta.schema_migrations VALUES ('118_extra.sql'); DELETE FROM afldb_meta.schema_migrations WHERE name = '001_stand_in.sql';"
scenario "Q  afldb_auth role absent" 3 "role afldb_auth does not exist" "DROP OWNED BY afldb_auth; DROP ROLE afldb_auth;"
P -d afldb_prod_sim -c "CREATE ROLE afldb_auth NOLOGIN;" 2>/dev/null
scenario "R  afldb_import role absent" 3 "role afldb_import does not exist" "DROP OWNED BY afldb_import; DROP ROLE afldb_import;"
P -d afldb_prod_sim -c "CREATE ROLE afldb_import NOLOGIN;" 2>/dev/null
scenario "S  public.data_edits missing (the report query already fails closed)" 3 "relation \"public.data_edits\" does not exist" "DROP TABLE public.data_edits;"

echo "== the block changes nothing"
reset_state
SNAP="SELECT md5(string_agg(c.relname || coalesce(c.relacl::text, ''), ',' ORDER BY c.relname)) || ' ' || (SELECT count(*) FROM afldb_meta.schema_migrations) || ' ' || (SELECT count(*) FROM pg_roles) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace"
b=$(P -At -d afldb_prod_sim -c "$SNAP"); run "$SQLFILE"; a=$(P -At -d afldb_prod_sim -c "$SNAP")
[ "$b" = "$a" ] && echo "  ok    ACLs, ledger and roles identical before and after ($a)" || { echo "  FAIL  state changed: $b -> $a"; fails=$((fails + 1)); }
grep -qE "BEGIN READ ONLY" "$SQLFILE" && grep -qE "^ROLLBACK;" "$SQLFILE" && echo "  ok    the file opens BEGIN READ ONLY and ends ROLLBACK" || { echo "  FAIL  not read-only framed"; fails=$((fails + 1)); }

if [ -n "$OLDFILE" ]; then
  echo "== revision 2 block against the production-observed state (reproduces the owner's failure)"
  reset_state; run "$OLDFILE"; got=$?
  [ "$got" = 3 ] && grep -qF "P6 FAIL" "$W/out" && echo "  ok    revision 2: exit $got -> $(grep -m1 'P6 FAIL' "$W/out" | sed 's/^.*ERROR: *//')" || { echo "  FAIL  revision 2 did not reproduce exit 3"; sed 's/^/        | /' "$W/out"; fails=$((fails + 1)); }
fi
[ "$fails" -eq 0 ] && { echo "P6/P7 VERIFICATION PASS"; exit 0; }
echo "P6/P7 VERIFICATION FAIL ($fails)"; exit 1
