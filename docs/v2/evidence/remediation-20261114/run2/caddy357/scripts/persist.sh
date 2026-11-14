#!/usr/bin/env bash
# caddy357: what does Next persist for each request target? usage: persist.sh <port> <targets-file> [<label>]
# Sends each raw target (curl --path-as-is, GET) one at a time to 127.0.0.1:<port> and lists the files that appear
# under .next/server/app and .next/cache afterwards (names relative to .next, counts, bytes).
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
P=$1; T=$2; LABEL=${3:-x}
N=$CAND/.next
snap() { find "$N/server/app" "$N/cache" -type f 2>/dev/null | sort; }
tot=0; totb=0
while IFS= read -r target; do
  [ -z "$target" ] && continue
  snap > "$EV/.before.$$"
  code=$(curl -s -o /dev/null --path-as-is --max-time 60 -w '%{http_code}' "http://127.0.0.1:$P$target" -H 'Host: beta.afldb.com' 2>/dev/null)
  sleep 0.4
  snap > "$EV/.after.$$"
  new=$(comm -13 "$EV/.before.$$" "$EV/.after.$$")
  nf=$(printf '%s' "$new" | grep -c . || true)
  nb=0
  if [ "$nf" -gt 0 ]; then nb=$(printf '%s\n' "$new" | xargs -d '\n' du -cb 2>/dev/null | tail -1 | cut -f1); fi
  tot=$((tot+nf)); totb=$((totb+${nb:-0}))
  names=$(printf '%s\n' "$new" | sed "s#$N/##" | head -8 | tr '\n' ' ')
  printf '%s\t%s\tfiles+=%s\tbytes+=%s\t%s\n' "$code" "$target" "$nf" "${nb:-0}" "$names"
done < "$T"
rm -f "$EV/.before.$$" "$EV/.after.$$"
echo "TOTAL($LABEL) files+=$tot bytes+=$totb"
