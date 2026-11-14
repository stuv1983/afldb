#!/usr/bin/env bash
# srcmut.sh <label> <template-db> <relative-src-file> <sed-script-file> <test-name-pattern>
# Applies a sed mutation to ONE tracked src file of the scope checkout, runs release-gates -t <pattern> on a fresh
# --template copy, then ALWAYS restores the file with `git checkout --` and prints the porcelain (must be only the test file).
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-gates-20261115
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55682
label=$1; tmpl=$2; rel=$3; sedf=$4; pat=$5
E="$W/evidence/mut"; mkdir -p "$E"
cd "$W/cand"
unset AFLDB_TEST_PER_FILE_DB
case "$tmpl" in
  *_rb_*) db=afldb_v2_rb_rem4gates_smut_${label}_test ;;
  *) db=afldb_v2_rem4gates_smut_${label}_test ;;
esac
cp "$rel" "$W/in/srcmut.orig"
sed -i -f "$sedf" "$rel"
git diff --stat -- "$rel" | tee "$E/$label.srcdiff.txt"
git diff -U0 -- "$rel" >> "$E/$label.srcdiff.txt"
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
timeout 900 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/release-gates.test.ts --no-cache -t "$pat" \
  --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1
git checkout -- "$rel"
cmp "$rel" "$W/in/srcmut.orig" && echo "restored $rel byte-identical"
echo "porcelain: $(git status --porcelain | tr '\n' ' ')"
node -e 'const j=require(process.argv[1]);let p=0,f=0;for(const t of j.testResults)for(const a of t.assertionResults){if(a.status==="passed")p++;if(a.status==="failed"){f++;console.log("RED",a.title,"::",(a.failureMessages[0]||"").split("\n").slice(0,4).join(" | ").slice(0,420))}}console.log("passed",p,"failed",f)' "$E/$label.json"
node --import tsx tools/v2/isolated-pg.ts drop-db "$db" --acknowledge-destroy "$db" > /dev/null 2>&1 || true
