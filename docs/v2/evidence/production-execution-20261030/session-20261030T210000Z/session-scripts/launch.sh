#!/bin/bash
# launch.sh <root> <tag> <command...>: starts <command> detached in its own session (output to <root>/<tag>.out)
# with disk-watch.sh guarding a 3 GiB host reserve (log <root>/diskwatch/<tag>.log).
set -u
R=$1; TAG=$2; shift 2
[ -d "$R/diskwatch" ] && [ ! -e "$R/$TAG.out" ] || { echo "STOP: launch state for $TAG"; exit 2; }
cd "$R" || exit 2
setsid "$@" > "$R/$TAG.out" 2>&1 < /dev/null &
P=$!
sleep 1
PG=$(ps -o pgid= -p "$P" | tr -d ' ')
[ -n "$PG" ] || { echo "STOP: $TAG exited at once"; tail -5 "$R/$TAG.out"; exit 1; }
setsid nohup bash "$R/diskwatch/disk-watch.sh" 3 "$P" "$PG" "$R/diskwatch/$TAG.log" > /dev/null 2>&1 < /dev/null &
echo "started $TAG pid=$P pgid=$PG watchdog=$!"
