#!/usr/bin/env bash
# FINAL qualification on a checkout whose HEAD equals the final local code commit, with an empty porcelain.
# usage: final-qual.sh <40-hex final commit>
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
set -u
FINAL=${1:?}
F=$W/final
VP=/home/arm/i250/afldb/.venv/bin/python
LOCK="flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3"
rm -rf "$F"
git clone -q "$CAND" "$F" || exit 1
cd "$F" || exit 1
git fetch -q "$W/pins.bundle" "HEAD:refs/heads/rem-pins" || exit 1
git checkout -q --detach "$FINAL" || exit 1
cp -al "$CAND/node_modules" "$F/node_modules"
echo "FINAL HEAD=$(git rev-parse HEAD)"
echo "porcelain lines: $(git status --porcelain | wc -l)"
git log --oneline -7
sha256sum "$W/pins.bundle"
echo "=== F1 whole unit gate once (all non-integration suites, no DB variables, only AFLDB_PYTHON=venv)"
env -u PYTHON -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL AFLDB_PYTHON=$VP $LOCK node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
  --reporter=default --reporter=json --outputFile.json="$EV/final-unit.json" > "$EV/final-unit-verbose.log" 2>&1
echo "unit rc=$?"
strip < "$EV/final-unit-verbose.log" | grep -E "Tests |Test Files|Duration" | tail -5
echo "=== F2 the named focused suites alone"
env -u PYTHON -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL AFLDB_PYTHON=$VP nice -n 10 node node_modules/vitest/vitest.mjs run \
  tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts tests/reference-data.test.ts \
  tests/after-siren-normalisation.test.ts tests/brownlow-season-artefact.test.ts tests/coach-reconciliation.test.ts tests/sibling-reconciliation.test.ts tests/father-son-reconciliation.test.ts tests/height-reconciliation.test.ts \
  > "$EV/final-focused.log" 2>&1
strip < "$EV/final-focused.log" | grep -E "^ +(×|FAIL)|Tests |Test Files" | tail -12
echo "=== F3 nl-answers-relationships on a fresh snapshot copy (final checkout)"
DB=afldb_v2_rempins_fin_test
IR create-db "$DB" --template "$TMPL" || exit 1
(cd "$F" && node --import tsx tools/v2/isolated-pg.ts run "$DB" -- node node_modules/vitest/vitest.mjs run tests/integration/nl-answers-relationships.test.ts 2>&1 | strip | grep -E "×|Tests |Test Files")
IR drop-db "$DB" --acknowledge-destroy "$DB" 2>&1 | tail -1
cd "$F"
echo "porcelain lines after: $(git status --porcelain | wc -l)"; git status --porcelain | head -5
echo "HEAD after=$(git rev-parse HEAD)"
