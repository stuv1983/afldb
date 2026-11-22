#!/usr/bin/env bash
# Sitting A2: install (once), check or remove the two owner-approved streamanator cron jobs (owner decision 3 of 2026-11-22,
# round 3). STREAMANATOR, as arm. Never run on production. Never executes the wrappers it schedules.
#   r2  hourly settle-status pull check (ISSUE-332):  17 * * * *   ... afldb-settle-check.sh
#       precondition: the LAST line of state/settle-check.log is "<UTC stamp> rc=0 AFLDB_SETTLE_STATUS OK", at most 6 h old
#       (A2 R2 step 2, the first manual run, succeeded)
#   r3  daily off-host pull (ISSUE-352):              10 3 * * *   ... afldb-offhost-pull-daily.sh
#       precondition: the newest <dest>/afldb_prod-*.dump has a one-line sidecar that verifies, its .verified-<dump> marker, and
#       the first-copy restore log state/a2-firstcopy-restore.log names that dump with "pg_restore exit=0" and
#       "FIRSTCOPY RESULT RESTORE PASS" (A2 R3 steps 11-12)
# Usage: bash a2-cron-install.sh check|install|remove r2|r3 [--dry-run]    (check also accepts --require-installed)
#   check    read-only: preconditions + installed state; never writes. ISSUE-352: the exit status is accurate. 0 = every
#            precondition PASS (and, with --require-installed, the exact marker + job pair is present); 1 = a precondition
#            FAILED (the printed PRECONDITIONS FAIL line is no longer exit 0); 6 = preconditions pass but the pair is absent
#            and --require-installed was given
#   install  one marker comment + one job line appended; a re-run with the identical pair present = "ALREADY INSTALLED", exit 0;
#            a marker with a different line, or the wrapper scheduled without the marker = STOP (exit 3)
#   remove   removes exactly the marker + job pair (the leave is six weeks: the documented way back)
# Safety (reviewer F-001/F-002): crontab path from CRONTAB_BIN (default /usr/bin/crontab; PATH is never reset); STOP when
# `crontab -l` fails or returns fewer lines than the recorded baseline (24 on 2026-11-22); a 0600 pre-image backup is kept in
# state/; a missing final newline is added before appending; after writing, the installed crontab must equal the intended
# text byte for byte, else the pre-image is restored and the run STOPs (exit 4).
# The alarm command is the executable path (the sender is bash; `/bin/sh alarm-email.sh` cannot run it): see ATTENDED-PLAN §4.6.
set -euo pipefail; export LC_ALL=C; umask 077
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
CRONTAB_BIN=${CRONTAB_BIN:-/usr/bin/crontab}
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
DEST=${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}
MIN_LINES=${AFLDB_CRON_MIN_LINES:-24}
EXPECT_HOST=${AFLDB_CRON_EXPECT_HOST:-streamanator}
MODE=${1:?check|install|remove}; JOB=${2:?r2|r3}; DRY=${3:-}
[[ $MODE =~ ^(check|install|remove)$ ]] || { echo "STOP mode"; exit 2; }
[ -z "$DRY" ] || [ "$DRY" = --dry-run ] || [ "$DRY" = --require-installed ] || { echo "STOP third argument must be --dry-run or --require-installed"; exit 2; }
[ "$DRY" != --require-installed ] || [ "$MODE" = check ] || { echo "STOP --require-installed applies to check only"; exit 2; }
[ "$DRY" != --dry-run ] || [ "$MODE" != check ] || { echo "STOP --dry-run applies to install|remove only"; exit 2; }
ALARM='AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh'
case $JOB in
  r2) LINE="17 * * * * $ALARM /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh"
      PINS="c6467ff492afe0e1f28117baf5c4fa2a38edaf8e8f13bf3cacd72ef22b224896  $OPS/afldb-settle-check.sh"
      WRAP=afldb-settle-check.sh; WHAT="ISSUE-332 hourly settle-status pull check";;
  r3) LINE="10 3 * * * $ALARM /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh"
      # pin of offhost-pull.sh changed ea48205a -> a3775aea (stamp read in Australia/Melbourne), A2 run 2026-11-22
      PINS="2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24  $OPS/afldb-offhost-pull-daily.sh
a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b  $OPS/offhost-pull.sh
d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e  $OPS/scheduled-pull-evidence.sh"
      WRAP=afldb-offhost-pull-daily.sh; WHAT="ISSUE-352 daily off-host pull";;
  *) echo "STOP job must be r2 or r3"; exit 2;;
esac
MARK="# AFLDB-A2-$JOB: $WHAT (owner decision 3, 2026-11-22); installed by a2-cron-install.sh"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "== A2 cron $MODE $JOB $STAMP host=$(hostname) user=$(id -un) crontab=$CRONTAB_BIN${DRY:+ ($DRY)}"
[ "$(hostname)" = "$EXPECT_HOST" ] && [ "$(id -un)" = arm ] || { echo "STOP not arm@$EXPECT_HOST"; exit 3; }

