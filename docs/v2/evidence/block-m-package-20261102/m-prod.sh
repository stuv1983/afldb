:
{
# Block M production-side phases (owner-attended). Run as `arm` on afldb-prod, ONE phase per call. Nothing here pushes, builds, promotes,
# restarts or uses sudo. Database access is the existing protected channel in the checkout .env, parsed for the child process only
# (never argv, never printed). Phases that WRITE the database are `migrate` (M1) and `window` run (M3); every other phase is read-only.
#
#   bash m-prod.sh pre       <expect-checkout-sha> <OLD_ID> <117|118>    read-only preflight (checkout, ledger, writers, serving)
#   bash m-prod.sh migrate   <R>                                          M1: migration 118 only, owner role, atomic
#   bash m-prod.sh readback                                               read-only; proves 118 and prints the ledger digest
#   bash m-prod.sh window-stage <snapshot-dir-name> <feed-sha256>         read-only; proves the staged snapshot bytes
#   bash m-prod.sh window    check|run <R> <snapshot> <feed-sha256> <evidence-dir> <decision-text>   M3 (run writes; check does not)
#   bash m-prod.sh window    restore <evidence-dir>                       recovery: force the switch off and verify
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD HS_DSN prod_url; echo "STOP: $1"; exit "${2:-1}"; }

PHASE=${1:?phase}; shift
R_CHK=/home/arm/projects/afldb
ROOT=/home/arm/afldb-releases
PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432
EXPECT_SYSID=7674454702926115004; EXPECT_OID=66668
MIG118=118_fixtures_unconfirmed_participants.sql
MIG118_SHA=49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401
L117_DIGEST=647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72
L118_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57
LAST117=117_brownlow_provider_eligibility_unknown.sql
UNITS="afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer
afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer"
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
[ -x "$NODE" ] && [ -x "$PGBIN/psql" ] || stop "missing node or psql" 3

