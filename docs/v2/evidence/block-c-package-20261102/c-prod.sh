:
{
# Block C (ISSUE-316 C3, C4b, C5) production-side READ-ONLY phases. Run as `arm` on afldb-prod, one phase per call, from the package extracted from the approved revision.
# Nothing here installs, enables, starts, restarts, edits `.env`, writes a database row or uses sudo: the install, the enablement and the restart are the owner's commands
# in the package document. This script only proves, before and after each of them, the state that document assumes. DEV (streamanator) timers are a separate decision and
# are never inspected or changed here: the host check below refuses anything that is not afldb-prod.
#   bash c-prod.sh c3-pre    <R>                  before the owner's install: pinned files, units absent/inert, setting off, AFL Tables timer disabled
#   bash c-prod.sh c3-accept <R>                  after the install: loaded/inactive services, disabled/inactive timers, installed copies equal the repository files; runs twice, a minute apart
#   bash c-prod.sh c4b-pre   <R> <feed-file>      before the D1 rehearsal (D-316-13): M-a complete, units inert, register [2027], switch retired, retained feed hash, readiness REPOSITORY READY
#   bash c-prod.sh c5-pre    <R> <c4b-evidence-dir>   before C5 (D-316-4): the C4b CLEAR record, before the first 2027 match, Brownlow timer disabled, no trigger variable yet
#   bash c-prod.sh c5-env    <R>                  after the owner's one-line .env edit: exactly one AFLDB_SETTLE_TRIGGER=systemd line and no other variant
#   bash c-prod.sh c5-accept <R>                  after the owner's enable: match timer enabled+active, Brownlow and AFL Tables timers disabled+inactive, setting true
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD HS_DSN; echo "STOP: $1"; exit "${2:-1}"; }

PHASE=${1:?phase}; shift
CHK=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432
EXPECT_SYSID=7674454702926115004; EXPECT_OID=66668
MIG118=118_fixtures_unconfirmed_participants.sql
L118_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57
FEED_SHA=21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d
FIRST_2027_MATCH_UTC=2027-03-17T00:00:00Z
SETTING_KEY=acquisition.afl_api_current_season_enabled
SVC="afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service"
TMR="afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer"
PINS="afldb-settle-afl-api.service:8698b6860ddf530b4954f0cbd585acddf38d12ec2a0436d1553d85ae7471b7f4
afldb-settle-afl-api.timer:a37114b44eab72d4bc85e15f059a6d7f837f0d503b07f4e0c9934e39bac2a2c2
afldb-settle-afl-api-brownlow.service:55b0a70b8aba516e48231f4fb8ad1576b7c1c1579218b03e9f9bcd6915e7b402
afldb-settle-afl-api-brownlow.timer:7fa27377516ce9ea86400542166788727179effbd1b2692397506b3a42903bb1
afldb-settle-afl-api.sh:b35e3a321a2c276ee4ff0b3f1cfed4dce4afcdfef78d1d7f41e6eb3ef142aeeb
afldb-settle-afl-api-brownlow.sh:05a559be858633ddbbf099ec4fcd809a5b8fbf0116c2ce83ae6477f73efff9b1"
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user (this package is for afldb-prod only; DEV is a separate decision)" 3

