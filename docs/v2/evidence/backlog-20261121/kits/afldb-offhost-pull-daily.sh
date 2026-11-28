#!/bin/sh
# ISSUE-352 / D-HO-3 option A (owner decision 2026-11-22): daily off-host pull to streamanator, run as arm at about 03:10 AEDT.
# Procedure 05 section 6. Uses offhost-pull.sh from the same reviewed revision (r10: the historical a2-cron-install.sh pins the r9 bytes of both scripts).
# The production key line confines this key to `rrsync -ro /home/arm/backups/afldb-scheduled`, so the source path is "/".
# F-07: exit 1 with <dest>/.retention-hold present means "review the batch, quarantine any rejected dump by hand, then
# rm <dest>/.retention-hold"; the script prunes nothing while the hold exists. Any non-zero exit raises the same alarm as
# afldb-settle-check.sh (alarm destination not yet chosen).
# R6 r10: the log records BEGIN, OUTPUT, RECEIVED (a dump this run transferred in full and verified), HELD (every copy present
# afterwards: possession only), END, and after END rc=0 one RECEIPT per RECEIVED dump. Only RECEIPT/RECEIVED count as receipt.
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
DEST="${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}"
PROD="${AFLDB_PROD_SSH:-arm@209.38.87.252}"
STATE="$OPS/state"; mkdir -p "$STATE" && chmod 700 "$STATE"
export RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -o IdentitiesOnly=yes -i $HOME/.ssh/afldb_backup_pull"
exec 9>"$STATE/offhost-pull.lock"
flock -n 9 || { echo 'offhost wrapper already running' >&2; exit 1; }
# ISSUE-352: Debian cron logs `CRON[pid]: (arm) CMD (command)` from the process about to exec the job shell, which is NOT the
# process named "cron" above that shell. Record this invocation's whole process lineage (pid:comm:start-epoch, this shell up
# to init) so an observer can bind the independent journal dispatch to THIS run through that PID and its start time.
# `cron_pid` is kept for humans only; nothing trusts it. A ps failure degrades to lineage=unknown and never blocks the pull.
lineage_of() {
  p=$1; now=$2; n=0; out=''
  while [ "$p" -gt 1 ] 2>/dev/null && [ "$n" -lt 16 ]; do
    comm=$(ps -o comm= -p "$p" 2>/dev/null | tr -cd 'A-Za-z0-9._-')
    et=$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$comm" ] && [ "$et" -ge 0 ] 2>/dev/null || break
    out="$out${out:+,}$p:$comm:$((now - et))"
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    n=$((n + 1))
  done
  [ -n "$out" ] && printf '%s' "$out"
}
cron_pid=none; ancestor=$PPID
while [ "$ancestor" -gt 1 ] 2>/dev/null; do
  comm=$(ps -o comm= -p "$ancestor" 2>/dev/null | tr -d ' ')
  case "$comm" in cron|CRON) cron_pid=$ancestor; break;; esac
  ancestor=$(ps -o ppid= -p "$ancestor" 2>/dev/null | tr -d ' ')
done
lineage=$(lineage_of "$$" "$(date +%s)") || lineage=''
[ -n "$lineage" ] || lineage=unknown
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
run="$stamp-$$"
printf '%s BEGIN run=%s cron_pid=%s lineage=%s\n' "$stamp" "$run" "$cron_pid" "$lineage" >> "$STATE/offhost-pull.log"
out=$(timeout 1800 bash "$OPS/offhost-pull.sh" "$PROD:/" "$DEST/" --keep 30 2>&1); rc=$?
printf '%s\n' "$out" | sed "s/^/OUTPUT run=$run /" >> "$STATE/offhost-pull.log"
# R6 r10 (Astra case 1): RECEIPT, not possession. offhost-pull.sh prints "RECEIVED <dump> sha256=<h> bytes=<b> size=<s>" only for a
# dump THIS run transferred in full (rsync itemised it as created here) and then verified. Each such dump, re-hashed now and equal,
# gets one "RECEIVED run=<run> dump=<dump> sha256=<h> bytes=<b>" line before END; after an END with rc=0, and only then, one
# per-dump "RECEIPT run=<run> dump=<dump> sha256=<h> bytes=<b> end=<END time>" line follows. A copy that was already here (placed
# before the run, or left by an earlier run) is never RECEIVED and never gets a RECEIPT: it is HELD (possession only).
received=''
if [ "$rc" -eq 0 ]; then
  received=$(printf '%s\n' "$out" | sed -n 's/^[0-9TZ:-]* offhost-pull: RECEIVED \(afldb_prod-[0-9]\{8\}-[0-9]\{6\}\.dump\) sha256=\([0-9a-f]\{64\}\) bytes=\([0-9]\{1,15\}\) size=[0-9]\{1,15\}$/\1 \2 \3/p')
fi
rcv=''
while read -r name want bytes; do
  [ -n "$name" ] || continue
  hash=$( [ -f "$DEST/$name" ] && sha256sum < "$DEST/$name" | cut -d' ' -f1)
  if [ "$hash" = "$want" ]; then
    printf '%s RECEIVED run=%s dump=%s sha256=%s bytes=%s\n' "$(date -u +%FT%TZ)" "$run" "$name" "$hash" "$bytes" >> "$STATE/offhost-pull.log"
    rcv="$rcv$name $hash $bytes
"
  else rc=1; fi
done <<EOF
$received
EOF
# Every copy held after the run, re-hashed against its sidecar: POSSESSION only (r9 wrote these as VERIFIED, which the r9 off-host
# core counted as receipt; r10 labels them HELD and no verifier counts them). A mismatch still fails the run, as before.
if [ "$rc" -eq 0 ]; then
  for dump in "$DEST"/afldb_prod-*.dump; do
    [ -f "$dump" ] || continue
    name=${dump##*/}
    [ -f "$DEST/.verified-$name" ] && [ -f "$dump.sha256" ] || { rc=1; continue; }
    hash=$(sha256sum < "$dump" | cut -d' ' -f1)
    [ "$(wc -l < "$dump.sha256")" = 1 ] &&
      awk -v h="$hash" -v n="$name" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !good}' "$dump.sha256" ||
      { rc=1; continue; }
    printf '%s HELD run=%s dump=%s sha256=%s\n' "$(date -u +%FT%TZ)" "$run" "$name" "$hash" >> "$STATE/offhost-pull.log"
  done
fi
[ ! -e "$DEST/.retention-hold" ] || rc=1
end=$(date -u +%FT%TZ)
printf '%s END run=%s rc=%s\n' "$end" "$run" "$rc" >> "$STATE/offhost-pull.log"
if [ "$rc" -eq 0 ]; then
  while read -r name hash bytes; do
    [ -n "$name" ] || continue
    printf '%s RECEIPT run=%s dump=%s sha256=%s bytes=%s end=%s\n' "$(date -u +%FT%TZ)" "$run" "$name" "$hash" "$bytes" "$end" >> "$STATE/offhost-pull.log"
  done <<EOF
$rcv
EOF
fi
[ "$rc" -eq 0 ] && exit 0
hold=''; [ -e "$DEST/.retention-hold" ] && hold=' (RETENTION HOLD present: review, then rm the hold file)'
msg=$(printf '%s\n' "AFLDB off-host pull failed rc=$rc at $stamp$hold" "$(printf '%s' "$out" | tail -n 20)")
printf '%s\n---\n' "$msg" >> "$STATE/alarms.log"
if [ -n "${AFLDB_ALARM_CMD:-}" ]; then printf '%s\n' "$msg" | sh -c "$AFLDB_ALARM_CMD" || exit 4; exit 1; fi
exit 3
