#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), step (a): the FIRST SCHEDULED off-host pull (cron r3, 03:10 Melbourne) on STREAMANATOR,
# as arm. READ-ONLY: reads arm's crontab, the wrapper's log, the off-host directory and re-hashes the named dump; writes nothing,
# connects to nothing (no production contact).
#   Run (workstation Git Bash): tr -d '\r' < r6-offhost-verify.sh | ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100 bash -s -- <DUMP_NAME> <DUMP_SHA256>
#   <DUMP_NAME> / <DUMP_SHA256>: the scheduled 02:2x dump and its sidecar sha256 as printed by r6-pre-verify.sh on production.
# PASS needs: the r3 marker + line in the crontab; an "rc=0" line in offhost-pull.log stamped today 03:10-03:45 Melbourne; the
# named dump present with a one-line sidecar naming it, its .verified-<dump> marker, and its recomputed sha256 = the sidecar =
# <DUMP_SHA256>; no retention hold. Prints "OFFHOST-COMPARE <dump> <sha256>" in the same shape as r6-pre-verify.sh on production:
# the two lines must be identical (runbook GO item GO-3).
# Command inventory (closure allowlist): crontab -l, grep, awk, sed, tail, cut, wc, ls, stat, sha256sum, date, hostname, id, printf,
#   echo, test; redirections only 2>/dev/null and here-strings; no write, no network.
set -uo pipefail; export LC_ALL=C
D=${1:?DUMP_NAME}; S=${2:?DUMP_SHA256}
[[ $D =~ ^afldb_prod-[0-9]{8}-[0-9]{6}\.dump$ ]] && [[ $S =~ ^[0-9a-f]{64}$ ]] || { echo "STOP bad arguments"; exit 2; }
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}; DEST=${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}; CRONTAB_BIN=${CRONTAB_BIN:-/usr/bin/crontab}
F=0; ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; F=$((F+1)); }; info() { echo "INFO $*"; }
DAY=$(TZ=Australia/Melbourne date +%F)
w0=$(TZ=Australia/Melbourne date -d "$DAY 03:10" +%s); w1=$(TZ=Australia/Melbourne date -d "$DAY 03:45" +%s)
echo "== R6 OFFHOST $(date -u +%FT%TZ) ($(TZ=Australia/Melbourne date '+%a %F %H:%M %Z')) host=$(hostname) user=$(id -un) dump=$D"
CT=$("$CRONTAB_BIN" -l 2>/dev/null) || CT=''
printf '%s\n' "$CT" | grep -A1 '^# AFLDB-A2-r3' | grep -q '^10 3 \* \* \* AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh$' \
  && ok "cron r3 installed (marker + line)" || bad "cron r3 line not found"
L=$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z rc=' "$OPS/state/offhost-pull.log" 2>/dev/null | while read -r st rc; do
  e=$(date -d "$st" +%s 2>/dev/null || echo 0); [ "$e" -ge "$w0" ] && [ "$e" -le "$w1" ] && echo "$st $rc"; done | tail -n 1)
[ -n "$L" ] && info "scheduled pull today: $L" || bad "no offhost-pull.log rc line stamped today 03:10-03:45 Melbourne"
[ "${L##* }" = rc=0 ] && ok "scheduled pull rc=0" || bad "scheduled pull result '${L##* }'"
grep -q "verified $D\$" "$OPS/state/offhost-pull.log" 2>/dev/null && ok "log says: verified $D" || bad "log has no 'verified $D'"
[ -s "$DEST/$D" ] && ok "dump present $(stat -c '%s B %y' "$DEST/$D" | cut -c1-40)" || bad "dump $DEST/$D missing"
[ -e "$DEST/.verified-$D" ] && ok ".verified-$D present" || bad ".verified-$D missing"
if [ -f "$DEST/$D.sha256" ]; then
  [ "$(wc -l < "$DEST/$D.sha256")" = 1 ] && [ "$(awk '{sub(/^\*/,"",$2); print $2}' "$DEST/$D.sha256")" = "$D" ] && ok "sidecar is one line naming the dump" || bad "sidecar shape wrong"
  SC=$(cut -d' ' -f1 "$DEST/$D.sha256"); A=$(sha256sum < "$DEST/$D" | cut -d' ' -f1)
  [ "$SC" = "$S" ] && ok "sidecar sha256 = production's ($S)" || bad "sidecar $SC != production $S"
  [ "$A" = "$S" ] && ok "recomputed sha256 = production's" || bad "recomputed $A != production $S"
  echo "OFFHOST-COMPARE $D $A"
else bad "sidecar $DEST/$D.sha256 missing"; fi
[ -e "$DEST/.retention-hold" ] && bad "retention hold present (review per F-07)" || ok "no retention hold"
info "verified dumps held: $(ls -1 "$DEST"/.verified-*.dump 2>/dev/null | wc -l); quarantine entries: $(ls -1 "$DEST/quarantine" 2>/dev/null | wc -l)"
info "alarms.log entries: $(grep -c '^---$' "$OPS/state/alarms.log" 2>/dev/null || echo 0); newest: $(grep '^AFLDB ' "$OPS/state/alarms.log" 2>/dev/null | tail -n 1 | cut -c1-120)"
echo; [ $F = 0 ] && echo "R6 OFFHOST RESULT PASS" || { echo "R6 OFFHOST RESULT STOP ($F)"; exit 1; }
