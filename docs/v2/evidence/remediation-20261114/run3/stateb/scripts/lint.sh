#!/usr/bin/env bash
# typecheck + eslint on the changed files at the checkout's HEAD
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-stateb-20261114
cd "$W/cand" || exit 1
echo "HEAD=$(git rev-parse HEAD) porcelain-before=$(git status --porcelain | wc -l)"
timeout 900 node node_modules/next/dist/bin/next typegen > "$W/evidence/typegen.log" 2>&1; echo "typegen rc=$?"
timeout 900 node node_modules/typescript/bin/tsc --noEmit -p . > "$W/evidence/tsc.log" 2>&1; echo "tsc rc=$?"; tail -5 "$W/evidence/tsc.log"
timeout 900 node node_modules/eslint/bin/eslint.js tests/integration/settle-afl-api-state-b.test.ts tests/integration/settle-afl-api.test.ts > "$W/evidence/eslint.log" 2>&1; echo "eslint rc=$?"; tail -15 "$W/evidence/eslint.log"
echo "porcelain-after=$(git status --porcelain | wc -l)"