next_due() {   # Melbourne local time (cron runs in the system zone; recorded Australia/Melbourne on 2026-11-22)
  local now; now=$(date +%s)
  if [ "$JOB" = r2 ]; then
    local h; h=$(TZ=Australia/Melbourne date -d "@$now" +'%Y-%m-%d %H:17')
    local t; t=$(TZ=Australia/Melbourne date -d "$h" +%s); [ "$t" -gt "$now" ] || t=$((t + 3600))
    TZ=Australia/Melbourne date -d "@$t" +'%a %d %b %Y %H:%M %Z'
  else
    local d; d=$(TZ=Australia/Melbourne date -d "@$now" +'%Y-%m-%d 03:10')
    local t; t=$(TZ=Australia/Melbourne date -d "$d" +%s); [ "$t" -gt "$now" ] || t=$(TZ=Australia/Melbourne date -d "$d tomorrow" +%s)
    TZ=Australia/Melbourne date -d "@$t" +'%a %d %b %Y %H:%M %Z'
  fi
}

pre_ok=1
precheck() {
  local tz; tz=$(cat /etc/timezone 2>/dev/null || true)
  if [ "$tz" = Australia/Melbourne ]; then echo "PASS system timezone Australia/Melbourne (cron schedules are Melbourne local time)"; else echo "FAIL system timezone '$tz'"; pre_ok=0; fi
  if [ "$(systemctl is-active cron 2>/dev/null || true)" = active ]; then echo "PASS cron active"; else echo "FAIL cron not active"; pre_ok=0; fi
  # ISSUE-352: every pinned file is reported by name, so a missing helper or a mixed pair is visible, not just "differs".
  local pin_ok=1 want path
  while read -r want path; do
    [ -n "$want" ] || continue
    if [ ! -f "$path" ]; then echo "FAIL pinned file missing: $path"; pin_ok=0
    elif [ "$(sha256sum < "$path" | cut -d' ' -f1)" = "$want" ]; then echo "PASS pin ${want:0:8} ${path##*/}"
    else echo "FAIL pinned file differs from its pin ${want:0:8}: $path"; pin_ok=0; fi
  done <<< "$PINS"
  if [ "$pin_ok" = 1 ]; then echo "PASS wrapper pins: $(printf '%s\n' "$PINS" | awk '{print substr($1,1,8)}' | tr '\n' ' ')"; else echo "FAIL a wrapper or helper is missing or differs from its pin (install the pair with a2-helper-install.sh)"; pre_ok=0; fi
  if [ -x "$OPS/alarm-email.sh" ] && head -1 "$OPS/alarm-email.sh" | grep -qx '#!/usr/bin/env bash' && [ "$(stat -c %a "$OPS/alarm-smtp.env" 2>/dev/null)" = 600 ]; then
    echo "PASS alarm sender executable (bash shebang), alarm-smtp.env 0600 (content not read)"; else echo "FAIL alarm sender or its 0600 settings file missing"; pre_ok=0; fi
  if [ "$JOB" = r2 ]; then
    local last; last=$(tail -n 1 "$OPS/state/settle-check.log" 2>/dev/null || true)
    local ts; ts=$(printf '%s' "$last" | awk '{print $1}')
    if [[ $last =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z\ rc=0\ AFLDB_SETTLE_STATUS\ OK ]] && [ $(( $(date +%s) - $(date -d "$ts" +%s) )) -le 21600 ]; then
      echo "PASS first manual run recorded: $last"
    else echo "FAIL the last settle-check.log line is not a successful run within 6 h: '${last:0:120}'"; pre_ok=0; fi
  else
    local d; d=$(ls -1 "$DEST"/afldb_prod-*.dump 2>/dev/null | sort | tail -n 1 || true)
    if [ -n "$d" ] && [ -f "$d.sha256" ] && [ "$(wc -l < "$d.sha256")" = 1 ] && (cd "$DEST" && sha256sum --quiet -c "$(basename "$d").sha256") && [ -e "$DEST/.verified-$(basename "$d")" ]; then
      echo "PASS newest off-host dump $(basename "$d"): sidecar verifies, .verified marker present"
      local L="$OPS/state/a2-firstcopy-restore.log"
      if [ -f "$L" ] && grep -qx "DUMP $d" "$L" && grep -q '^pg_restore exit=0,' "$L" && grep -q '^FIRSTCOPY RESULT RESTORE PASS' "$L"; then
        echo "PASS first-copy restore recorded for that dump ($L)"; else echo "FAIL $L does not record a PASS restore of $d"; pre_ok=0; fi
    else echo "FAIL no verified newest dump with a one-line verifying sidecar in $DEST"; pre_ok=0; fi
  fi
}

