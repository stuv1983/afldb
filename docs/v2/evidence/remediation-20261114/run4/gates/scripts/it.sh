#!/usr/bin/env bash
# it.sh <label> <template-db> <mode: shared|all> <test-file> [vitest args...]
# One file against a FRESH --template copy of <template-db>; JSON + log into $W/evidence/it
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-gates-20261115
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55682
label=$1; tmpl=$2; mode=$3; f=$4; shift 4
E="$W/evidence/it"; mkdir -p "$E"
cd "$W/cand"
case "$mode" in
  all) export AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" ;;
  shared) unset AFLDB_TEST_PER_FILE_DB ;;
esac
case "$tmpl" in
  *_rb_*) db=afldb_v2_rb_rem4gates_${label}_test ;;
  *) db=afldb_v2_rem4gates_${label}_test ;;
esac
echo "HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l) mode=$mode db=$db" | tee "$E/$label.head"
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
timeout 1700 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" --no-cache "$@" \
  --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1
echo "rc=$?"
node -e 'const j=require(process.argv[1]);console.log("total",j.numTotalTests,"passed",j.numPassedTests,"failed",j.numFailedTests,"skipped",j.numPendingTests)' "$E/$label.json"
node -e 'const j=require(process.argv[1]);for(const f of j.testResults)for(const a of f.assertionResults)if(a.status==="failed")console.log("FAIL",a.fullName,"::",(a.failureMessages[0]||"").split("\n")[0])' "$E/$label.json"
node --import tsx tools/v2/isolated-pg.ts drop-db "$db" --acknowledge-destroy "$db" > /dev/null 2>&1 || true
