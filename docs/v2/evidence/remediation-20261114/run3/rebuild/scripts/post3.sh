#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
REB=/mnt/ssd/afldb-rem3-base/rebuilt
DUMP=$REB/afldb_v2_rb_rem3-6d5388ea.dump
SHA=$(cut -d' ' -f1 $W/evidence/dump.sha256)
RDB=afldb_v2_rb_rem3_restore_test
cp $W/restore-dump.mjs $REB/restore-dump.mjs
echo "== recipe step 1: create-db =="
IR create-db $RDB
echo "== recipe step 2: restore =="
node --import tsx tools/v2/isolated-pg.ts run $RDB -- node $REB/restore-dump.mjs $DUMP $SHA 2>&1 | tee $W/evidence/restore-verify.out
echo "== recipe step 3: verify =="
IR verify $RDB
IR list
cp $W/probe-rebuilt.mjs .probe-rebuilt.mjs; cp $W/probe-counts.mjs .probe-counts.mjs
node --import tsx tools/v2/isolated-pg.ts run $RDB -- node .probe-rebuilt.mjs $RDB > $W/evidence/probe-restored.json 2>$W/evidence/probe-restored.err
node --import tsx tools/v2/isolated-pg.ts run $RDB -- node .probe-counts.mjs $RDB > $W/evidence/table-counts-restored.tsv 2>$W/evidence/table-counts-restored.err
rm -f .probe-rebuilt.mjs .probe-counts.mjs
echo "restored tables=$(wc -l < $W/evidence/table-counts-restored.tsv)"
if diff -u $W/evidence/table-counts-source.tsv $W/evidence/table-counts-restored.tsv > $W/evidence/table-counts.diff; then echo "TABLE COUNTS IDENTICAL (83 tables)"; else echo "TABLE COUNTS DIFFER"; head -20 $W/evidence/table-counts.diff; fi
cat $W/evidence/probe-restored.json
echo "porcelain=$(git status --porcelain | wc -l)"
