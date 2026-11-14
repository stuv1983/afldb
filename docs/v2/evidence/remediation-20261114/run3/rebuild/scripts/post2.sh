#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
R=6d5388ea
REB=/mnt/ssd/afldb-rem3-base/rebuilt
mkdir -p $REB
DUMP=$REB/afldb_v2_rb_rem3-$R.dump
echo "== pg_dump -Fc =="
node --import tsx tools/v2/isolated-pg.ts run $DB -- node $W/dump-db.mjs $DUMP 2>&1 | tee $W/evidence/dump.out
ls -l $DUMP
sha256sum $DUMP | tee $W/evidence/dump.sha256
echo "== pg_restore -l header + database comment entry =="
$AFLDB_V2_PG_BIN/pg_restore -l $DUMP > $W/evidence/dump.toc.txt 2>&1
head -16 $W/evidence/dump.toc.txt
grep -c . $W/evidence/dump.toc.txt
grep -n "COMMENT - DATABASE\|EXTENSION" $W/evidence/dump.toc.txt | head
echo "== bridge child (export_person_bridge.py --resolve-against isolated, parent v3, read-only rolled-back) =="
CHILD=$REB/afldb_v2_rb_rem3-draftguru-bridge-child-v3-$R.json
node --import tsx tools/v2/isolated-pg.ts run $DB -- $AFLDB_PYTHON tools/rebuild/draftguru/export_person_bridge.py --resolve-against isolated --parent data/reference/draftguru-person-bridge-20260918-v3.json --out $CHILD 2>&1 | tee $W/evidence/bridge-export.out | cut -c1-240
ls -l $CHILD && sha256sum $CHILD | tee $W/evidence/bridge-child.sha256
echo "porcelain=$(git status --porcelain | wc -l)"