hs_parse_dsn() { # key role ; PG* for this process only, identity checked, value never printed
  local key=$1 role=$2 envf="$CHK/.env" line pwenc
  [ -r "$envf" ] || stop "env file unreadable" 2
  [ "$(grep -c "^$key=" "$envf")" = 1 ] || stop "$key must appear exactly once in .env" 2
  line=$(sed -n "s/^$key=//p" "$envf" | sed 's/^"\(.*\)"$/\1/'); [ -n "$line" ] || stop "$key empty" 2
  local re='^(postgres|postgresql)://([^:@/]+):([^@]*)@([^/:?]+)(:([0-9]+))?/([^?/]+)$'
  [[ "$line" =~ $re ]] || { unset line; stop "$key has an unexpected form (value not printed)" 2; }
  PGUSER=${BASH_REMATCH[2]}; pwenc=${BASH_REMATCH[3]}; PGHOST=${BASH_REMATCH[4]}; PGPORT=${BASH_REMATCH[6]:-5432}; PGDATABASE=${BASH_REMATCH[7]}
  [ -n "$pwenc" ] || stop "$key has no password (value not printed)" 2
  PGPASSWORD=$(printf '%b' "${pwenc//\%/\\x}"); unset pwenc line BASH_REMATCH
  [ "$PGUSER" = "$role" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DSN_HOST" ] && [ "$PGPORT" = "$EXPECT_DSN_PORT" ] \
    || stop "$key is not $role@$EXPECT_DSN_HOST:$EXPECT_DSN_PORT/$EXPECT_DB" 2
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-blockc-read "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
backup_identity() {
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  local ident; ident=$(q -c "SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()), current_setting('transaction_read_only')") || stop "identity query failed" 5
  [ "$ident" = "$(printf '%s\t%s\t%s\ton' "$EXPECT_DB" "$EXPECT_OID" "$EXPECT_SYSID")" ] || stop "identity differs from the reviewed target: $ident" 5
  echo "identity ok (afldb_prod, OID $EXPECT_OID, read-only session)"
}
clean_at() {
  [[ $1 =~ ^[0-9a-f]{40}$ ]] || stop "not a 40-hex revision: $1" 2
  [ "$(git -C "$CHK" rev-parse HEAD)" = "$1" ] || stop "checkout HEAD is $(git -C "$CHK" rev-parse HEAD), expected $1" 3
  [ -z "$(git -C "$CHK" status --porcelain)" ] || stop "checkout has changes" 3
  echo "checkout is exactly $1 and clean"
}
ledger_118() {
  local l rows last dig; l=$(q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"") || stop "ledger query failed" 5
  rows=$(printf '%s\n' "$l" | wc -l); last=$(printf '%s\n' "$l" | tail -1 | cut -f1); dig=$(printf '%s\n' "$l" | sha256sum | cut -c1-64)
  echo "ledger rows=$rows last=$last digest=$dig"
  [ "$rows" = 118 ] && [ "$last" = "$MIG118" ] && [ "$dig" = "$L118_DIGEST" ] || stop "ledger is not the 118 state (Block M-a must be complete)" 5
}
setting_raw() { q -c "SELECT value::text FROM site_settings WHERE key = '$SETTING_KEY'" || stop "setting read failed" 5; }
setting_is_off() { local v; v=$(setting_raw); echo "setting $SETTING_KEY = [${v:-(absent)}]"; case "$v" in ""|false|'"false"') ;; *) stop "the AFL API switch is not absent/false" 5;; esac; }
sc_load() { systemctl show -p LoadState --value "$1" 2>/dev/null; }
sc_active() { systemctl show -p ActiveState --value "$1" 2>/dev/null; }
sc_enabled() { systemctl is-enabled "$1" 2>/dev/null; }
afltables_timer_off() {
  local e a; e=$(sc_enabled afldb-settle-afltables.timer); a=$(sc_active afldb-settle-afltables.timer)
  echo "afldb-settle-afltables.timer enabled=[$e] active=[$a]"
  case "$e" in disabled|masked|not-found|"") ;; *) stop "the AFL Tables timer is enabled: the cutover boundary is not as recorded" 4;; esac
  case "$a" in inactive|failed|"") ;; *) stop "the AFL Tables timer is active" 4;; esac
}
units_inert() { # mode: absent | installed
  local u l a e mode=$1
  for u in $SVC; do
    l=$(sc_load "$u"); a=$(sc_active "$u"); echo "$u load=[$l] active=[$a]"
    if [ "$mode" = absent ]; then [ "$l" = not-found ] || stop "$u is present before the install" 4; else [ "$l" = loaded ] || stop "$u is not loaded" 4; fi
    [ "$a" = inactive ] || stop "$u is not inactive" 4
  done
  for u in $TMR; do
    e=$(sc_enabled "$u"); a=$(sc_active "$u"); echo "$u enabled=[$e] active=[$a]"
    if [ "$mode" = absent ]; then case "$e" in not-found|"") ;; *) stop "$u is present before the install" 4;; esac
    else [ "$e" = disabled ] || stop "$u is not disabled (inert install violated)" 4; fi
    case "$a" in inactive|"") ;; *) stop "$u is active" 4;; esac
  done
}
pins_at_checkout() {
  local line f h
  while IFS= read -r line; do f=${line%%:*}; h=${line##*:}
    [ -f "$CHK/deploy/$f" ] && [ "$(sha256sum < "$CHK/deploy/$f" | cut -c1-64)" = "$h" ] || stop "deploy/$f is not the pinned bytes" 3
  done <<EOF
$PINS
EOF
  echo "the six pinned deploy files equal their hashes"
}
before_first_match() { [ "$(date -u +%s)" -lt "$(date -u -d "$FIRST_2027_MATCH_UTC" +%s)" ] || stop "the first 2027 match time ($FIRST_2027_MATCH_UTC) has passed" 4; echo "now is before $FIRST_2027_MATCH_UTC"; }

case "$PHASE" in
c3-pre)
  R=${1:?R}; step "c3-pre"
  clean_at "$R"; pins_at_checkout; backup_identity; setting_is_off
  units_inert absent; afltables_timer_off
  [ -z "$(ls /etc/systemd/system/afldb-settle-afl-api* 2>/dev/null)" ] || stop "an installed AFL API unit file already exists under /etc/systemd/system" 4
  sh -n "$CHK/deploy/afldb-settle-afl-api.sh" && sh -n "$CHK/deploy/afldb-settle-afl-api-brownlow.sh" && echo "sh -n ok for both scripts"
  echo "C3-PRE PASS"
  ;;