# --- DSN from .env into PG* variables for this process only; identity is checked, the value is never printed -----------------------
hs_parse_dsn() {
  local key=$1 role=$2 envf="$R_CHK/.env" line pwenc
  [ -r "$envf" ] || stop "env file unreadable" 2
  [ "$(grep -c "^$key=" "$envf")" = 1 ] || stop "$key must appear exactly once in .env" 2
  line=$(sed -n "s/^$key=//p" "$envf" | sed 's/^"\(.*\)"$/\1/')
  [ -n "$line" ] || stop "$key empty" 2
  local re='^(postgres|postgresql)://([^:@/]+):([^@]*)@([^/:?]+)(:([0-9]+))?/([^?/]+)$'
  [[ "$line" =~ $re ]] || { unset line; stop "$key has an unexpected form (value not printed)" 2; }
  PGUSER=${BASH_REMATCH[2]}; pwenc=${BASH_REMATCH[3]}; PGHOST=${BASH_REMATCH[4]}; PGPORT=${BASH_REMATCH[6]:-5432}; PGDATABASE=${BASH_REMATCH[7]}
  HS_SAFE_TARGET="$PGUSER@$PGHOST:${BASH_REMATCH[6]}/$PGDATABASE"
  [ -n "$pwenc" ] || stop "$key has no password (value not printed)" 2
  PGPASSWORD=$(printf '%b' "${pwenc//\%/\\x}"); HS_DSN=$line; unset pwenc line BASH_REMATCH
  echo "dsn_identity key=$key user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
  [ "$PGUSER" = "$role" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DSN_HOST" ] && [ "$PGPORT" = "$EXPECT_DSN_PORT" ] \
    || stop "$key is not $role@$EXPECT_DSN_HOST:$EXPECT_DSN_PORT/$EXPECT_DB" 2
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-blockm-read "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
backup_identity() {
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  local ident; ident=$(q -c "SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()), current_setting('transaction_read_only')") \
    || stop "identity query failed" 5
  [ "$ident" = "$(printf '%s\t%s\t%s\ton' "$EXPECT_DB" "$EXPECT_OID" "$EXPECT_SYSID")" ] || stop "identity differs from the reviewed target: $ident" 5
  echo "identity ok (database, OID, system identifier, read-only session)"
}
ledger() { q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\""; }
ledger_is() { # rows last digest
  local l rows last dig; l=$(ledger) || stop "ledger query failed" 5
  rows=$(printf '%s\n' "$l" | wc -l); last=$(printf '%s\n' "$l" | tail -1 | cut -f1); dig=$(printf '%s\n' "$l" | sha256sum | cut -c1-64)
  echo "ledger rows=$rows last=$last digest=$dig"
  [ "$rows" = "$1" ] && [ "$last" = "$2" ] && [ "$dig" = "$3" ] || stop "ledger is not the expected ${1}-row state" 5
}
no_writers() {
  local u e a
  for u in $UNITS; do
    e=$(systemctl is-enabled "$u" 2>/dev/null); a=$(systemctl is-active "$u" 2>/dev/null)
    echo "unit $u enabled=${e:-absent} active=${a:-absent}"
    case "$e" in enabled|enabled-runtime|linked|linked-runtime|alias) stop "writer unit $u is $e" 4;; esac
    case "$a" in active|activating|reloading) stop "writer unit $u is $a" 4;; esac
  done
  local out x; out=$(pgrep -af 'settle-afltables|settle-afl-api|acquire-afl-api|tools/db/migrate\.ts|backup\.sh|pg_dump|pg_restore|afl-api-fixture-window|apply-gap029'); x=$?
  [ "$x" -le 1 ] || stop "process check failed (pgrep exit $x)" 4
  [ "$x" = 1 ] || { printf '%s\n' "$out"; stop "a settle, migration, dump, restore, window or label process is running" 4; }
  echo "no settle/migrate/dump/restore/window/label process"
  if crontab -l >/dev/null 2>&1; then stop "arm has a crontab" 4; else echo "no crontab for arm"; fi
}
clean_at() { # sha
  [[ $1 =~ ^[0-9a-f]{40}$ ]] || stop "not a 40-hex revision: $1" 2
  [ "$(git -C "$R_CHK" rev-parse HEAD)" = "$1" ] || stop "checkout HEAD is $(git -C "$R_CHK" rev-parse HEAD), expected $1" 3
  [ -z "$(git -C "$R_CHK" status --porcelain)" ] || stop "checkout has changes" 3
  echo "checkout $1 clean"
}

case "$PHASE" in
pre)
  EXPECT_SHA=${1:?checkout sha}; OLD_ID=${2:?OLD_ID}; LED=${3:?117|118}
  step "pre: host, checkout, writers, serving, ledger ($LED)"
  clean_at "$EXPECT_SHA"
  no_writers
  bash "$HERE/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING || stop "serving state is not OLD_SERVING" 6
  echo "MemAvailable_MB=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) free_GB=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)"
  backup_identity
  case "$LED" in
    117) ledger_is 117 "$LAST117" "$L117_DIGEST"
         [ "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_name='fixtures' AND column_name IN ('confirmation','home_placeholder','away_placeholder')")" = 0 ] || stop "fixtures already has 118 columns" 5 ;;
    118) ledger_is 118 "$MIG118" "$L118_DIGEST" ;;
    *) stop "ledger must be 117 or 118" 2 ;;
  esac
  echo "fixtures_rows=$(q -c 'SELECT count(*) FROM fixtures') matches_rows=$(q -c 'SELECT count(*) FROM matches') switch_raw=$(q -c "SELECT coalesce((SELECT value::text FROM site_settings WHERE key='acquisition.afl_api_current_season_enabled'),'(absent)')")"
  echo "PRE PASS"
  ;;
