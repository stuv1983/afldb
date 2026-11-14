#!/usr/bin/env bash
# caddy357 step 2: isolated cluster on 55673, restore-verified template, then a production build under the heavy lock.
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u -o pipefail
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
case "$W" in /mnt/ssd/afldb-rem2-caddy357-20261114) ;; *) echo "wrong workspace"; exit 1;; esac
cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/" || exit 1
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PG_PORT$"; then echo "port $PG_PORT in use"; exit 1; fi
[ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; exit 1; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; exit 1; }
echo "snapshot verified"
IR init || exit 1
IR start > "$EV/pg-start.out" 2>&1 < /dev/null
sleep 3
IR roles && IR status || exit 1
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
ss -ltnp 2>/dev/null | grep ":$PG_PORT " | tee "$EV/pg-listener.txt"
[ "$(grep -c "127.0.0.1:$PG_PORT " "$EV/pg-listener.txt")" = 1 ] || { echo "not exactly one listener"; exit 1; }
IR create-db "$TMPL" || exit 1
RUNDB "$TMPL" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || exit 1
RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
rm -f "$CAND/.probe-dbs.mjs"
grep -q '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" || { echo "template ledger is not 118"; exit 1; }
echo TEMPLATE_OK
DB=afldb_v2_rem2caddy357_app_test
IR create-db "$DB" --template "$TMPL" 2>&1 | tail -1
export AFLDB_INDEXING=on AFLDB_BASE_URL=https://aflcaddy357.test NEXT_TELEMETRY_DISABLED=1
t0=$(date +%s)
(cd "$CAND" && flock "$HEAVY" nice -n 10 ionice -c3 node --import tsx tools/v2/isolated-pg.ts run "$DB" -- bash -c "cd '$CAND' && env NODE_ENV=production node node_modules/next/dist/bin/next build --webpack") > "$EV/build.log" 2>&1
rc=$?
echo "build rc=$rc seconds=$(( $(date +%s) - t0 ))"
strip < "$EV/build.log" | tail -8
echo "BUILD_ID=$(cat "$CAND/.next/BUILD_ID" 2>/dev/null)"
echo SETUP2_DONE
