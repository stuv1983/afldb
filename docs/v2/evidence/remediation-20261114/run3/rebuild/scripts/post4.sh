#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
REB=/mnt/ssd/afldb-rem3-base/rebuilt
RDB=afldb_v2_rb_rem3_restore_test
CHILD=$REB/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
echo "== import child onto the RESTORED COPY only (verification of the documented step) =="
node --import tsx tools/v2/isolated-pg.ts run $RDB -- $AFLDB_PYTHON tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge $CHILD 2>&1 | tee $W/evidence/bridge-import-on-copy.out | cut -c1-220 | tail -40
echo "rc=${PIPESTATUS[0]}"
cp $W/probe-rebuilt.mjs .probe-rebuilt.mjs
node --import tsx tools/v2/isolated-pg.ts run $RDB -- node .probe-rebuilt.mjs $RDB 2>&1 | grep -A6 '"draft"'
rm -f .probe-rebuilt.mjs
echo "porcelain=$(git status --porcelain | wc -l)"
