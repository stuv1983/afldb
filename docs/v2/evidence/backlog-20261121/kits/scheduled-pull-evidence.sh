#!/usr/bin/env bash
# Read-only. Explicit Melbourne DATE; overnight DUMP and full SHA from production.
# CRON_LOG_FILE accepts a retained journalctl -t CRON -o short-iso export.
set -euo pipefail
export LC_ALL=C
stop() { echo "FAIL scheduled pull: $*"; exit 1; }
DAY=${1:?DATE}; D=${2:?DUMP}; S=${3:?SHA256}
[[ $DAY =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && $S =~ ^[0-9a-f]{64}$ ]] || stop 'invalid date or checksum'
[[ $(TZ=Australia/Melbourne date -d "$DAY" +%F) = "$DAY" ]] || stop 'unparseable date'
[[ $D =~ ^afldb_prod-${DAY//-/}-02(2[0-9]|30)[0-5][0-9]\.dump$ ]] || stop 'wrong overnight dump/date (expected 02:20-02:30)'
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}; DEST=${AFLDB_OFFHOST_DEST:-/mnt/ssd/afldb-offhost-prod}
CT=$(${CRONTAB_BIN:-/usr/bin/crontab} -l) || stop 'crontab unreadable'
LINE='10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh'
[[ $(grep -cxF "$LINE" <<< "$CT") = 1 ]] &&
  grep -A1 '^# AFLDB-A2-r3' <<< "$CT" | grep -qxF "$LINE" || stop 'cron r3 pair missing or ambiguous'
W0=$(TZ=Australia/Melbourne date -d "$DAY 03:10" +%s); W1=$((W0+60)); END=$((W0+2100))
if [ -n "${CRON_LOG_FILE:-}" ]; then J=$(cat "$CRON_LOG_FILE") || stop 'cron export unreadable'
else J=$(journalctl -t CRON --since "@$W0" --until "@$W1" -o short-iso --no-pager) || stop 'cron journal unreadable'; fi
dispatch=(); times=()
while read -r st rest; do
  [[ $rest == *"(arm) CMD ($LINE)" ]] || continue
  e=$(date -d "$st" +%s 2>/dev/null) || continue
  (( e >= W0 && e < W1 )) || continue
  [[ $rest =~ CRON\[([0-9]+)\]: ]] || continue
  dispatch+=("${BASH_REMATCH[1]}"); times+=("$e")
done <<< "$J"
[[ ${#dispatch[@]} = 1 ]] || stop "missing or ambiguous 03:10 cron dispatch for $DAY (count=${#dispatch[@]})"
LOG=$OPS/state/offhost-pull.log
[[ -r $LOG ]] || stop 'invocation log missing'
mapfile -t B < <(awk -v p="cron_pid=${dispatch[0]}" '$2=="BEGIN" && $4==p && NF==4' "$LOG")
[[ ${#B[@]} = 1 ]] || stop 'dispatch has missing or ambiguous invocation BEGIN'
read -r st tag run cp <<< "${B[0]}"
start=$(date -d "$st" +%s) || stop 'invalid BEGIN timestamp'
(( start >= times[0] && start < W1 )) || stop 'stale or late invocation start'
mapfile -t E < <(awk -v r="$run" '$2=="END" && $3==r && NF==4' "$LOG")
[[ ${#E[@]} = 1 ]] || stop 'invocation completion missing or ambiguous'
read -r et tag er rc <<< "${E[0]}"
finish=$(date -d "$et" +%s) || stop 'invalid completion timestamp'
(( finish >= start && finish <= END && finish <= $(date +%s) )) || stop 'stale/late/future completion'
[[ $rc = rc=0 ]] || stop "scheduled invocation failed ($rc); retry cannot replace it"
mapfile -t V < <(awk -v r="$run" -v d="dump=$D" -v s="sha256=$S" '$2=="VERIFIED" && $3==r && $4==d && $5==s && NF==5' "$LOG")
[[ ${#V[@]} = 1 ]] || stop 'named dump/checksum not verified by this invocation'
vtime=$(date -d "${V[0]%% *}" +%s) || stop 'invalid verification time'
(( vtime >= start && vtime <= finish )) || stop 'verification outside invocation'
[[ -s $DEST/$D && -f $DEST/.verified-$D ]] || stop 'dump or verified marker missing'
[[ ! -e $DEST/.retention-hold ]] || stop 'active retention hold'
[[ -f $DEST/$D.sha256 && $(wc -l < "$DEST/$D.sha256") = 1 ]] || stop 'sidecar missing or multiline'
awk -v h="$S" -v n="$D" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !good}' "$DEST/$D.sha256" || stop 'sidecar dump/checksum differs from production'
[[ $(sha256sum < "$DEST/$D" | cut -d' ' -f1) = "$S" ]] || stop 'recomputed off-host checksum differs from production'
echo "PASS scheduled pull date=$DAY cron_pid=${dispatch[0]} $run completion=$et rc=0"
echo "OFFHOST-COMPARE $D $S"
