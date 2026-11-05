#!/usr/bin/env bash
# READ-ONLY DEV inspection for the ISSUE-336 procedure corrections. No writes to DEV's checkout, database, units or timers.
set -u -o pipefail
D=$HOME/projects/afldb
echo "== $(date -u +%FT%TZ) service"
systemctl show afldb -p MainPID -p ActiveEnterTimestamp -p ExecMainStartTimestamp -p NRestarts -p Restart -p RestartUSec -p KillMode -p TimeoutStopUSec -p User -p WorkingDirectory --no-pager
echo "worker children of MainPID: $(pgrep -P "$(systemctl show afldb -p MainPID --value)" | wc -l)"
echo "== journal visibility and past respawn timings (last 40 days)"
journalctl -u afldb --since '-40 days' --no-pager -o short-iso 2>&1 \
  | grep -E 'Stopping|Stopped|Started|Main process exited|Scheduled restart|Deactivated|serving build|primary|worker [0-9]+ (online|listening)|Ready in|No journal files|not seeing' | tail -60
echo "== build artifact"
echo "BUILD_ID $(cat $D/.next/BUILD_ID) standalone BUILD_ID $(cat $D/.next/standalone/.next/BUILD_ID)"
du -sh $D/.next $D/.next/standalone $D/.next/cache 2>/dev/null
echo "symlinks under .next/standalone: $(find $D/.next/standalone -type l | wc -l)"
find $D/.next/standalone -type l -printf '%p -> %l\n' | grep -v "^$D/.next/standalone/.*-> [^/]" | head -5
echo "absolute links leaving the bundle (first 5):"; find $D/.next/standalone -type l -printf '%l\n' | grep '^/' | grep -v "^$D/.next/standalone" | head -5
echo "files with .env* under standalone: $(find $D/.next/standalone -name '.env*' | wc -l)"
ls $D/.next/standalone | head -20
echo "== disk"
df -h /home /mnt/ssd | sed 1d
echo "== settle timers next elapse"
systemctl list-timers 'afldb-*' --all --no-pager | head -8
echo "== AFL API snapshot dirs on DEV (names only)"
for f in matches seasons rosters fixtures; do printf '%s: ' "$f"; ls $D/data/sources/afl_api/$f 2>/dev/null | wc -l; done
ls -t $D/data/sources/afl_api/matches | head -3
echo DEVINSPECT2-DONE
