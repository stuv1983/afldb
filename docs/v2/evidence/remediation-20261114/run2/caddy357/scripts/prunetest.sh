#!/usr/bin/env bash
# caddy357: retest of prune-not-found.sh (list-then-delete) against the disposable .next with the app up on 55663.
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
D=$CAND/.next/server/app
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:55663/players/prunetest$i-9$i"; done
for i in 971 972 973; do curl -s -o /dev/null "http://127.0.0.1:55663/sitemap/$i.xml"; done
curl -s -o /dev/null "http://127.0.0.1:55663/players/prunetestwrong-11724"   # a 308
sleep 1
echo "new files for the 44 requests: $(find "$D" -newer "$W/in/prune-not-found.sh" -type f \( -name 'prunetest*' -o -name '97?.xml*' \) | wc -l)"
echo "prebuilt 200 entries before: $(find "$D/players" -maxdepth 1 -name '*.meta' | xargs grep -L '"status"' | wc -l) players without a status in .meta"
bash "$W/in/prune-not-found.sh" "$D" --min-age-minutes 0
bash "$W/in/prune-not-found.sh" "$D" --min-age-minutes 0 --delete 2>&1 | tail -3
bash "$W/in/prune-not-found.sh" "$D" --min-age-minutes 0
echo "prebuilt 200 entries after:  $(find "$D/players" -maxdepth 1 -name '*.meta' | xargs grep -L '"status"' | wc -l)"
echo "a prebuilt player and season still on disk: $(ls "$D/players/aaron-sandilands-19.html" "$D/seasons/2024.html" | wc -l)/2"
echo "pruned paths still answer: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:55663/players/prunetest1-91) $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:55663/sitemap/971.xml) $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:55663/players/prunetestwrong-11724)"
echo "refuses a wrong directory: $(bash "$W/in/prune-not-found.sh" /tmp 2>&1 | head -1)"
