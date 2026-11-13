#!/usr/bin/env bash
# hostops: stop MY stuck red-run vitest (it finished its report but a leaked detached fixture server kept it alive and held the
# host-wide heavy lock). Only pids whose command line names my workspace or my run name are touched.
W=/mnt/ssd/afldb-rem-hostops-20261114
echo "children of 409459:"; ps -o pid,ppid,etime,cmd --ppid 409459 | cut -c1-150
pgrep -f "afldb-329-route-" | head
for p in 409459 409437; do kill "$p" 2>/dev/null && echo "killed $p"; done
sleep 2
for p in $(pgrep -f "afldb-329-route-"); do echo "leaked fixture process $p: $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-120)"; done
ps -eo pid,etime,cmd | grep -E "afldb-rem-hostops|vitest-files" | grep -v grep | cut -c1-120
