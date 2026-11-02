#!/bin/bash
# READ-ONLY capability probe (no sudo): can arm read the AFL API unit journal, and what will the scheduled run invoke?
echo "groups: $(id -nG)"
echo "-- journal (last 3 lines of the match unit):"; journalctl -u afldb-settle-afl-api.service -n 3 --no-pager 2>&1 | cut -c1-200
echo "-- unit invocation lines:"; systemctl cat afldb-settle-afl-api.service --no-pager 2>&1 | grep -E '^(Exec|Type|User|WorkingDirectory|TimeoutStartSec)' | cut -c1-220
echo "-- timer lines:"; systemctl cat afldb-settle-afl-api.timer --no-pager 2>&1 | grep -E '^(On|Randomized|Persistent|Accuracy)' 
echo "-- state:"; systemctl show -p InvocationID -p ExecMainStartTimestamp -p ExecMainExitTimestamp -p Result -p ExecMainStatus afldb-settle-afl-api.service --no-pager
systemctl show -p NextElapseUSecRealtime -p LastTriggerUSec -p LastTriggerUSecMonotonic afldb-settle-afl-api.timer --no-pager
echo "-- wrapper script the unit runs:"; sed -n 1,60p /home/arm/projects/afldb/deploy/afldb-settle-afl-api.sh | grep -nE 'acquire-afl-api|settle-afl-api|exit|seasons|in_progress' | cut -c1-200
