#!/bin/sh
# ISSUE-352 / D-HO-3 option A (owner decision 2026-11-22): daily off-host pull to streamanator, run as arm at about 03:10 AEDT.
# Procedure 05 section 6. Uses the offhost-pull.sh pin in a2-cron-install.sh.
# The production key line confines this key to `rrsync -ro /home/arm/backups/afldb-scheduled`, so the source path is "/".
# F-07: exit 1 with <dest>/.retention-hold present means "review the batch, quarantine any rejected dump by hand, then
# rm <dest>/.retention-hold"; the script prunes nothing while the hold exists. Any non-zero exit raises the same alarm as
# afldb-settle-check.sh (alarm destination not yet chosen).
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
DEST="${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}"
PROD="${AFLDB_PROD_SSH:-arm@209.38.87.252}"
STATE="$OPS/state"; mkdir -p "$STATE" && chmod 700 "$STATE"
export RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -o IdentitiesOnly=yes -i $HOME/.ssh/afldb_backup_pull"
exec 9>"$STATE/offhost-pull.lock"
flock -n 9 || { echo 'offhost wrapper already running' >&2; exit 1; }
# The nearest CRON ancestor must match the independent journal CMD record.
cron_pid=none; ancestor=$PPID
while [ "$ancestor" -gt 1 ] 2>/dev/null; do
  comm=$(ps -o comm= -p "$ancestor" | tr -d ' ')
  case "$comm" in cron|CRON) cron_pid=$ancestor; break;; esac
  ancestor=$(ps -o ppid= -p "$ancestor" | tr -d ' ')
done
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
run="$stamp-$$"
printf '%s BEGIN run=%s cron_pid=%s\n' "$stamp" "$run" "$cron_pid" >> "$STATE/offhost-pull.log"
out=$(timeout 1800 bash "$OPS/offhost-pull.sh" "$PROD:/" "$DEST/" --keep 30 2>&1); rc=$?
printf '%s\n' "$out" | sed "s/^/OUTPUT run=$run /" >> "$STATE/offhost-pull.log"
# Include unchanged copies in this invocation's evidence; re-hash their bytes.
if [ "$rc" -eq 0 ]; then
  for dump in "$DEST"/afldb_prod-*.dump; do
    [ -f "$dump" ] || continue
    name=${dump##*/}
    [ -f "$DEST/.verified-$name" ] && [ -f "$dump.sha256" ] || { rc=1; continue; }
    hash=$(sha256sum < "$dump" | cut -d' ' -f1)
    [ "$(wc -l < "$dump.sha256")" = 1 ] &&
      awk -v h="$hash" -v n="$name" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !good}' "$dump.sha256" ||
      { rc=1; continue; }
    printf '%s VERIFIED run=%s dump=%s sha256=%s\n' "$(date -u +%FT%TZ)" "$run" "$name" "$hash" >> "$STATE/offhost-pull.log"
  done
fi
[ ! -e "$DEST/.retention-hold" ] || rc=1
printf '%s END run=%s rc=%s\n' "$(date -u +%FT%TZ)" "$run" "$rc" >> "$STATE/offhost-pull.log"
[ "$rc" -eq 0 ] && exit 0
hold=''; [ -e "$DEST/.retention-hold" ] && hold=' (RETENTION HOLD present: review, then rm the hold file)'
msg=$(printf '%s\n' "AFLDB off-host pull failed rc=$rc at $stamp$hold" "$(printf '%s' "$out" | tail -n 20)")
printf '%s\n---\n' "$msg" >> "$STATE/alarms.log"
if [ -n "${AFLDB_ALARM_CMD:-}" ]; then printf '%s\n' "$msg" | sh -c "$AFLDB_ALARM_CMD" || exit 4; exit 1; fi
exit 3