migrate)
  R=${1:?R}
  step "M1 migrate: migration 118 only"
  clean_at "$R"; no_writers
  [ "$(git -C "$R_CHK" show "$R:src/db/migrations/$MIG118" | sha256sum | cut -c1-64)" = "$MIG118_SHA" ] || stop "migration 118 bytes differ from the approved sha256" 3
  [ "$(sha256sum < "$R_CHK/src/db/migrations/$MIG118" | cut -c1-64)" = "$MIG118_SHA" ] || stop "checked-out migration 118 differs from the approved sha256" 3
  # The owner DSN is used by the migrate child alone (AFLDB_PROD_DATABASE_URL is not kept in .env).
  hs_parse_dsn AFLDB_OWNER_DATABASE_URL afldb_owner; prod_url=$HS_DSN; want_target=$HS_SAFE_TARGET; unset PGPASSWORD HS_DSN
  mig() { ( cd "$R_CHK" && AFLDB_PROD_DATABASE_URL=$prod_url "$NODE" --import tsx tools/db/migrate.ts --target prod "$@" ); }
  LOGD=${M_LOG_DIR:?M_LOG_DIR (a new directory outside the checkout) is required}; mkdir -m 700 "$LOGD" 2>/dev/null || [ -d "$LOGD" ] || stop "cannot create $LOGD" 3
  [ ! -e "$LOGD/migrate.log" ] || stop "migrate already ran in this log directory; a retry is never automatic" 6
  mig --status > "$LOGD/status-before.txt" 2>&1 || { cat "$LOGD/status-before.txt"; stop "migrate --status failed" 7; }
  grep -qxF "AFLDB migrations -> prod ($want_target)" "$LOGD/status-before.txt" || { cat "$LOGD/status-before.txt"; stop "migrate did not resolve the identity-checked owner target" 7; }
  pending=$(grep -oE 'PENDING  [0-9]{3}_[A-Za-z0-9_]+\.sql' "$LOGD/status-before.txt" | awk '{print $2}' | paste -sd' ')
  echo "pending: $pending"
  [ "$pending" = "$MIG118" ] || stop "pending set is not exactly $MIG118; nothing applied" 7
  mig > "$LOGD/migrate.log" 2>&1; x=$?; cat "$LOGD/migrate.log"
  [ "$x" = 0 ] || stop "migrate exited $x: the migration is one transaction, so a failure rolled back; keep the log, run readback, do not retry" 7
  mig --status > "$LOGD/status-after.txt" 2>&1 || stop "migrate --status after failed" 7
  unset prod_url
  grep -qx '0 pending.' "$LOGD/status-after.txt" || stop "pending migrations remain" 7
  echo "MIGRATE PASS (run readback)"
  ;;
readback)
  step "readback: ledger 118 and the schema it must have produced (afldb_backup, read-only)"
  backup_identity
  ledger_is 118 "$MIG118" "$L118_DIGEST"
  [ "$(ledger | tail -1 | cut -f2)" = "$MIG118_SHA" ] || stop "stored checksum of 118 differs from the approved sha256" 5
  C=$(q -c "SELECT string_agg(column_name||':'||is_nullable||':'||coalesce(column_default,''), ' | ' ORDER BY column_name) FROM information_schema.columns WHERE table_name='fixtures' AND table_schema='public' AND column_name IN ('confirmation','home_placeholder','away_placeholder','home_club_id','away_club_id')")
  echo "columns: $C"
  [ "$C" = "away_club_id:YES: | away_placeholder:YES: | confirmation:NO:'confirmed'::text | home_club_id:YES: | home_placeholder:YES:" ] || stop "fixtures columns differ from migration 118's intent" 5
  K=$(q -c "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.fixtures'::regclass AND conname IN ('fixtures_confirmation_ck','fixtures_home_participant_ck','fixtures_away_participant_ck')")
  [ "$K" = "fixtures_away_participant_ck,fixtures_confirmation_ck,fixtures_home_participant_ck" ] || stop "constraints differ: $K" 5
  [ "$(q -c "SELECT count(*) FROM fixtures WHERE confirmation<>'confirmed' OR home_club_id IS NULL OR away_club_id IS NULL OR home_placeholder IS NOT NULL OR away_placeholder IS NOT NULL")" = 0 ] || stop "an existing fixture is not confirmed with both clubs" 5
  P=$(q -c "SELECT has_column_privilege('afldb_import','public.fixtures','confirmation','INSERT')::text||','||has_column_privilege('afldb_import','public.fixtures','home_placeholder','UPDATE')::text||','||has_column_privilege('afldb_app','public.fixtures','confirmation','SELECT')::text")
  [ "$P" = "true,true,true" ] || stop "writer/reader column privileges on the new columns: $P (privileges.sql was NOT part of this approval)" 5
  echo "ledger118_digest=$L118_DIGEST fixtures_rows=$(q -c 'SELECT count(*) FROM fixtures') matches_rows=$(q -c 'SELECT count(*) FROM matches')"
  echo "READBACK PASS"
  ;;
