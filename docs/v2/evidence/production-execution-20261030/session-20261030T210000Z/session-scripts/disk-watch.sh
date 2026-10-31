#!/bin/bash
# AFLDB V2 preparation disk watchdog (streamanator). Not a pinned session script.
#   disk-watch.sh <reserve_GiB> <pid> <pgid> <log>
# While <pid> lives, samples free space under /home/arm every 5 s and logs it; if free space falls below the
# reserve, stops process group <pgid> (TERM, then KILL after 20 s) and records STOP. Ends with the minimum seen.
set -u
RES=$1; PID=$2; PG=$3; LOG=$4
RB=$((RES * 1024 * 1024 * 1024)); MIN=
echo "$(date -u +%FT%TZ) watching pid=$PID pgid=$PG reserve=${RES}GiB" >> "$LOG"
while kill -0 "$PID" 2>/dev/null; do
  a=$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' ')
  if [ -z "$MIN" ] || [ "$a" -lt "$MIN" ]; then MIN=$a; fi
  echo "$(date -u +%FT%TZ) avail=$a" >> "$LOG"
  if [ "$a" -lt "$RB" ]; then
    echo "$(date -u +%FT%TZ) STOP: avail $a below the ${RES} GiB reserve; stopping process group $PG" >> "$LOG"
    kill -TERM -- "-$PG" 2>/dev/null; sleep 20; kill -KILL -- "-$PG" 2>/dev/null
    echo "$(date -u +%FT%TZ) stopped; min_avail_bytes=$MIN" >> "$LOG"; exit 1
  fi
  sleep 5
done
echo "$(date -u +%FT%TZ) target ended; min_avail_bytes=$MIN ($((MIN / 1048576)) MiB)" >> "$LOG"