PRE=$(mktemp "$OPS/state/.crontab-pre.XXXXXX"); NEW=$(mktemp "$OPS/state/.crontab-new.XXXXXX"); POST=$(mktemp "$OPS/state/.crontab-post.XXXXXX")
cleanup_tmp() { rm -f -- "$PRE" "$NEW" "$POST"; }
trap 'echo "STOP line $LINENO: $BASH_COMMAND"; cleanup_tmp' ERR
trap cleanup_tmp EXIT
rc=0; "$CRONTAB_BIN" -l > "$PRE" 2>/dev/null || rc=$?
[ "$rc" = 0 ] || { echo "STOP crontab -l failed (rc $rc): nothing changed"; exit 3; }
n=$(awk 'END { print NR }' "$PRE"); echo "crontab now: $n lines, sha256 $(sha256sum < "$PRE" | cut -c1-16)"
[ "$n" -ge "$MIN_LINES" ] || { echo "STOP crontab has $n lines, fewer than the recorded baseline $MIN_LINES: nothing changed"; exit 3; }
m=$(grep -cxF "$MARK" "$PRE" || true); l=$(grep -cxF "$LINE" "$PRE" || true); w=$(grep -cF "$WRAP" "$PRE" || true)
pair=0; if [ "$m" = 1 ] && [ "$l" = 1 ] && [ "$(grep -A1 -xF "$MARK" "$PRE" | tail -n 1)" = "$LINE" ]; then pair=1; fi
echo "installed state: marker=$m job=$l wrapper-mentions=$w exact-pair=$pair"

case $MODE in
check)
  precheck
  [ "$pair" = 1 ] && echo "CRON CHECK $JOB INSTALLED (next due $(next_due))" || echo "CRON CHECK $JOB NOT INSTALLED"
  if [ "$pre_ok" = 1 ]; then echo "CRON CHECK $JOB PRECONDITIONS PASS"; else echo "CRON CHECK $JOB PRECONDITIONS FAIL"; exit 1; fi
  [ "$DRY" != --require-installed ] || [ "$pair" = 1 ] || exit 6
  exit 0;;
install)
  if [ "$pair" = 1 ] && [ "$w" = 1 ]; then echo "CRON INSTALL $JOB ALREADY INSTALLED (exactly one marker + job; next due $(next_due))"; exit 0; fi
  [ "$m" = 0 ] && [ "$l" = 0 ] && [ "$w" = 0 ] || { echo "STOP partial, duplicate or different $JOB entry present (marker=$m job=$l wrapper=$w): fix by hand with the owner"; exit 3; }
  precheck; [ "$pre_ok" = 1 ] || { echo "STOP precondition failed: nothing installed"; exit 3; }
  cp -p "$PRE" "$NEW"; [ "$n" = 0 ] || [ -z "$(tail -c1 "$NEW")" ] || { printf '\n' >> "$NEW"; echo "NOTE added the missing final newline"; }
  printf '%s\n%s\n' "$MARK" "$LINE" >> "$NEW";;
remove)
  if [ "$m" = 0 ] && [ "$l" = 0 ]; then echo "CRON REMOVE $JOB NOT INSTALLED (nothing to do)"; exit 0; fi
  [ "$pair" = 1 ] || { echo "STOP not exactly one marker + job pair (marker=$m job=$l): fix by hand with the owner"; exit 3; }
  awk -v mk="$MARK" -v ln="$LINE" 'skip { skip=0; if ($0 == ln) next } $0 == mk { skip=1; next } { print }' "$PRE" > "$NEW";;
esac
# Compare line content (a missing final newline on the pre-image is not a change of content).
PREN=$(mktemp "$OPS/state/.crontab-pren.XXXXXX"); cp -p "$PRE" "$PREN"; [ "$n" = 0 ] || [ -z "$(tail -c1 "$PREN")" ] || printf '\n' >> "$PREN"
echo "-- change (diff pre new):"; diff "$PREN" "$NEW" || true
added=$(diff "$PREN" "$NEW" | grep -c '^[<>]' || true); rm -f -- "$PREN"; [ "$added" = 2 ] || { echo "STOP intended change is not exactly 2 lines ($added)"; exit 3; }
if [ "$DRY" = --dry-run ]; then echo "CRON $MODE $JOB DRY RUN OK (nothing written)"; exit 0; fi
BK="$OPS/state/crontab.pre-a2-$JOB-$MODE-$STAMP"; cp -p "$PRE" "$BK"; chmod 600 "$BK"; echo "pre-image backup $BK"
"$CRONTAB_BIN" "$NEW"
"$CRONTAB_BIN" -l > "$POST" 2>/dev/null || true
if cmp -s "$NEW" "$POST"; then
  echo "PASS installed crontab equals the intended text ($(wc -l < "$POST") lines, sha256 $(sha256sum < "$POST" | cut -c1-16))"
else
  echo "FAIL installed crontab differs from the intended text: restoring the pre-image"
  "$CRONTAB_BIN" "$BK"; "$CRONTAB_BIN" -l > "$POST" 2>/dev/null || true
  cmp -s "$BK" "$POST" && echo "restored: crontab equals the pre-image" || echo "RESTORE FAILED: crontab is neither; owner: crontab $BK"
  exit 4
fi
if [ "$MODE" = install ]; then echo "CRON INSTALL $JOB PASS: next due $(next_due); record it, then observe with a2-cron-observe.sh"
else echo "CRON REMOVE $JOB PASS"; fi
