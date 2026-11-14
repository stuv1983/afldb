#!/usr/bin/env bash
# seq.sh <label> <template-db> : shared-mode interplay: brownlow-pending-projection (commits season 2066, cleans in afterAll)
# then release-gates, as two single-file vitest invocations against the SAME fresh copy, in file order.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-gates-20261115
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55682
label=$1; tmpl=$2
E="$W/evidence/it"; mkdir -p "$E"
cd "$W/cand"
unset AFLDB_TEST_PER_FILE_DB
case "$tmpl" in *_rb_*) db=afldb_v2_rb_rem4gates_${label}_test ;; *) db=afldb_v2_rem4gates_${label}_test ;; esac
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
i=0
for f in tests/integration/brownlow-pending-projection.test.ts tests/integration/release-gates.test.ts; do
  i=$((i+1))
  timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" --no-cache \
    --reporter=default --reporter=json --outputFile.json="$E/${label}_$i.json" > "$E/${label}_$i.log" 2>&1
  echo "file $i $f rc=$?"
  node -e 'const j=require(process.argv[1]);console.log("total",j.numTotalTests,"passed",j.numPassedTests,"failed",j.numFailedTests,"skipped",j.numPendingTests);for(const t of j.testResults)for(const a of t.assertionResults)if(a.status==="failed")console.log("FAIL",a.fullName,"::",(a.failureMessages[0]||"").split("\n")[0].slice(0,200))' "$E/${label}_$i.json"
done
node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -F"|" "$AFLDB_TEST_DATABASE_URL" -c "SELECT year, status FROM seasons WHERE year IN (2065, 2066)"' 2>&1 | grep -a -v '^isolated-pg:'
node --import tsx tools/v2/isolated-pg.ts drop-db "$db" --acknowledge-destroy "$db" > /dev/null 2>&1 || true
