#!/usr/bin/env bash
# typecheck (whole project, filtered to the changed files) and eslint on the changed tests
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
cd "$W/cand"
echo "HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)"
timeout 900 node node_modules/typescript/bin/tsc --noEmit > "$W/evidence/tsc.out" 2>&1; echo "tsc rc=$? lines=$(wc -l < "$W/evidence/tsc.out")"
grep -E "settle-afl-api-brownlow|settle-afl-api-issue276|tests/integration/database\.test" "$W/evidence/tsc.out" | head -10 || true
echo "-- tsc errors total: $(grep -c 'error TS' "$W/evidence/tsc.out")"
timeout 600 node node_modules/eslint/bin/eslint.js tests/integration/settle-afl-api-brownlow.test.ts tests/integration/settle-afl-api-issue276.test.ts tests/integration/database.test.ts; echo "eslint rc=$?"
