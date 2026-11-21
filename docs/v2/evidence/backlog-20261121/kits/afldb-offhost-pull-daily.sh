#!/bin/sh
# ISSUE-352 / D-HO-3 option A (owner decision 2026-11-22): daily off-host pull to streamanator, run as arm at about 03:10 AEDT.
# Procedure 05 section 6. Uses the pinned copy of tools/maintenance/offhost-pull.sh (sha256 ea48205a... at c8d4202a and 5199eb4f).
# The production key line confines this key to `rrsync -ro /home/arm/backups/afldb-scheduled`, so the source path is "/".
# F-07: exit 1 with <dest>/.retention-hold present means "review the batch, quarantine any rejected dump by hand, then
# rm <dest>/.retention-hold"; the script prunes nothing while the hold exists. Any non-zero exit raises the same alarm as
# afldb-settle-check.sh (alarm destination not yet chosen).
OPS=/home/arm/afldb-ops
DEST="${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}"
PROD="${AFLDB_PROD_SSH:-arm@209.38.87.252}"
STATE="$OPS/state"; mkdir -p "$STATE" && chmod 700 "$STATE"
export RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -o IdentitiesOnly=yes -i $HOME/.ssh/afldb_backup_pull"
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=$(timeout 1800 bash "$OPS/offhost-pull.sh" "$PROD:/" "$DEST/" --keep 30 2>&1); rc=$?
printf '%s\n%s rc=%s\n' "$out" "$stamp" "$rc" >> "$STATE/offhost-pull.log"
[ "$rc" -eq 0 ] && exit 0
hold=''; [ -e "$DEST/.retention-hold" ] && hold=' (RETENTION HOLD present: review, then rm the hold file)'
msg=$(printf '%s\n' "AFLDB off-host pull failed rc=$rc at $stamp$hold" "$(printf '%s' "$out" | tail -n 20)")
printf '%s\n---\n' "$msg" >> "$STATE/alarms.log"
if [ -n "${AFLDB_ALARM_CMD:-}" ]; then printf '%s\n' "$msg" | sh -c "$AFLDB_ALARM_CMD" || exit 4; exit 1; fi
exit 3
