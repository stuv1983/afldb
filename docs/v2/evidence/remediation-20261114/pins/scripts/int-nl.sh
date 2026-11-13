#!/usr/bin/env bash
# nl-answers-relationships on a fresh snapshot copy: RED with the de640826 literal (658), GREEN with the fixed file
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
set -u
DB=afldb_v2_rempins_int_test
IR create-db "$DB" --template "$TMPL" || exit 1
cd "$CAND" || exit 1
echo "=== RED: de640826 test file (hasBrother 658) on the snapshot copy"
git show de640826d13489c58392563e7ae1ff62403ed293:tests/integration/nl-answers-relationships.test.ts > tests/integration/zz-old-nl-answers-relationships.test.ts
RUNDB "$DB" node node_modules/vitest/vitest.mjs run tests/integration/zz-old-nl-answers-relationships.test.ts 2>&1 | strip | grep -E "AssertionError|expected|×|Tests |Test Files" | head -12 | cut -c1-250
rm -f tests/integration/zz-old-nl-answers-relationships.test.ts
echo "=== GREEN: fixed test file on the same snapshot copy (hasBrother from the tracked provenance measure)"
RUNDB "$DB" node node_modules/vitest/vitest.mjs run tests/integration/nl-answers-relationships.test.ts 2>&1 | strip | grep -E "AssertionError|expected|×|Tests |Test Files" | head -12 | cut -c1-250
git status --porcelain | grep zz-old
IR drop-db "$DB" --acknowledge-destroy "$DB" 2>&1 | tail -1
