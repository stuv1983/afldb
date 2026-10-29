#!/bin/sh
# ISSUE-316 DEV candidate operation (D-DEV-316-C1-APP-1).
#
# One subcommand per approved step. POSIX sh. Run as `arm` on streamanator, never as root.
# No secret is ever printed or placed on a command line: connection settings are derived
# on-host into mode-600 files and handed to child processes through the environment.
#
#   verify      read-only: sha256 of every file in the extracted package
#   guard       read-only facts about the SOURCE database (afldb_dev); run before and after
#   preflight   read-only host / port / disk / runtime / candidate-database checks
#   layout      create the config / evidence / recovery / run directories (mode 700)
#   envgen      derive config/app.env and config/ops.env from the existing DEV .env
#   dump        read-only pg_dump of afldb_dev as afldb_backup into recovery/
#   restore     restore the dump into the (already created, empty) candidate database
#   migrate     apply the pending migrations to the candidate database with the reviewed runner
#   privileges  reconcile grants on the candidate database (tools/maintenance/privileges.sql)
#   readback    read-only ledger / ACL / row-count read-back of the candidate database
#   start       start the candidate application on 127.0.0.1:$CAND_PORT
#   check       run the stale-action check (kit/ops/check.mjs)
#   stop        stop the candidate application (verified PID)
#   status      read-only process / port status
#
# Nothing here modifies afldb_dev: `guard` and `dump` only read it. The candidate is never wired
# to a timer, a unit, Caddy, e-mail, the AFL APIs or any production credential.
#
# POSIX sh has no `pipefail`, so no critical command is piped into tee: `run_logged` captures the
# output to a file, prints it, and returns the command's own exit status.
set -eu

die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # <PKG>/kit/ops
PKG=$(CDPATH= cd -- "$SELF_DIR/../.." && pwd)           # <ROOT>/afldb-v2-dev-candidate-<rev>
ROOT=$(dirname -- "$PKG")
CFG=$ROOT/config
EVD=$ROOT/evidence
REC=$ROOT/recovery
RUN=$ROOT/run

NODE=${NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
SRC_ENV=${SRC_ENV_FILE:-/home/arm/projects/afldb/.env}
EXPECT_HOST=${EXPECT_HOST:-streamanator}
SRC_DB=${SRC_DB:-afldb_dev}
CAND_DB=${CAND_DB:-afldb_dev_v2_candidate_test}
CAND_PORT=${CAND_PORT:-3201}
EXPECT_LEDGER_AFTER=117

host_guard() {
  [ "$(id -u)" != "0" ] || die "must not run as root"
  [ "$(uname -n)" = "$EXPECT_HOST" ] || die "host is '$(uname -n)', expected '$EXPECT_HOST'"
  [ "$CAND_DB" != "$SRC_DB" ] || die "candidate database must differ from the source database"
  case $CAND_DB in *_test) : ;; *) die "candidate database name must end in _test" ;; esac
  case $CAND_DB in afldb_dev|afldb_prod|afldb_test|code_test_db) die "candidate database name is reserved" ;; esac
}

stamp() { date -u +%Y%m%dT%H%M%SZ; }

# run_logged <logfile> <command...>: run, capture, print, return the command's status.
run_logged() {
  _lf=$1; shift
  if "$@" > "$_lf" 2>&1; then _rc=0; else _rc=$?; fi
  cat "$_lf"
  return "$_rc"
}

