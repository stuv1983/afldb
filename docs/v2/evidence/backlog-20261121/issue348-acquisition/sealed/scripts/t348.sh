#!/usr/bin/env bash
# Focused DraftGuru regression for the F-348-1 change (unit + python contracts), on the 348 workspace checkout.
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-348; C=$W/co; E=$W/ev; mkdir -p "$E"
export AFLDB_PYTHON=$W/venv/bin/python
cd "$C" || exit 1
[ -d node_modules ] || { npm ci --no-audit --no-fund > "$E/npm-ci.log" 2>&1; echo "npm ci rc=$?"; }
node node_modules/vitest/vitest.mjs run tests/draftguru-acquisition.test.ts tests/draftguru-import.test.ts \
  tests/db-test-rebuild.test.ts tests/reference-data.test.ts > "$E/vitest-dg.log" 2>&1; echo "vitest rc=$?"
grep -E "Test Files|Tests  |FAIL|✗|×" "$E/vitest-dg.log" | head -40
for f in tests/python/draftguru_*contract.py; do
  out=$("$AFLDB_PYTHON" "$f" 2>&1); rc=$?; echo "$rc $(basename "$f") $(printf '%s' "$out" | tail -1 | cut -c1-90)"
done
