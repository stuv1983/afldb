#!/bin/bash
# ISSUE-316 C5 (D-316-4): READ-ONLY observation phases for the owner-attended window, as `arm`, no sudo. Starts/enables/edits/restarts/writes NOTHING.
#   bash c5-observe.sh env-effective   <N>   after the owner's restart: new MainPID started after the .env edit; exactly one AFLDB_SETTLE_TRIGGER=systemd in the PROCESS environment
#   bash c5-observe.sh toggle          <N>   after the owner's admin toggle: setting true; exactly one new admin-attributed audit row; Brownlow switch untouched
#   bash c5-observe.sh timer           <N>   after `enable --now` of the match timer: enabled+active with a future next elapse; Brownlow and AFL Tables timers off; nothing running
#   bash c5-observe.sh first-run       <N>   after the first scheduled firing (05:00-05:15 AEDT): the run's unit result and the batch it retained (informational + checked)
#   bash c5-observe.sh rollback-verify <N>   after the rollback steps: timer off, setting false, no .env mention, process environment clean, nothing running
# Each phase ends `C5-OBSERVE <PHASE> PASS` (exit 0) or `C5-OBSERVE <PHASE> FAIL` (exit 1). A failed read or a value that is not the expected one FAILS the phase; it is a finding, never auto-corrected.
set -u -o pipefail
export LC_ALL=C
umask 077
PHASE=${1:?phase}; N=${2:?N (40 hex)}
[[ $N =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: N must be 40 lowercase hex"; exit 2; }
CHK=/home/arm/projects/afldb
CPROD_REL=docs/v2/evidence/block-c-package-20261102/c-prod.sh
CPROD_SHA=ec839a47b645a61561ef885c1a5d1926be2e864fe3e557ec254553c6a031d496
P=$CHK/$CPROD_REL
ROOT=/home/arm/afldb-releases; SERVING_ID=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6
BASE_PID=3268373; BASE_ENTER_MONO=6739446504275       # the serving process before C5 (13:18:50 AEDT); a restart must change both
KEY=acquisition.afl_api_current_season_enabled; BKEY=acquisition.afl_api_brownlow_enabled
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user (afldb-prod, as arm)"; exit 3; }
[ "$(git -C "$CHK" rev-parse HEAD)" = "$N" ] || { echo "STOP: checkout HEAD is not $N"; exit 3; }
[ "$(sha256sum < "$P" | cut -c1-64)" = "$CPROD_SHA" ] || { echo "STOP: c-prod.sh is not the pinned bytes"; exit 3; }
set -- x
# shellcheck disable=SC1090
source <(sed -n '14,18p;20,75p' "$P")
type backup_identity > /dev/null 2>&1 && type q > /dev/null 2>&1 || { echo "STOP: the packaged reader definitions did not load"; exit 3; }
trap 'unset PGPASSWORD' EXIT
FAILS=0; V=
sc() { local out s; out=$(q -c "$2" 2>&1); s=$?
  if [ $s -ne 0 ] || [[ $out == *"ERROR:"* ]]; then echo "QUERY FAILED [$1] exit=$s: $out"; FAILS=$((FAILS + 1)); V='<FAILED>'; return 0; fi; V=$out; }
eq() { echo "$1 = [$2] (expected [$3])"; [ "$2" = "$3" ] || { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }; }
sceq() { sc "$1" "$2"; eq "$1" "$V" "$3"; }
finish() { if [ "$FAILS" -eq 0 ]; then echo "C5-OBSERVE $PHASE PASS"; exit 0; fi; echo "C5-OBSERVE $PHASE FAIL ($FAILS check(s) failed; a finding for review, nothing was changed)"; exit 1; }
PID=$(systemctl show -p MainPID --value afldb)
penv() { tr '\0' '\n' < "/proc/$PID/environ" 2>/dev/null | grep -c "$1" || true; }
echo "== c5-observe $PHASE $(date -u +%FT%TZ) N=$N (host local $(date '+%F %T %Z'))"
backup_identity

case "$PHASE" in
env-effective)
  ENTER_MONO=$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)
  echo "afldb MainPID=$PID (before C5: $BASE_PID) ActiveEnterMonotonic=$ENTER_MONO (before: $BASE_ENTER_MONO) ActiveEnterTimestamp=$(systemctl show -p ActiveEnterTimestamp --value afldb)"
  [ "$PID" != "$BASE_PID" ] && [ "$ENTER_MONO" != "$BASE_ENTER_MONO" ] && echo "restarted: new MainPID and new ActiveEnter" || { echo "FAIL: afldb has not been restarted since the baseline"; FAILS=$((FAILS + 1)); }
  ENV_M=$(stat -c %Y "$CHK/.env"); START_E=$(date -d "$(systemctl show -p ActiveEnterTimestamp --value afldb)" +%s)
  echo ".env mtime epoch=$ENV_M; service active-enter epoch=$START_E"; [ "$START_E" -ge "$ENV_M" ] || { echo "FAIL: the service started BEFORE the .env edit"; FAILS=$((FAILS + 1)); }
  eq ".env lines exactly AFLDB_SETTLE_TRIGGER=systemd" "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' "$CHK/.env" || true)" 1
  eq ".env any mention" "$(grep -c 'AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)" 1
  eq ".env stat (perm owner size): 4067 before + 29 bytes (one AFLDB_SETTLE_TRIGGER=systemd line) = 4096, nothing else added" "$(stat -c '%a %U %s' "$CHK/.env")" "600 arm 4096"
  eq "MainPID cwd is the serving release" "$(readlink "/proc/$PID/cwd")" "$ROOT/releases/$SERVING_ID"
  if [ -r "/proc/$PID/environ" ]; then
    eq "process env: exact AFLDB_SETTLE_TRIGGER=systemd" "$(penv '^AFLDB_SETTLE_TRIGGER=systemd$')" 1
    eq "process env: any AFLDB_SETTLE_TRIGGER" "$(penv '^AFLDB_SETTLE_TRIGGER')" 1
  else echo "FAIL: the serving process environment is not readable as arm (the owner reads it: tr '\\0' '\\n' < /proc/$PID/environ | grep -c '^AFLDB_SETTLE_TRIGGER=systemd\$')"; FAILS=$((FAILS + 1)); fi
  eq "health" "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)" 200
  eq "switch still false before the toggle" "$(setting_raw)" false
  finish ;;
