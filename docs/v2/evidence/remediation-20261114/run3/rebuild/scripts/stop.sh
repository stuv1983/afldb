#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) env_file=$(ls -a | grep -c '^\.env$')"
IR list
IR stop
IR status || true
echo "--- listener on $AFLDB_V2_PG_PORT:"
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$AFLDB_V2_PG_PORT\$" || echo "none"
echo "--- processes of mine under $W / $AFLDB_V2_PG_ROOT:"
pgrep -u arm -af "$W" | grep -v "pgrep" || echo "none"
pgrep -u arm -af "$AFLDB_V2_PG_ROOT" | grep -v "pgrep" || echo "none (pg root)"
du -sh $W $AFLDB_V2_PG_ROOT
