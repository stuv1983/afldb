#!/usr/bin/env bash
# hostops: what is mine running, and the tail of each of my logs.
W=/mnt/ssd/afldb-rem-hostops-20261114
date
ps -eo pid,etime,cmd | grep -E "afldb-rem-hostops|deploy-release|rehearse|vitest-files" | grep -v grep | cut -c1-140
ls -la --time-style=+%H:%M:%S "$W/evidence" | tail -12
for f in "$W/green1.out" "$W/rehearse.out"; do echo "--- $f"; tail -${1:-6} "$f" 2>/dev/null; done