window-stage)
  LABEL=${1:?snapshot dir name}; FEED=${2:?feed sha256}
  [[ $LABEL =~ ^[A-Za-z0-9_-]+$ ]] && [[ $FEED =~ ^[0-9a-f]{64}$ ]] || stop "bad snapshot label or feed hash" 2
  D="$R_CHK/data/sources/afl_api/fixtures/$LABEL"
  step "window-stage: staged snapshot bytes"
  [ -d "$D" ] || stop "snapshot directory $D is not staged" 3
  [ "$(ls "$D" | wc -l)" = 2 ] && [ -f "$D/00-season-matches.json" ] && [ -f "$D/manifest.json" ] || stop "snapshot directory must hold exactly 00-season-matches.json and manifest.json" 3
  [ "$(sha256sum < "$D/00-season-matches.json" | cut -c1-64)" = "$FEED" ] || stop "feed sha256 differs from the approved value" 3
  echo "WINDOW-STAGE PASS manifest_sha256=$(sha256sum < "$D/manifest.json" | cut -c1-64)"
  ;;
window)
  MODE=${1:?check|run|restore}
  cd "$R_CHK" || stop "no checkout" 3
  if [ "$MODE" = restore ]; then
    EV=${2:?evidence dir}; [ -d "$EV" ] || stop "evidence dir does not exist" 2
    "$NODE" --import tsx tools/current-season/afl-api-fixture-window.ts --restore-only --evidence-dir "$EV"; exit $?
  fi
  R=${2:?R}; LABEL=${3:?snapshot}; FEED=${4:?feed sha}; EV=${5:?new evidence dir}; DECISION=${6:?owner approval reference}
  [ "${#DECISION}" -ge 20 ] || stop "decision reference must be 20+ characters (the owner's words)" 2
  case "$EV" in "$R_CHK"/*) stop "evidence dir must be outside the checkout" 2;; esac
  clean_at "$R"; no_writers
  bash "$0" window-stage "$LABEL" "$FEED" || exit $?
  ARGS=(--label "$LABEL" --expect-initial absent --expect-created 218 --expect-feed-sha256 "$FEED" --decision "$DECISION" --evidence-dir "$EV" --max-minutes 15)
  if [ "$MODE" = check ]; then
    step "window --check-only (writes nothing)"; "$NODE" --import tsx tools/current-season/afl-api-fixture-window.ts "${ARGS[@]}" --check-only; exit $?
  fi
  [ "$MODE" = run ] || stop "mode must be check, run or restore" 2
  step "window RUN (deadline 15 min); exit 0 CLEAR is the only success"
  "$NODE" --import tsx tools/current-season/afl-api-fixture-window.ts "${ARGS[@]}"; x=$?
  echo "WINDOW EXIT $x (0 CLEAR; 1 HALT restored+verified; 2 refused before any write; 3 RESTORATION NOT VERIFIED -> run: bash m-prod.sh window restore $EV)"
  exit "$x"
  ;;
*) stop "unknown phase" 2 ;;
esac
}