toggle)
  sceq "setting stored value" "SELECT value::text FROM site_settings WHERE key = '$KEY'" true
  sceq "setting rows" "SELECT count(*) FROM site_settings WHERE key = '$KEY'" 1
  sceq "setting updated_by is an admin user (not NULL)" "SELECT (updated_by IS NOT NULL)::text FROM site_settings WHERE key = '$KEY'" true
  sceq "new ingestion-switch audit rows after id 304" "SELECT count(*) FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set' AND id > 304" 1
  sceq "that row: enabled true, attributed to an admin user (actor_user_id NOT NULL)" "SELECT concat_ws(',', detail->>'enabled', (actor_user_id IS NOT NULL)::text) FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set' AND id > 304" "true,true"
  sceq "that row is newer than the C4b restore (id 304) and its setting write" "SELECT (a.at >= s.updated_at - interval '5 seconds' AND a.at <= s.updated_at + interval '5 seconds')::text FROM auth_audit_log a, site_settings s WHERE a.action = 'current_season.afl_api_ingestion_set' AND a.id > 304 AND s.key = '$KEY'" true
  sceq "Brownlow admin switch rows (must stay absent: not part of C5)" "SELECT count(*) FROM site_settings WHERE key = '$BKEY'" 0
  sceq "Brownlow switch audit rows (must stay 0)" "SELECT count(*) FROM auth_audit_log WHERE action = 'current_season.afl_api_brownlow_ingestion_set'" 0
  eq "match timer still disabled (enabled only in the next step)" "$(systemctl is-enabled afldb-settle-afl-api.timer 2>&1)" disabled
  finish ;;
timer)
  eq "match timer is-enabled" "$(systemctl is-enabled afldb-settle-afl-api.timer 2>&1)" enabled
  eq "match timer ActiveState" "$(systemctl show -p ActiveState --value afldb-settle-afl-api.timer)" active
  NEXT=$(systemctl show -p NextElapseUSecRealtime --value afldb-settle-afl-api.timer); echo "next elapse: [$NEXT]"
  NE=$(date -d "$NEXT" +%s 2>/dev/null || echo 0); [ "$NE" -gt "$(date +%s)" ] || { echo "FAIL: no future next-elapse time"; FAILS=$((FAILS + 1)); }
  eq "Brownlow timer enabled/active" "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1)/$(systemctl show -p ActiveState --value afldb-settle-afl-api-brownlow.timer)" disabled/inactive
  eq "AFL Tables timer enabled/active" "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1)/$(systemctl show -p ActiveState --value afldb-settle-afltables.timer)" disabled/inactive
  eq "match service ActiveState (nothing running yet)" "$(systemctl show -p ActiveState --value afldb-settle-afl-api.service)" inactive
  eq "settle/acquire processes" "$(pgrep -fc '[s]ettle-afl-api|[a]cquire-afl-api' || true)" 0
  sceq "setting still true" "SELECT value::text FROM site_settings WHERE key = '$KEY'" true
  echo "afldb timers known to systemd:"; systemctl list-timers --all --no-pager 2>&1 | grep -i afldb | sed 's/^/    /'
  finish ;;
