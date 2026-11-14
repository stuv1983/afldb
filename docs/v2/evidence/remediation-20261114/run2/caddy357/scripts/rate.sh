#!/usr/bin/env bash
# caddy357: how fast can ONE client invent well-formed unknown paths against the app (no Caddy in front)?
# usage: rate.sh <port> <total> <parallel>   (paths /players/zzr<i>-9<i>; every one persists ~7 files)
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
P=$1; TOTAL=$2; PAR=$3
D=$CAND/.next
f0=$(find "$D/server/app" "$D/cache" -type f | wc -l); k0=$(du -sck "$D/server/app" "$D/cache" | tail -1 | cut -f1)
t0=$(date +%s.%N)
seq ${START:-300000} $((${START:-300000}+TOTAL-1)) | xargs -P "$PAR" -I{} curl -s -o /dev/null --max-time 60 "http://127.0.0.1:$P/players/zzr{}-9{}"
t1=$(date +%s.%N)
sleep 2
f1=$(find "$D/server/app" "$D/cache" -type f | wc -l); k1=$(du -sck "$D/server/app" "$D/cache" | tail -1 | cut -f1)
awk -v n="$TOTAL" -v p="$PAR" -v t0="$t0" -v t1="$t1" -v f=$((f1-f0)) -v k=$((k1-k0)) 'BEGIN{dt=t1-t0; printf "total=%d parallel=%d seconds=%.1f rate=%.1f paths/s files+=%d disk_KiB+=%d (%.1f KiB/path) growth=%.2f MiB/s = %.1f GiB/hour\n", n, p, dt, n/dt, f, k, k/n, k/1024/dt, k/1048576/dt*3600}'
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"
