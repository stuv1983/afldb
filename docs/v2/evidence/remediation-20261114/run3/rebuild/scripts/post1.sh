#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
echo "HEAD=$(git rev-parse HEAD) porcelain_before=$(git status --porcelain | wc -l)"
IR verify $DB
cp $W/probe-rebuilt.mjs .probe-rebuilt.mjs
cp $W/probe-counts.mjs .probe-counts.mjs
node --import tsx tools/v2/isolated-pg.ts run $DB -- node .probe-rebuilt.mjs $DB > $W/evidence/probe-rebuilt.json 2> $W/evidence/probe-rebuilt.err
echo "probe rc=$?"
node --import tsx tools/v2/isolated-pg.ts run $DB -- node .probe-counts.mjs $DB > $W/evidence/table-counts-source.tsv 2> $W/evidence/table-counts-source.err
echo "counts rc=$? tables=$(wc -l < $W/evidence/table-counts-source.tsv)"
rm -f .probe-rebuilt.mjs .probe-counts.mjs
echo "porcelain_after=$(git status --porcelain | wc -l)"
cat $W/evidence/probe-rebuilt.json