first-run)
  echo "service: Result=$(systemctl show -p Result --value afldb-settle-afl-api.service) ExecMainStatus=$(systemctl show -p ExecMainStatus --value afldb-settle-afl-api.service) ActiveState=$(systemctl show -p ActiveState --value afldb-settle-afl-api.service) InactiveEnter=$(systemctl show -p InactiveEnterTimestamp --value afldb-settle-afl-api.service)"
  eq "service Result of the last run" "$(systemctl show -p Result --value afldb-settle-afl-api.service)" success
  eq "ExecMainStatus" "$(systemctl show -p ExecMainStatus --value afldb-settle-afl-api.service)" 0
  echo "batches after id 75 (id, tool, started_at, completed_at or <NULL>, status, read/ins/upd/rej):"
  sc "batches after 75" "SELECT b.id, b.tool, b.started_at, COALESCE(b.completed_at::text,'<NULL>'), b.status, concat_ws('/', b.records_read, b.records_inserted, b.records_updated, b.records_rejected) FROM import_batches b WHERE b.id > 75 ORDER BY b.id"; printf '%s\n' "$V" | sed 's/^/    /'
  sceq "at least one completed settle-afl-api.ts batch after id 75 (the scheduled run retained one)" "SELECT (count(*) >= 1)::text FROM import_batches WHERE id > 75 AND tool = 'settle-afl-api.ts' AND status = 'completed'" true
  sceq "batches after 75 by settle-afl-api.ts that did not complete" "SELECT count(*) FROM import_batches WHERE id > 75 AND tool = 'settle-afl-api.ts' AND status <> 'completed'" 0
  sceq "canonical 2027 matches (no CONCLUDED match exists before 2027-03-17)" "SELECT count(*) FROM matches WHERE season = 2027" 0
  eq "match timer still enabled" "$(systemctl is-enabled afldb-settle-afl-api.timer 2>&1)" enabled
  finish ;;
rollback-verify)
  eq "match timer enabled/active" "$(systemctl is-enabled afldb-settle-afl-api.timer 2>&1)/$(systemctl show -p ActiveState --value afldb-settle-afl-api.timer)" disabled/inactive
  eq "Brownlow timer enabled/active" "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1)/$(systemctl show -p ActiveState --value afldb-settle-afl-api-brownlow.timer)" disabled/inactive
  eq "AFL Tables timer enabled/active" "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1)/$(systemctl show -p ActiveState --value afldb-settle-afltables.timer)" disabled/inactive
  eq "match service ActiveState" "$(systemctl show -p ActiveState --value afldb-settle-afl-api.service)" inactive
  eq "settle/acquire processes" "$(pgrep -fc '[s]ettle-afl-api|[a]cquire-afl-api' || true)" 0
  sceq "setting stored value" "SELECT COALESCE(value::text, '<absent>') FROM site_settings WHERE key = '$KEY'" false
  eq ".env any AFLDB_SETTLE_TRIGGER mention" "$(grep -c 'AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)" 0
  eq ".env stat (perm owner size): back to the pre-C5 600 arm 4067 (the file ended with a newline before)" "$(stat -c '%a %U %s' "$CHK/.env")" "600 arm 4067"
  echo "afldb MainPID=$PID ActiveEnterTimestamp=$(systemctl show -p ActiveEnterTimestamp --value afldb)"
  if [ -r "/proc/$PID/environ" ]; then eq "process env: any AFLDB_SETTLE_TRIGGER (0 only after the restart that follows the .env removal)" "$(penv '^AFLDB_SETTLE_TRIGGER')" 0
  else echo "FAIL: process environment not readable as arm"; FAILS=$((FAILS + 1)); fi
  eq "health" "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)" 200
  finish ;;
*) echo "STOP: unknown phase"; exit 2 ;;
esac
