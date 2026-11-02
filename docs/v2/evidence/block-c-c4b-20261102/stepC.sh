#!/bin/bash
# Step C: read-only verification after the C4b run.
set -u
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
CHK=/home/arm/projects/afldb
P=/home/arm/blockc-pkg-ea98a35f2061
EVD=/home/arm/backups/afldb/c4b-ea98a35f-r1
echo "now=$(date -u +%FT%TZ) exit=$(cat $P/c4b-run.exit)"
echo "HEAD=$(git -C $CHK rev-parse HEAD) porcelain=$(git -C $CHK status --porcelain | wc -l)"
systemctl show afldb.service -p MainPID -p NRestarts -p ActiveState | cat
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer; do echo "$u active=$(systemctl is-active $u) enabled=$(systemctl is-enabled $u 2>&1)"; done
echo "--- evidence dir"
ls -laR "$EVD" | head -80
echo "--- hashes"
( cd "$EVD" && find . -type f -print0 | sort -z | xargs -0 sha256sum )
echo "--- snapshot dir"
ls -laR $CHK/data/sources/afl_api/matches 2>&1 | head -30
du -sh $CHK/data/sources/afl_api 2>&1
echo "--- tmux"; tmux ls 2>&1
