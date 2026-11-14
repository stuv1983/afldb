#!/usr/bin/env bash
# caddy357: real-app checks through the candidate production Caddyfile. usage: viacaddy.sh <binary> <label> <browse yes|no>
# Needs the app on 55663 (serve.sh start open). Starts/stops its own Caddy (caddyapp.sh).
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
BIN=$1; LABEL=$2; BROWSE=$3
OUT=$EV/viacaddy-$LABEL; mkdir -p "$OUT"
D=$CAND/.next
fcount() { find "$D/server/app" "$D/cache" -type f | wc -l; }
bash "$W/in/caddyapp.sh" start "$BIN" "$W/in/cf/Caddyfile.production" "$LABEL" || exit 1
awk -F'\t' 'NR%100==1{print $2}' "$W/corpus/legit.tsv" > "$OUT/urls-compare.txt"
awk -F'\t' '{print $2}' "$W/corpus/open.tsv" >> "$OUT/urls-compare.txt"
echo "== 1. identical responses direct vs through Caddy ($(wc -l < "$OUT/urls-compare.txt") URLs)"
node "$W/in/compare.mjs" "$OUT/urls-compare.txt" "$OUT/compare.tsv"
grep -c '^DIFF' "$OUT/compare.tsv" | sed 's/^/DIFF rows: /'
echo "-- DIFF rows grouped by differing header set:"; grep '^DIFF' "$OUT/compare.tsv" | cut -f4,5 | sort | uniq -c | sort -rn | head -8
echo "== 2. the whole deny corpus through Caddy to the REAL app: files persisted before/after"
f0=$(fcount); k0=$(du -sck "$D/server/app" "$D/cache" | tail -1 | cut -f1)
node "$W/in/client.mjs" "$W/corpus/deny.tsv" $CADDY_PORT "$OUT/deny-result.tsv" 2>&1 | sed 's/^/  /'
sleep 2; f1=$(fcount); k1=$(du -sck "$D/server/app" "$D/cache" | tail -1 | cut -f1)
echo "  files before=$f0 after=$f1 (delta $((f1-f0)))  disk KiB delta $((k1-k0))"
cut -f4 "$OUT/deny-result.tsv" | sort | uniq -c | sed 's/^/  status /'
echo "== 3. persistence of the target list through Caddy (what still reaches Next persists; the rest does not)"
bash "$W/persist.sh" $CADDY_PORT "$W/in/persist-targets.txt" "via-caddy-$LABEL" > "$OUT/persist-via-caddy.tsv" 2>&1
tail -1 "$OUT/persist-via-caddy.tsv"
echo "  statuses:"; cut -f1 "$OUT/persist-via-caddy.tsv" | sort | uniq -c | sed 's/^/    /' | head -8
echo "  paths that persisted files THROUGH Caddy:"; awk -F'\t' '$3!="files+=0" && $1!~/TOTAL/{print "    "$1" "$2" "$3}' "$OUT/persist-via-caddy.tsv"
if [ "$BROWSE" = yes ]; then
  echo "== 4. real Chromium through Caddy (candidate CSP/HSTS in force)"
  cp "$W/in/browse.mjs" "$CAND/.browse.mjs"
  (cd "$CAND" && timeout 600 node .browse.mjs "$OUT/browse") 2>&1 | tail -45
  rm -f "$CAND/.browse.mjs"
fi
bash "$W/in/caddyapp.sh" stop
echo VIACADDY-DONE "$LABEL"