# ---- connection settings (values are never printed) ----
read_src() {
  v=$(grep -E "^$1=" "$SRC_ENV" | head -n 1 | cut -d= -f2-) || true
  [ -n "$v" ] || die "$1 is not set in $SRC_ENV"
  v=$(printf '%s' "$v" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
  case $v in *\'*) die "$1 contains a single quote; unsupported" ;; esac
  printf '%s' "$v"
}
dsn_part() { # $1=dsn $2=user|pass|host|port|db
  case $2 in
    user) printf '%s' "$1" | sed -E 's#^[a-z]+://([^:@/]+)(:[^@]*)?@.*#\1#' ;;
    pass) printf '%s' "$1" | sed -E 's#^[a-z]+://[^:@/]+:([^@]*)@.*#\1#' ;;
    host) printf '%s' "$1" | sed -E 's#^[a-z]+://[^@]*@([^:/?]+).*#\1#' ;;
    port) p=$(printf '%s' "$1" | sed -nE 's#^[a-z]+://[^@]*@[^:/?]+:([0-9]+).*#\1#p'); printf '%s' "${p:-5432}" ;;
    db)   printf '%s' "$1" | sed -E 's#^[a-z]+://[^@]*@[^/]+/([^?]*).*#\1#' ;;
  esac
}
with_db() { printf '%s' "$1" | sed -E "s#^([a-z]+://[^/]+/)[^?]*#\\1$2#"; }
expect_src_db() { [ "$(dsn_part "$2" db)" = "$SRC_DB" ] || die "$1 does not name $SRC_DB"; }
plain_secret() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~-]+$' || die "$2 password has characters this script will not pass through libpq unencoded"; }
q() { printf "export %s='%s'\n" "$1" "$2"; }

# Source (read-only role) settings straight from the existing DEV .env: used by guard / preflight,
# which run before envgen has written anything.
load_src_direct() {
  _bak=$(read_src AFLDB_BACKUP_DATABASE_URL)
  expect_src_db AFLDB_BACKUP_DATABASE_URL "$_bak"
  [ "$(dsn_part "$_bak" user)" = "afldb_backup" ] || die "backup DSN is not afldb_backup"
  plain_secret "$(dsn_part "$_bak" pass)" backup
  SRC_PGHOST=$(dsn_part "$_bak" host); SRC_PGPORT=$(dsn_part "$_bak" port)
  SRC_PGUSER=afldb_backup; SRC_PGPASSWORD=$(dsn_part "$_bak" pass); SRC_PGDATABASE=$SRC_DB
  unset _bak
}
load_ops() {
  [ -f "$CFG/ops.env" ] || die "$CFG/ops.env is missing (run envgen)"
  set -a; . "$CFG/ops.env"; set +a
}

