#!/usr/bin/env bash
# mut.sh <label> <template-db> <sqlfile|-> <test-name-pattern> [mode: shared]
# Fresh --template copy of <template-db>, apply <sqlfile> (a data mutation, as the db owner), then run release-gates
# filtered to <test-name-pattern> (vitest -t). Prints the per-test verdicts. The copy is dropped afterwards.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-gates-20261115
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55682
label=$1; tmpl=$2; sqlf=$3; pat=$4
E="$W/evidence/mut"; mkdir -p "$E"
cd "$W/cand"
unset AFLDB_TEST_PER_FILE_DB
case "$tmpl" in
  *_rb_*) db=afldb_v2_rb_rem4gates_mut_${label}_test ;;
  *) db=afldb_v2_rem4gates_mut_${label}_test ;;
esac
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
if [ "$sqlf" != "-" ]; then
  node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c '"$AFLDB_V2_PG_BIN/psql" -X -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$sqlf" 2>&1 | { grep -a -v '^isolated-pg:' || true; } | tee "$E/$label.mutation.out"
fi
timeout 900 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/release-gates.test.ts --no-cache -t "$pat" \
  --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1
node -e 'const j=require(process.argv[1]);let p=0,f=0;for(const t of j.testResults)for(const a of t.assertionResults){if(a.status==="passed")p++;if(a.status==="failed"){f++;console.log("RED",a.title,"::",(a.failureMessages[0]||"").split("\n").slice(0,4).join(" | ").slice(0,420))}}console.log("passed",p,"failed",f)' "$E/$label.json"
node --import tsx tools/v2/isolated-pg.ts drop-db "$db" --acknowledge-destroy "$db" > /dev/null 2>&1 || true
