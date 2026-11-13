#!/usr/bin/env bash
# init/start cluster on 55611 and build the production-snapshot template (ledger 118). Follows review-host.sh p4_cluster/p5_template.
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
set -u -o pipefail
cd "$CAND" || exit 1
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port $PORT in use"; exit 1; fi
[ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; exit 1; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; exit 1; }
echo "snapshot verified $DUMP_SHA"
IR init || exit 1
IR start > "$EV/pg-start.out" 2>&1 < /dev/null
sleep 3
IR roles && IR status || exit 1
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
ss -ltnp 2>/dev/null | grep ":$PORT " > "$EV/listener.txt"; cat "$EV/listener.txt"; echo "postmaster pid $pmpid"
[ "$(grep -c "127.0.0.1:$PORT " "$EV/listener.txt")" = 1 ] || { echo "not exactly one listener"; exit 1; }
[ "$(grep -c "pid=$pmpid," "$EV/listener.txt")" = 1 ] || { echo "listener is not our postmaster"; exit 1; }
IR create-db "$TMPL" || exit 1
RUNDB "$TMPL" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || exit 1
RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
rm -f "$CAND/.probe-dbs.mjs"
grep -q '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" || { echo "template ledger is not 118"; exit 1; }
echo "TEMPLATE READY"
