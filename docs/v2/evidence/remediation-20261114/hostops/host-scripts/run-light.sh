#!/usr/bin/env bash
# hostops: short targeted vitest run without the heavy lock (disclosed); the first version also killed stale queued pids, removed
W=/mnt/ssd/afldb-rem-hostops-20261114
cd "$W"; W=$W LIGHT=1 timeout 300 bash in/vitest-files.sh "$1" "${@:2}" > "$W/$1.out" 2>&1; echo "exit $?" >> "$W/$1.out"
