#!/usr/bin/env bash
# baseline (unfixed de640826) reproduction: three focused suites, and six python suites in 3 interpreter configs
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
cd "$CAND" || exit 1
echo "HEAD=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
V="env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run"
echo "=== A: three focused suites (no python vars)"
$V tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts 2>&1 | strip | grep -E "^ +(×|FAIL)|Tests |Test Files" | head -60
SIX="tests/after-siren-normalisation.test.ts tests/brownlow-season-artefact.test.ts tests/coach-reconciliation.test.ts tests/sibling-reconciliation.test.ts tests/father-son-reconciliation.test.ts tests/height-reconciliation.test.ts"
echo "=== B: six python suites, nothing set (host python3)"
env -u PYTHON -u AFLDB_PYTHON node node_modules/vitest/vitest.mjs run $SIX 2>&1 | strip | grep -E "Tests |Test Files"
echo "=== C: six python suites, ONLY AFLDB_PYTHON=venv"
env -u PYTHON AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python node node_modules/vitest/vitest.mjs run $SIX 2>&1 | strip | grep -E "^ +(×|FAIL)|Tests |Test Files" | head -40
echo "=== D: six python suites, ONLY PYTHON=venv (control)"
env -u AFLDB_PYTHON PYTHON=/home/arm/i250/afldb/.venv/bin/python node node_modules/vitest/vitest.mjs run $SIX 2>&1 | strip | grep -E "^ +(×|FAIL)|Tests |Test Files" | head -40
