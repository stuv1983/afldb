#!/usr/bin/env bash
# caddy357 step 3 (app on 55663 in open mode): fresh-name persistence through Caddy, search idle check, body-diff check, prune test.
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
D=$CAND/.next/server/app
OUT=$EV/step3; mkdir -p "$OUT"
echo "== body differences: does the app render those pages differently on every request?"
bash "$W/in/bodydiff.sh"
bash "$W/in/caddyapp.sh" start "$W/caddy-bin/caddy-2.11.4" "$W/in/cf/Caddyfile.production" step3 || exit 1
echo "== fresh names through Caddy (first 6 are well-formed unknown: expected to reach Next and persist; the rest are junk: expected 0)"
bash "$W/persist.sh" $CADDY_PORT "$W/in/persist-targets3.txt" via-caddy-fresh | tee "$OUT/persist-fresh-via-caddy.tsv" | cut -c1-150
echo "== /search?q=most+goals in Chromium, direct vs through Caddy"
cp "$W/in/idle.mjs" "$CAND/.idle.mjs"; (cd "$CAND" && timeout 200 node .idle.mjs); rm -f "$CAND/.idle.mjs"
bash "$W/in/caddyapp.sh" stop
echo "== prune test on the disposable .next (dry run first)"
ls "$D/players/fresh-unknown-name-871001".* "$D/players/fresh-unknown-name-871001.segments" 2>&1 | head -5
bash "$W/in/prune-not-found.sh" "$D" --min-age-minutes 0
echo "-- delete:"
bash "$W/in/prune-not-found.sh" "$D" --delete --min-age-minutes 0
echo "-- after: dry run again (expect 0) and the entry is gone:"
bash "$W/in/prune-not-found.sh" "$D" --min-age-minutes 0
ls "$D/players/fresh-unknown-name-871001".* 2>&1 | head -2
echo "-- the app still answers the pruned path the same way, and re-persists it:"
curl -s -o /dev/null -w 'status=%{http_code}\n' -H 'Host: beta.afldb.com' http://127.0.0.1:55663/players/fresh-unknown-name-871001
sleep 1; ls "$D/players/fresh-unknown-name-871001".* | head -3
echo "-- a legit canonical page is untouched:"
curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:55663/seasons/2024; ls "$D/seasons/2024.html"
echo STEP3-DONE
