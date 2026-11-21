#!/bin/sh
# ISSUE-332 / D-332-1 option A (owner decision 2026-11-22): hourly read-only pull check, run on streamanator as arm.
# Procedure 04 section 4 wrapper. One connection per run, no retry loop (the production firewall IPS trips on rapid SSH).
# The forced command on production runs deploy/afldb-settle-failure-status.sh (sha256 d80838cb... at c8d4202a).
# Exit 0 = OK. Anything else (script rc 1 FAILED, 2 UNKNOWN, ssh 255 unreachable, timeout 124) raises the alarm.
#
# ALARM DESTINATION: NOT YET CHOSEN BY THE OWNER. Until AFLDB_ALARM_CMD is set (a command that reads the message on stdin
# and delivers it to a channel the owner watches), the alarm is only appended to $STATE/alarms.log and this script exits 3.
# A log line is NOT delivery (procedure 04 section 8); G0b is satisfied only after one deliberate test alarm ARRIVES.
STATE="${AFLDB_OPS_STATE:-/home/arm/afldb-ops/state}"
PROD="${AFLDB_PROD_SSH:-arm@209.38.87.252}"
KEY="${AFLDB_SETTLE_KEY:-$HOME/.ssh/afldb_settle_status}"
mkdir -p "$STATE" && chmod 700 "$STATE"
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=20 -o IdentitiesOnly=yes -i "$KEY" "$PROD" 2>&1); rc=$?
printf '%s rc=%s %s\n' "$stamp" "$rc" "$(printf '%s' "$out" | head -n 1)" >> "$STATE/settle-check.log"
[ "$rc" -eq 0 ] && exit 0
msg=$(printf '%s\n' "AFLDB settle check failed rc=$rc at $stamp (from $(hostname))" "$out")
printf '%s\n---\n' "$msg" >> "$STATE/alarms.log"
if [ -n "${AFLDB_ALARM_CMD:-}" ]; then
  printf '%s\n' "$msg" | sh -c "$AFLDB_ALARM_CMD" || exit 4
  exit 1
fi
exit 3
