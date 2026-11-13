#!/usr/bin/env bash
# usage: green.sh <tag>   focused qualification on $CAND (whatever it holds); logs to $EV/<tag>-*.log
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
TAG=${1:-iter}
cd "$CAND" || exit 1
LOCK="flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3"
echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
V="node node_modules/vitest/vitest.mjs run"
VP=/home/arm/i250/afldb/.venv/bin/python
echo "=== A: three focused suites + wrapper (only AFLDB_PYTHON=venv, no DB vars)"
env -u PYTHON -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL AFLDB_PYTHON=$VP $LOCK $V tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts tests/reference-data.test.ts > "$EV/$TAG-focused.log" 2>&1
strip < "$EV/$TAG-focused.log" | grep -E "^ +(×|FAIL)|Tests |Test Files" | head -40
echo "=== B: six python suites, ONLY AFLDB_PYTHON=venv"
SIX="tests/after-siren-normalisation.test.ts tests/brownlow-season-artefact.test.ts tests/coach-reconciliation.test.ts tests/sibling-reconciliation.test.ts tests/father-son-reconciliation.test.ts tests/height-reconciliation.test.ts"
env -u PYTHON -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL AFLDB_PYTHON=$VP $LOCK $V $SIX > "$EV/$TAG-six.log" 2>&1
strip < "$EV/$TAG-six.log" | grep -E "^ +(×|FAIL)|Tests |Test Files" | head -40
