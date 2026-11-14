#!/usr/bin/env bash
# caddy357: residual growth model. Per class of well-formed unknown paths (the ones the Caddy rules let through),
# send N distinct requests straight to the app and record files, apparent bytes and disk usage (4 KiB blocks)
# added under .next/server/app and .next/cache, plus the mean request time.
# usage: measure.sh <port> <N>    SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
P=$1; N=$2
D=$CAND/.next
cnt() { find "$D/server/app" "$D/cache" -type f 2>/dev/null | wc -l; }
apparent() { du -scb "$D/server/app" "$D/cache" 2>/dev/null | tail -1 | cut -f1; }
disk() { du -sck "$D/server/app" "$D/cache" 2>/dev/null | tail -1 | cut -f1; }
class() { # label, printf-format with %s for the index, first index
  local label=$1 fmt=$2 start=$3 f0 b0 k0 t0 t1 i code codes=""
  f0=$(cnt); b0=$(apparent); k0=$(disk); t0=$(date +%s.%N)
  for i in $(seq "$start" $((start+N-1))); do
    code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "http://127.0.0.1:$P$(printf "$fmt" "$i" "$i")")
    codes="$codes $code"
  done
  sleep 1; t1=$(date +%s.%N)
  local f1 b1 k1; f1=$(cnt); b1=$(apparent); k1=$(disk)
  awk -v l="$label" -v n="$N" -v st="$(echo $codes | tr ' ' '\n' | sort | uniq -c | tr '\n' ' ')" -v f=$((f1-f0)) -v b=$((b1-b0)) -v k=$((k1-k0)) -v t0="$t0" -v t1="$t1" \
    'BEGIN{printf "%-46s n=%d statuses: %s| files+=%d (%.2f/path) apparent_bytes+=%d (%.0f/path) disk_KiB+=%d (%.1f/path) ms/request=%.0f\n", l, n, st, f, f/n, b, b/n, k, k/n, (t1-t0)*1000/n}'
}
echo "BUILD_ID=$(cat "$D/BUILD_ID") N=$N  baseline: files=$(cnt) apparent=$(apparent) disk_KiB=$(disk)"
class "players: unknown slug + unknown id (404)"      '/players/zzp%s-9%s' 100000
class "players: wrong slug, real id (308)"            '/players/zzwrong%s-11724%.0s' 100000
class "matches: unknown id, 5 digits (404)"           '/matches/%s%.0s' 40000
class "seasons: unknown year (404; <=204 distinct)"   '/seasons/%s%.0s' 2027
class "brownlow: unknown year (404; <=204 distinct)"  '/brownlow/%s%.0s' 2027
class "clubs: unknown slug (404)"                     '/clubs/zzclub%s%.0s' 1
class "venues: unknown slug (404)"                    '/venues/zzvenue%s%.0s' 1
class "honour-teams: unknown slug (404)"              '/honour-teams/zzteam%s%.0s' 1
class "sitemap: unknown segment id (404)"             '/sitemap/%s.xml%.0s' 400
echo "END files=$(cnt) apparent=$(apparent) disk_KiB=$(disk)"
