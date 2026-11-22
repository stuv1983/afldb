#!/usr/bin/env bash
# After sitting A2: observe the FIRST SCHEDULED runs of the two streamanator cron jobs installed by a2-cron-install.sh, and print
# a record block to paste into OPEN-ITEMS-AFTER-SITTINGS.md §4 (cron observation record). STREAMANATOR, as arm. READ-ONLY:
# reads arm's crontab, the wrappers' own logs and the off-host directory listing; runs nothing, sends nothing, writes nothing.
#   r2  first settle-check.log line stamped after the install time at minute 17 (hourly), and the latest one
#   r3  explicit Melbourne date: independent 03:10 cron dispatch, framed invocation,
#       rc=0 completion and named overnight production checksum; fails closed.
# Usage: bash a2-cron-observe.sh r2 | r3|all <Melbourne DATE> <overnight DUMP> <production SHA256>
# The 22 Nov 2026 email delivery confirmation is SEPARATE evidence (ISSUE-332) and is not re-proven here: a scheduled OK run
# sends no email. An alarm count change is reported so the owner can match it to an email.
set -uo pipefail; export LC_ALL=C
CRONTAB_BIN=${CRONTAB_BIN:-/usr/bin/crontab}
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}; DEST=${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}
WHICH=${1:?r2|r3|all}; [[ $WHICH =~ ^(r2|r3|all)$ ]] || { echo "usage: r2|r3|all"; exit 2; }
mel() { TZ=Australia/Melbourne date -d "$1" +'%a %d %b %Y %H:%M:%S %Z'; }
echo "== A2 cron observation $(date -u +%FT%TZ) ($(mel now)) host=$(hostname) user=$(id -un)"
CT=$("$CRONTAB_BIN" -l 2>/dev/null) || { echo "FAIL crontab -l"; exit 1; }
echo "crontab: $(printf '%s\n' "$CT" | wc -l) lines; AFLDB-A2 markers: $(printf '%s\n' "$CT" | grep -c '^# AFLDB-A2-' || true)"
inst_time() {   # the pre-image backup name carries the install stamp (state/crontab.pre-a2-<job>-install-<STAMP>)
  local f; f=$(ls -1 "$OPS/state"/crontab.pre-a2-"$1"-install-* 2>/dev/null | sort | tail -n 1)
  [ -n "$f" ] && printf '%s' "${f##*-install-}" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3T\4:\5:\6Z/'
}
obs_r2() {
  echo; echo "-- r2 hourly settle check"
  printf '%s\n' "$CT" | grep -A1 '^# AFLDB-A2-r2' | sed 's/^/  crontab: /'
  local it; it=$(inst_time r2); [ -n "$it" ] || { echo "  r2 install record not found (not installed by a2-cron-install.sh?)"; return; }
  echo "  installed (UTC): $it = $(mel "$it")"
  local first last n
  first=$(awk -v t="$it" '$1 > t && $1 ~ /T[0-9][0-9]:17:/' "$OPS/state/settle-check.log" | head -n 1)
  last=$(tail -n 1 "$OPS/state/settle-check.log")
  n=$(awk -v t="$it" '$1 > t && $1 ~ /T[0-9][0-9]:17:/' "$OPS/state/settle-check.log" | wc -l)
  nok=$(awk -v t="$it" '$1 > t && $1 ~ /T[0-9][0-9]:17:/ && $2 == "rc=0"' "$OPS/state/settle-check.log" | wc -l)
  if [ -n "$first" ]; then echo "  FIRST SCHEDULED RUN: $first  [$(mel "$(echo "$first" | awk '{print $1}')")]"; else echo "  first scheduled run: NOT YET OBSERVED"; fi
  echo "  scheduled runs since install: $n (rc=0: $nok); latest line: $last"
}
obs_r3() {
  echo; echo "-- r3 daily off-host pull"
  printf '%s\n' "$CT" | grep -A1 '^# AFLDB-A2-r3' | sed 's/^/  crontab: /'
  bash "$OPS/scheduled-pull-evidence.sh" "${2:?DATE}" "${3:?DUMP}" "${4:?SHA256}"
}
case $WHICH in r2) obs_r2;; r3) obs_r3 "$@" || exit $?;; all) obs_r2; obs_r3 "$@" || exit $?;; esac
echo; echo "alarms.log entries: $(grep -c '^---$' "$OPS/state/alarms.log" 2>/dev/null || true) (3 on 2026-11-22: the test alarms before A2); newest alarm first line: $(grep '^AFLDB ' "$OPS/state/alarms.log" 2>/dev/null | tail -n 1 | cut -c1-120)"
echo "OBSERVE DONE"
