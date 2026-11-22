#!/usr/bin/env bash
# ISSUE-352. Read-only. Explicit Melbourne DATE; overnight DUMP and full SHA from production.
# CRON_LOG_FILE accepts a retained `journalctl -t CRON -o short-iso` export.
#
# Three outcomes (the last line printed is `RESULT <state>`; the exit status carries the same distinction):
#   exit 0   RESULT SCHEDULED-COPY-VERIFIED            bytes verified AND tied to a successful scheduled invocation
#   exit 10  RESULT COPY-VERIFIED-ORIGIN-UNPROVEN      bytes verified; the scheduled origin cannot be proven (reason printed)
#   exit 1   RESULT COPY-FAILED                        bytes not verified, or the proven scheduled invocation failed/was late
#   exit 2   usage error (bad date, dump name or checksum); nothing was examined
# Nothing is inferred: a matching minute, a matching PID printed by a wrapper, or a successful manual retry is never proof.
#
# Origin proof (Debian cron 3.0pl1): the journal CMD record is `CRON[<pid>]: (arm) CMD (<command>)` WITHOUT the five schedule
# fields, and <pid> is the job shell about to exec, not the cron-named process above it. The schedule is verified separately
# against the installed crontab. The dispatch is bound to a wrapper run ONLY when that run's BEGIN lineage contains the
# dispatch PID with a process start time within a few seconds of the journal timestamp, with a cron-named process at or above
# it. A PID reused on another day, or a manual run in the same minute, has no such lineage and cannot match.
set -euo pipefail
export LC_ALL=C
usage() { echo "FAIL scheduled pull: $*"; exit 2; }
DAY=${1:?DATE}; D=${2:?DUMP}; S=${3:?SHA256}
[[ $DAY =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && $S =~ ^[0-9a-f]{64}$ ]] || usage 'invalid date or checksum'
[[ $(TZ=Australia/Melbourne date -d "$DAY" +%F) = "$DAY" ]] || usage 'unparseable date'
[[ $D =~ ^afldb_prod-${DAY//-/}-02(2[0-9]|30)[0-5][0-9]\.dump$ ]] || usage 'wrong overnight dump/date (expected 02:20-02:30; the verification-service dump is never the overnight dump)'
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}; DEST=${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}
failed() { echo "FAIL scheduled pull: $*"; echo 'RESULT COPY-FAILED'; exit 1; }
unproven() {
  echo "UNPROVEN scheduled origin: $*"
  echo "OFFHOST-COMPARE $D $S"
  echo 'RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'
  exit 10
}

# ---- A. The copy itself (independent of cron) ----
[[ -s $DEST/$D && -f $DEST/.verified-$D ]] || failed 'dump or verified marker missing'
[[ ! -e $DEST/.retention-hold ]] || failed 'active retention hold'
[[ -f $DEST/$D.sha256 && $(wc -l < "$DEST/$D.sha256") = 1 ]] || failed 'sidecar missing or multiline'
awk -v h="$S" -v n="$D" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !good}' "$DEST/$D.sha256" || failed 'sidecar dump/checksum differs from production'
[[ $(sha256sum < "$DEST/$D" | cut -d' ' -f1) = "$S" ]] || failed 'recomputed off-host checksum differs from production'
echo "COPY VERIFIED $D sha256=$S (bytes, named sidecar, verified marker, no hold)"

# ---- B. The scheduled origin ----
SCHED='10 3 * * *'
CMD='AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh'
LINE="$SCHED $CMD"
CT=$(${CRONTAB_BIN:-/usr/bin/crontab} -l 2>/dev/null) || unproven 'crontab unreadable: schedule not verified'
[[ $(grep -cxF "$LINE" <<< "$CT") = 1 ]] &&
  grep -A1 '^# AFLDB-A2-r3' <<< "$CT" | grep -qxF "$LINE" || unproven 'cron r3 marker+job pair missing or ambiguous in the crontab'
echo "SCHEDULE crontab pair present: $SCHED"
W0=$(TZ=Australia/Melbourne date -d "$DAY 03:10" +%s); W1=$((W0+60)); DEADLINE=$((W0+2100))
if [ -n "${CRON_LOG_FILE:-}" ]; then J=$(cat "$CRON_LOG_FILE" 2>/dev/null) || unproven 'cron journal export unreadable'
else J=$(journalctl -t CRON --since "@$W0" --until "@$W1" -o short-iso --no-pager 2>/dev/null) || unproven 'cron journal unreadable'; fi
dpid=(); dtime=()
while read -r st rest; do
  # The journal record carries the command only. Match the command portion, never the schedule fields.
  [[ $rest == *"(arm) CMD ($CMD)" ]] || continue
  e=$(date -d "$st" +%s 2>/dev/null) || continue
  (( e >= W0 && e < W1 )) || continue
  [[ $rest =~ CRON\[([0-9]+)\]: ]] || continue
  dpid+=("${BASH_REMATCH[1]}"); dtime+=("$e")
done <<< "$J"
[[ ${#dpid[@]} -ge 1 ]] || unproven "no 03:10 cron dispatch of the r3 command in the journal for $DAY"
[[ ${#dpid[@]} = 1 ]] || unproven "ambiguous 03:10 cron dispatch for $DAY (count=${#dpid[@]})"
echo "DISPATCH journal: pid=${dpid[0]} at $(TZ=Australia/Melbourne date -d "@${dtime[0]}" +'%F %T %Z') (command portion only)"
LOG=$OPS/state/offhost-pull.log
[[ -r $LOG ]] || unproven 'invocation log missing'
matches=()
while read -r bst tag run cp lin; do
  [[ $tag == BEGIN && $run == run=* && $cp == cron_pid=* && $lin == lineage=* ]] || continue
  b=$(date -d "$bst" +%s 2>/dev/null) || continue
  (( b >= dtime[0] - 5 && b < W1 )) || continue
  IFS=, read -ra ents <<< "${lin#lineage=}"
  hit=0; croncomm=0
  for ent in "${ents[@]}"; do
    IFS=: read -r ep ec es <<< "$ent"
    if (( hit == 0 )) && [[ $ep == "${dpid[0]}" && $es =~ ^[0-9]+$ ]] && (( es >= dtime[0] - 5 && es <= dtime[0] + 5 )); then hit=1; fi
    if (( hit == 1 )) && [[ ${ec,,} == cron ]]; then croncomm=1; fi
  done
  (( hit == 1 && croncomm == 1 )) && matches+=("$run $b")
done < <(awk '$2=="BEGIN" && NF==5' "$LOG")
[[ ${#matches[@]} -ge 1 ]] || unproven 'no wrapper invocation links to this dispatch (a manual run, an invocation logged before lineage recording, or a recycled PID)'
[[ ${#matches[@]} = 1 ]] || unproven 'more than one wrapper invocation links to this dispatch'
read -r run start <<< "${matches[0]}"
echo "INVOCATION linked to dispatch: $run (lineage contains pid ${dpid[0]}, started within 5 s of the journal record)"
mapfile -t E < <(awk -v r="$run" '$2=="END" && $3==r && NF==4' "$LOG")
[[ ${#E[@]} = 1 ]] || failed "scheduled invocation $run has no unique completion record (not finished, or crashed); a retry cannot replace it"
read -r et tag er rc <<< "${E[0]}"
finish=$(date -d "$et" +%s 2>/dev/null) || failed 'invalid completion timestamp'
(( finish >= start && finish <= DEADLINE && finish <= $(date +%s) )) || failed 'stale, late or future completion'
[[ $rc = rc=0 ]] || failed "scheduled invocation failed ($rc); a later retry cannot replace it"
mapfile -t V < <(awk -v r="$run" -v d="dump=$D" -v s="sha256=$S" '$2=="VERIFIED" && $3==r && $4==d && $5==s && NF==5' "$LOG")
[[ ${#V[@]} = 1 ]] || unproven "the scheduled invocation succeeded but did not itself verify $D with this checksum"
vtime=$(date -d "${V[0]%% *}" +%s 2>/dev/null) || unproven 'invalid verification time'
(( vtime >= start && vtime <= finish )) || unproven 'verification record lies outside the invocation'
echo "PASS scheduled pull date=$DAY dispatch_pid=${dpid[0]} $run completion=$et rc=0"
echo "OFFHOST-COMPARE $D $S"
echo 'RESULT SCHEDULED-COPY-VERIFIED'
