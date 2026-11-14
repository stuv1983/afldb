#!/usr/bin/env bash
set -euo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$AFLDB_V2_PG_PORT\$"; then echo "port $AFLDB_V2_PG_PORT already in use"; exit 1; fi
test ! -e "$AFLDB_V2_PG_ROOT/data/postmaster.pid" || { echo "cluster already present"; exit 1; }
IR init
IR start > $W/evidence/pg-start.out 2>&1 < /dev/null
sleep 3
IR roles
IR status
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
ss -ltnp 2>/dev/null | grep ":$AFLDB_V2_PG_PORT " | tee $W/evidence/listener.txt
echo "postmaster pid $pmpid"
[ "$(grep -c "127.0.0.1:$AFLDB_V2_PG_PORT " $W/evidence/listener.txt)" = 1 ]
[ "$(grep -c "pid=$pmpid," $W/evidence/listener.txt)" = 1 ]
IR create-db $DB
IR list
IR verify $DB || true
