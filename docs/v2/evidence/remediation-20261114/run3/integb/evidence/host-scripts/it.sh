#!/usr/bin/env bash
# it.sh <label> <template-db> <test-file> [vitest args...] : one file, shared mode, fresh copy, JSON + log into evidence/it
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem3-integb-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
label=$1; tmpl=$2; f=$3; shift 3
E="$W/evidence/it"; mkdir -p "$E"
cd "$W/cand"
db=afldb_v2_rem3integb_it_${label}_test
echo "HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)" | tee "$E/$label.head"
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
timeout 1700 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" --no-cache "$@" \
  --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1
echo "rc=$?"
node -e 'const j=require(process.argv[1]);console.log("total",j.numTotalTests,"passed",j.numPassedTests,"failed",j.numFailedTests,"skipped",j.numPendingTests)' "$E/$label.json"
