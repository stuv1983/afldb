#!/usr/bin/env bash
# DIAGNOSTIC ONLY (never committed): run a copy of an integration test file with expect.soft so every mismatching
# witness of every test is reported in one pass. softrun.sh <test-file-relative> <template-db> <label>
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
f=$1; tmpl=$2; label=$3
cd "$W/cand"
soft="$(dirname "$f")/zz-soft-$(basename "$f")"
sed -E 's/^( {4,})expect\(/\1expect.soft(/' "$f" > "$soft"
db=afldb_v2_rem3integb_soft_${label}_test
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
mkdir -p "$W/evidence/soft"
timeout 1700 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$soft" \
  --reporter=default --reporter=json --outputFile.json="$W/evidence/soft/$label.json" > "$W/evidence/soft/$label.log" 2>&1
echo "rc=$?"
rm -f "$soft"
git status --porcelain | head -3
