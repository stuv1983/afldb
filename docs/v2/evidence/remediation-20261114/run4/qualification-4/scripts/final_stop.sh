#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
OUT=$E/final-stop.txt
{
echo "date $(date -u +%FT%TZ)"
echo "cand HEAD=$(git -C $CAND rev-parse HEAD) porcelain=$(git -C $CAND status --porcelain | wc -l)"
echo "rb   HEAD=$(git -C $RB rev-parse HEAD) porcelain=$(git -C $RB status --porcelain | wc -l)"
IR stop 2>&1 | strip | tail -3
sleep 3
echo "listeners on $PORT (ss -ltn): $(ss -ltnH | awk '{print $4}' | grep -cE ":$PORT\$")"
ss -ltnH | awk '{print $4}' | grep -E ":$PORT\$" || echo "no listener on :$PORT"
echo "arm processes whose command line names $W (excluding this check): $(pgrep -u arm -af "$W" | grep -v pgrep | grep -v final_stop | wc -l)"
pgrep -u arm -af "$W" | grep -v pgrep | grep -v final_stop | cut -c1-200
echo "du: $(du -sh $W $W-pg 2>/dev/null | tr '\n' ' ')"
} 2>&1 | tee $OUT