c3-accept)
  R=${1:?R}; step "c3-accept (twice, a minute apart)"
  clean_at "$R"; pins_at_checkout; backup_identity
  for pass in 1 2; do
    echo "-- pass $pass"
    units_inert installed; setting_is_off
    for f in afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do
      [ -f "/etc/systemd/system/$f" ] && [ "$(sha256sum < "/etc/systemd/system/$f" | cut -c1-64)" = "$(sha256sum < "$CHK/deploy/$f" | cut -c1-64)" ] || stop "installed /etc/systemd/system/$f differs from the repository file" 4
    done
    echo "installed copies equal the repository files"; afltables_timer_off
    [ "$pass" = 2 ] || sleep 60
  done
  echo "C3-ACCEPT PASS"
  ;;
c4b-pre)
  R=${1:?R}; FEED=${2:?feed file}; step "c4b-pre (D-316-13)"
  clean_at "$R"; backup_identity; ledger_118; setting_is_off; units_inert installed; afltables_timer_off; before_first_match
  [ -f "$FEED" ] && [ "$(sha256sum < "$FEED" | cut -c1-64)" = "$FEED_SHA" ] || stop "the retained 2027 feed is missing or not the pinned bytes ($FEED_SHA)" 3
  "$NODE" -e '
const fs = require("fs"); const reg = JSON.parse(fs.readFileSync(process.argv[1] + "/data/reference/seasons.json", "utf8"));
const net = JSON.parse(fs.readFileSync(process.argv[1] + "/data/reference/afltables-network.json", "utf8"));
const ok = JSON.stringify(reg.in_progress_seasons) === "[2027]" && net.status === "retired";
console.log("in_progress_seasons=" + JSON.stringify(reg.in_progress_seasons) + " afltables-network status=" + net.status);
process.exit(ok ? 0 : 1);' "$CHK" || stop "the register is not exactly [2027] or the AFL Tables switch is not retired" 5
  echo "the C4b evidence directory must not exist yet (the tool refuses an existing one)"
  step "readiness (read-only, offline)"
  ( cd "$CHK" && "$NODE" --import tsx tools/current-season/afl-api-cutover-readiness.ts --season 2027 --season-feed "$FEED" ) 2>&1 | tee /tmp/blockc-readiness-$$.txt | tail -15
  grep -q "REPOSITORY READY" /tmp/blockc-readiness-$$.txt || { rm -f /tmp/blockc-readiness-$$.txt; stop "readiness is not REPOSITORY READY" 5; }
  rm -f /tmp/blockc-readiness-$$.txt
  echo "C4B-PRE PASS"
  ;;
c5-pre)
  R=${1:?R}; EVD=${2:?c4b evidence dir}; step "c5-pre (D-316-4)"
  clean_at "$R"; backup_identity; ledger_118; setting_is_off; units_inert installed; afltables_timer_off; before_first_match
  [ -f "$EVD/result.json" ] || stop "no C4b result.json in $EVD" 3
  "$NODE" -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1] + "/result.json", "utf8"));
console.log("C4b result: verdict=" + r.verdict + " decision=" + (r.decision ?? "?") + " season=" + (r.season ?? "?"));
process.exit(r.verdict === "CLEAR" ? 0 : 1);' "$EVD" || stop "the C4b record is not a CLEAR" 5
  n=$(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env"); echo "AFLDB_SETTLE_TRIGGER lines in .env: $n"; [ "$n" = 0 ] || stop "the trigger variable already exists in .env" 5
  echo "C5-PRE PASS (the owner's steps follow in the package document)"
  ;;
c5-env)
  R=${1:?R}; step "c5-env"
  clean_at "$R"
  a=$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' "$CHK/.env"); b=$(grep -c 'AFLDB_SETTLE_TRIGGER' "$CHK/.env"); echo "exact lines=$a any mention=$b"
  [ "$a" = 1 ] && [ "$b" = 1 ] || stop "expected exactly one AFLDB_SETTLE_TRIGGER=systemd line and no other variant or comment" 5
  echo "C5-ENV PASS (the effective-environment read-back needs the owner or sudo)"
  ;;
c5-accept)
  R=${1:?R}; step "c5-accept"
  clean_at "$R"; backup_identity
  v=$(setting_raw); echo "setting $SETTING_KEY = [${v:-(absent)}]"; case "$v" in true|'"true"') ;; *) stop "the AFL API switch is not true" 5;; esac
  e=$(sc_enabled afldb-settle-afl-api.timer); a=$(sc_active afldb-settle-afl-api.timer); echo "afldb-settle-afl-api.timer enabled=[$e] active=[$a]"
  [ "$e" = enabled ] && [ "$a" = active ] || stop "the match timer is not enabled and active" 4
  e=$(sc_enabled afldb-settle-afl-api-brownlow.timer); a=$(sc_active afldb-settle-afl-api-brownlow.timer); echo "afldb-settle-afl-api-brownlow.timer enabled=[$e] active=[$a]"
  [ "$e" = disabled ] && [ "$a" = inactive ] || stop "the Brownlow timer is not disabled and inactive" 4
  afltables_timer_off
  echo "C5-ACCEPT PASS"
  ;;
*) stop "unknown phase" 2 ;;
esac
}