# Subshell bodies: nothing leaks between candidate-owner and source read-only calls.
as_cand() ( export PGHOST="$CAND_PGHOST" PGPORT="$CAND_PGPORT" PGUSER="$CAND_PGUSER" PGPASSWORD="$CAND_PGPASSWORD" PGDATABASE="$CAND_PGDATABASE" PGOPTIONS="-c application_name=issue316-dev-candidate"; "$@" )
as_src()  ( export PGHOST="$SRC_PGHOST" PGPORT="$SRC_PGPORT" PGUSER="$SRC_PGUSER" PGPASSWORD="$SRC_PGPASSWORD" PGDATABASE="$SRC_PGDATABASE" PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000 -c application_name=issue316-dev-readonly"; "$@" )

COUNTS_SQL="
SELECT 'ledger', count(*)::text || ' / ' || coalesce(max(name), '-') FROM afldb_meta.schema_migrations
UNION ALL SELECT 'auth_audit_log', count(*)::text || ' / max_id ' || coalesce(max(id), 0)::text FROM auth_audit_log
UNION ALL SELECT 'legacy_retired_refused_rows', count(*)::text FROM auth_audit_log WHERE action = 'admin.legacy_retired_refused'
UNION ALL SELECT 'auth_users', count(*)::text FROM auth_users
UNION ALL SELECT 'auth_sessions_active', count(*)::text FROM auth_sessions WHERE expires_at > now() AND revoked_at IS NULL
UNION ALL SELECT 'matches', count(*)::text FROM matches
UNION ALL SELECT 'players', count(*)::text FROM players
UNION ALL SELECT 'player_match_stats', count(*)::text FROM player_match_stats
UNION ALL SELECT 'import_batches', count(*)::text FROM import_batches
ORDER BY 1;"

cmd_verify() {
  [ -f "$PKG/FILES.sha256" ] || die "$PKG/FILES.sha256 missing"
  ( cd "$PKG" && sha256sum --quiet -c FILES.sha256 ) || die "package contents do not match FILES.sha256"
  log "package verified: $(wc -l < "$PKG/FILES.sha256") files match FILES.sha256"
}

cmd_guard() {
  host_guard; load_src_direct
  log "== source database facts (read-only): $SRC_DB @ $(stamp) =="
  as_src psql -X -At -F ' | ' -c "$COUNTS_SQL"
}

cmd_preflight() {
  host_guard; load_src_direct
  log "host=$(uname -n) user=$(id -un) uid=$(id -u) kernel=$(uname -sr) arch=$(uname -m)"
  [ -x "$NODE" ] || die "node not found at $NODE"
  log "node=$("$NODE" --version) at $NODE"
  for b in psql pg_dump pg_restore sha256sum tar curl ss; do command -v "$b" >/dev/null 2>&1 || die "missing tool: $b"; done
  log "psql=$(psql --version)"
  avail_kb=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
  log "free space under $ROOT: $((avail_kb / 1024)) MiB"
  [ "$avail_kb" -ge 6291456 ] || die "less than 6 GiB free"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$CAND_PORT\$"; then die "port $CAND_PORT is already listening"; fi
  log "port $CAND_PORT: free"
  [ -f "$PKG/app/server.js" ] || die "$PKG/app/server.js missing (archive not extracted?)"
  log "build id: $(cat "$PKG/app/.next/BUILD_ID")"
  log "candidate database '$CAND_DB' (read-only catalog query):"
  as_src psql -X -At -c "SELECT coalesce((SELECT datname || ' owner=' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$CAND_DB'), '(absent)')"
}

cmd_layout() {
  host_guard
  for d in "$CFG" "$EVD" "$REC" "$RUN"; do [ ! -e "$d" ] || die "$d already exists"; done
  umask 077
  mkdir -m 700 "$CFG" "$EVD" "$REC" "$RUN"
  log "created $CFG $EVD $REC $RUN (mode 700)"
}

cmd_envgen() {
  host_guard
  [ -d "$CFG" ] || die "run layout first"
  [ ! -e "$CFG/app.env" ] && [ ! -e "$CFG/ops.env" ] || die "config files already exist"
  app=$(read_src DATABASE_URL); auth=$(read_src AFLDB_AUTH_DATABASE_URL); imp=$(read_src AFLDB_IMPORT_DATABASE_URL)
  own=$(read_src AFLDB_OWNER_DATABASE_URL); bak=$(read_src AFLDB_BACKUP_DATABASE_URL)
  expect_src_db DATABASE_URL "$app"; expect_src_db AFLDB_AUTH_DATABASE_URL "$auth"; expect_src_db AFLDB_IMPORT_DATABASE_URL "$imp"
  expect_src_db AFLDB_OWNER_DATABASE_URL "$own"; expect_src_db AFLDB_BACKUP_DATABASE_URL "$bak"
  [ "$(dsn_part "$own" user)" = "afldb_owner" ] || die "owner DSN is not afldb_owner"
  [ "$(dsn_part "$bak" user)" = "afldb_backup" ] || die "backup DSN is not afldb_backup"
  plain_secret "$(dsn_part "$own" pass)" owner; plain_secret "$(dsn_part "$bak" pass)" backup
  secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  [ "${#secret}" = "64" ] || die "could not generate a session secret"
  umask 077
  {
    q NODE_ENV production
    q HOSTNAME 127.0.0.1
    q PORT "$CAND_PORT"
    q NEXT_TELEMETRY_DISABLED 1
    q AFLDB_ENV development
    q AFLDB_INDEXING off
    q AFLDB_BETA_GATE off
    q AFLDB_BASE_URL "http://127.0.0.1:$CAND_PORT"
    q AFLDB_POOL_MAX 4
    q AFLDB_MAX_PAGE_SIZE 100
    q AFLDB_MAX_FILTERS 20
    q AFLDB_STATEMENT_TIMEOUT_MS 5000
    q DATABASE_URL "$(with_db "$app" "$CAND_DB")"
    q AFLDB_AUTH_DATABASE_URL "$(with_db "$auth" "$CAND_DB")"
    q AFLDB_IMPORT_DATABASE_URL "$(with_db "$imp" "$CAND_DB")"
    q AFLDB_SESSION_SECRET "$secret"
  } > "$CFG/app.env"
  {
    q AFLDB_TEST_DATABASE_URL "$(with_db "$own" "$CAND_DB")"
    q AFLDB_AUTH_DATABASE_URL "$(with_db "$auth" "$CAND_DB")"
    q AFLDB_BACKUP_DATABASE_URL "$(with_db "$bak" "$CAND_DB")"
    q AFLDB_SESSION_SECRET "$secret"
    q CAND_BASE_URL "http://127.0.0.1:$CAND_PORT"
    q CAND_DB "$CAND_DB"
    q CAND_APP_DIR "$PKG/app"
    q CAND_PGHOST "$(dsn_part "$own" host)"; q CAND_PGPORT "$(dsn_part "$own" port)"
    q CAND_PGUSER afldb_owner; q CAND_PGPASSWORD "$(dsn_part "$own" pass)"; q CAND_PGDATABASE "$CAND_DB"
    q SRC_PGHOST "$(dsn_part "$bak" host)"; q SRC_PGPORT "$(dsn_part "$bak" port)"
    q SRC_PGUSER afldb_backup; q SRC_PGPASSWORD "$(dsn_part "$bak" pass)"; q SRC_PGDATABASE "$SRC_DB"
  } > "$CFG/ops.env"
  unset app auth imp own bak secret
  log "wrote config/app.env and config/ops.env (mode 600). Variable names only:"
  cut -d= -f1 "$CFG/app.env" | sed 's/^export //' | tr '\n' ' '; echo
  cut -d= -f1 "$CFG/ops.env" | sed 's/^export //' | tr '\n' ' '; echo
}

cmd_dump() {
  host_guard; load_ops
  ts=$(stamp); f=$REC/afldb_dev-$ts.dump
  [ ! -e "$f" ] || die "$f exists"
  umask 077
  log "== source counts before dump =="
  run_logged "$EVD/source-counts-before-$ts.txt" as_src psql -X -At -F ' | ' -c "$COUNTS_SQL" || die "count query failed"
  log "== pg_dump (read-only role) -> $f =="
  as_src pg_dump --format=custom --compress=6 --file="$f" || die "pg_dump failed"
  log "== source counts after dump =="
  run_logged "$EVD/source-counts-after-$ts.txt" as_src psql -X -At -F ' | ' -c "$COUNTS_SQL" || die "count query failed"
  ( cd "$REC" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" && cat "$(basename "$f").sha256" )
  stat -c '%n %s bytes' "$f"
  pg_restore --list "$f" > "$EVD/dump-toc-$ts.txt" || die "pg_restore --list failed"
  log "TOC entries: $(grep -vc '^;' "$EVD/dump-toc-$ts.txt")"
}

latest_dump() { ls -1t "$REC"/afldb_dev-*.dump 2>/dev/null | head -n 1 || true; }

cmd_restore() {
  host_guard; load_ops
  f=${1:-$(latest_dump)}; [ -n "$f" ] && [ -f "$f" ] || die "no dump file"
  ( cd "$REC" && sha256sum -c "$(basename "$f").sha256" ) || die "dump hash mismatch"
  run_logged "$EVD/candidate-db-identity.txt" as_cand psql -X -At -c "SELECT current_database() || ' owner=' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()" || die "cannot connect to candidate database"
  grep -q "^$CAND_DB owner=afldb_owner\$" "$EVD/candidate-db-identity.txt" || die "candidate database identity/owner is not as expected"
  n=$(as_cand psql -X -At -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f')")
  [ "$n" = "0" ] || die "candidate database is not empty ($n relations)"
  ts=$(stamp)
  log "== pg_restore (single transaction, exit on error, no owner) =="
  run_logged "$EVD/restore-$ts.log" as_cand pg_restore --exit-on-error --single-transaction --no-owner --dbname="$CAND_DB" "$f" || die "pg_restore failed (single transaction: the candidate database is unchanged)"
  log "== candidate counts after restore =="
  run_logged "$EVD/candidate-counts-restored-$ts.txt" as_cand psql -X -At -F ' | ' -c "$COUNTS_SQL" || die "count query failed"
}

cmd_migrate() {
  host_guard; load_ops
  case $AFLDB_TEST_DATABASE_URL in */"$CAND_DB"|*/"$CAND_DB"\?*) : ;; *) die "AFLDB_TEST_DATABASE_URL does not name $CAND_DB" ;; esac
  ts=$(stamp)
  log "== ledger before (read-only) =="
  run_logged "$EVD/ledger-before-$ts.txt" as_cand psql -X -At -c "SELECT count(*) || ' / ' || max(name) FROM afldb_meta.schema_migrations" || die "ledger query failed"
  grep -q '^110 / 110_match_sheet_player_match_stats_authority.sql$' "$EVD/ledger-before-$ts.txt" || die "candidate ledger is not the expected 110-record baseline"
  log "== migrate.ts --target test (reviewed runner; applies 111..117 only) =="
  run_logged "$EVD/migrate-$ts.log" sh -c 'cd "$1" && exec "$2" --import tsx tools/db/migrate.ts --target test' sh "$PKG/kit" "$NODE" || die "migration runner failed (each migration is transactional; re-read the ledger before deciding anything)"
  log "== ledger after =="
  run_logged "$EVD/ledger-after-$ts.txt" as_cand psql -X -At -c "SELECT count(*) || ' / ' || max(name) FROM afldb_meta.schema_migrations" || die "ledger query failed"
  grep -q "^$EXPECT_LEDGER_AFTER / 117_brownlow_provider_eligibility_unknown.sql\$" "$EVD/ledger-after-$ts.txt" || die "ledger is not at 117 after migrating"
}

cmd_privileges() {
  host_guard; load_ops
  ts=$(stamp)
  run_logged "$EVD/privileges-$ts.log" as_cand psql -X -w -v ON_ERROR_STOP=1 -f "$PKG/kit/tools/maintenance/privileges.sql" || die "privileges.sql failed"
}

cmd_readback() {
  host_guard; load_ops
  ts=$(stamp); out=$EVD/readback-$ts.txt
  : > "$out"
  {
    log "== database identity =="
    as_cand psql -X -At -c "SELECT current_database(), pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()" || echo "(failed)"
    log "== extensions =="; as_cand psql -X -At -c "SELECT extname || ' ' || extversion FROM pg_extension ORDER BY 1" || echo "(failed)"
    log "== ledger =="; as_cand psql -X -At -c "SELECT count(*) || ' / ' || max(name) FROM afldb_meta.schema_migrations" || echo "(failed)"
    log "== runner re-run: must report nothing to apply (checksum parity for all migration files) =="
    sh -c 'cd "$1" && exec "$2" --import tsx tools/db/migrate.ts --target test' sh "$PKG/kit" "$NODE" || echo "(runner failed)"
    log "== key table privileges (role | table | select insert update delete) =="
    as_cand psql -X -A -F ' | ' -c "SELECT r.rolname, t.tbl, has_table_privilege(r.rolname,t.tbl,'SELECT'), has_table_privilege(r.rolname,t.tbl,'INSERT'), has_table_privilege(r.rolname,t.tbl,'UPDATE'), has_table_privilege(r.rolname,t.tbl,'DELETE') FROM pg_roles r CROSS JOIN (VALUES ('public.auth_users'),('public.auth_sessions'),('public.auth_audit_log')) t(tbl) WHERE r.rolname IN ('afldb_app','afldb_auth','afldb_import','afldb_backup') ORDER BY 2,1" || echo "(failed)"
    log "== candidate counts =="; as_cand psql -X -At -F ' | ' -c "$COUNTS_SQL" || echo "(failed)"
  } > "$out" 2>&1
  cat "$out"
  grep -q 'Nothing to apply' "$out" || die "runner re-run did not report 'Nothing to apply'"
  grep -q "^$EXPECT_LEDGER_AFTER / 117_brownlow_provider_eligibility_unknown.sql\$" "$out" || die "ledger is not at 117"
  ! grep -q '(failed)\|(runner failed)' "$out" || die "a read-back step failed"
}

pid_listening() {
  ss -ltnpH 2>/dev/null | awk -v p=":$CAND_PORT\$" '$4 ~ p' | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1
}
verify_pid() { # $1 = pid : must be our node serving $PKG/app
  [ "$(readlink "/proc/$1/exe" 2>/dev/null)" = "$(readlink -f "$NODE")" ] || return 1
  [ "$(readlink "/proc/$1/cwd" 2>/dev/null)" = "$PKG/app" ] || return 1
}

cmd_start() {
  host_guard
  [ ! -e "$RUN/candidate.pid" ] || die "pid file exists; run status/stop first"
  [ -z "$(pid_listening)" ] || die "port $CAND_PORT already in use"
  [ -f "$CFG/app.env" ] || die "config/app.env missing"
  ( set -a; . "$CFG/app.env"; set +a; cd "$PKG/app"; exec setsid "$NODE" server.js ) > "$EVD/server.log" 2>&1 < /dev/null &
  pid=""; i=0
  while [ "$i" -lt 40 ]; do
    pid=$(pid_listening)
    [ -z "$pid" ] || break
    i=$((i + 1)); sleep 1
  done
  [ -n "$pid" ] || { tail -n 20 "$EVD/server.log" >&2; die "candidate did not start listening on $CAND_PORT"; }
  verify_pid "$pid" || die "listener pid $pid is not the expected node/cwd; not recording it"
  printf '%s\n' "$pid" > "$RUN/candidate.pid"
  code=""; i=0
  while [ "$i" -lt 30 ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CAND_PORT/api/health" || true)
    [ "$code" = "200" ] && break
    i=$((i + 1)); sleep 1
  done
  [ "$code" = "200" ] || die "/api/health returned '${code:-none}'"
  log "candidate running: pid=$pid port=$CAND_PORT health=200 build=$(cat "$PKG/app/.next/BUILD_ID")"
  ss -ltn 2>/dev/null | grep ":$CAND_PORT " || true
}

cmd_check() {
  host_guard; load_ops
  [ -f "$RUN/candidate.pid" ] || die "candidate is not running"
  verify_pid "$(cat "$RUN/candidate.pid")" || die "recorded pid does not verify"
  ts=$(stamp)
  sh -c 'cd "$1" && exec "$2" ops/check.mjs --out "$3"' sh "$PKG/kit" "$NODE" "$EVD/stale-action-check-$ts.json"
}

cmd_stop() {
  host_guard
  [ -f "$RUN/candidate.pid" ] || die "no pid file"
  pid=$(cat "$RUN/candidate.pid")
  verify_pid "$pid" || die "pid $pid does not verify as the candidate; not killing it"
  kill -TERM "$pid"
  i=0
  while [ "$i" -lt 20 ] && [ -d "/proc/$pid" ]; do i=$((i + 1)); sleep 1; done
  [ ! -d "/proc/$pid" ] || die "pid $pid still running after 20 s"
  rm -f "$RUN/candidate.pid"
  [ -z "$(pid_listening)" ] || die "port $CAND_PORT still has a listener"
  log "candidate stopped; port $CAND_PORT free"
}

cmd_status() {
  host_guard
  if [ -f "$RUN/candidate.pid" ]; then
    pid=$(cat "$RUN/candidate.pid")
    if verify_pid "$pid"; then log "running pid=$pid"; else log "pid file stale ($pid)"; fi
  else log "no pid file"; fi
  log "listener pid on $CAND_PORT: $(pid_listening)"
}

sub=${1:-}; if [ -n "$sub" ]; then shift; fi
case $sub in
  verify) cmd_verify ;; guard) cmd_guard ;; preflight) cmd_preflight ;; layout) cmd_layout ;; envgen) cmd_envgen ;;
  dump) cmd_dump ;; restore) cmd_restore "$@" ;; migrate) cmd_migrate ;; privileges) cmd_privileges ;;
  readback) cmd_readback ;; start) cmd_start ;; check) cmd_check ;; stop) cmd_stop ;; status) cmd_status ;;
  *) die "usage: dev-candidate.sh verify|guard|preflight|layout|envgen|dump|restore|migrate|privileges|readback|start|check|stop|status" ;;
esac
