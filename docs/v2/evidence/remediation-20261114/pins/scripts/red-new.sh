#!/usr/bin/env bash
# Red demonstrations of the NEW tests against the UNFIXED sources (de640826 versions), in a throwaway copy of the checkout.
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
set -u
VP=/home/arm/i250/afldb/.venv/bin/python
RED=$W/red; rm -rf "$RED"; mkdir -p "$RED"
# throwaway worktree-like copy: hard-link-free clone of the candidate, with node_modules symlinked (never modified)
git clone -q "$CAND" "$RED/c" || exit 1
cd "$RED/c" && git checkout -q --detach de640826d13489c58392563e7ae1ff62403ed293 || exit 1
ln -s "$CAND/node_modules" node_modules
# overlay ONLY the new/changed tests from the candidate working tree
for f in tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts tests/reference-data.test.ts tests/python-interpreter.ts \
         tests/after-siren-normalisation.test.ts tests/brownlow-season-artefact.test.ts tests/coach-reconciliation.test.ts tests/sibling-reconciliation.test.ts tests/father-son-reconciliation.test.ts tests/height-reconciliation.test.ts; do
  cp "$CAND/$f" "$f"
done
echo "unfixed sources, new tests: HEAD=$(git rev-parse HEAD) changed=$(git status --porcelain | tr '\n' ' ')"
V="env -u PYTHON -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL AFLDB_PYTHON=$VP node node_modules/vitest/vitest.mjs run"
echo "=== R1 recompute-every-pin test + stage map + restore order vs UNFIXED rebuild-test.ts / architecture.md / restore pin source"
$V tests/db-test-rebuild.test.ts -t "ISSUE-358 every reviewed input pin" 2>&1 | strip | grep -E "AssertionError|stale|pinned|×|FAIL|Tests " | head -20 | cut -c1-400
echo "=== R2 six suites with ONLY AFLDB_PYTHON on the UNFIXED suites (de640826 test files)"
git checkout -q -- tests/after-siren-normalisation.test.ts tests/brownlow-season-artefact.test.ts tests/coach-reconciliation.test.ts tests/sibling-reconciliation.test.ts tests/father-son-reconciliation.test.ts tests/height-reconciliation.test.ts
$V tests/sibling-reconciliation.test.ts 2>&1 | strip | grep -E "ModuleNotFoundError|python exited|Tests |Test Files" | sort | uniq -c | head -8 | cut -c1-300
echo "=== R3 new wrapper vs UNFIXED fitzroy contract (only the 1c row must fail)"
$V tests/reference-data.test.ts -t "standalone Python contracts" 2>&1 | strip | grep -E "×|FAIL|1c |Tests " | head -12 | cut -c1-300
echo "=== R4 new restore-order pin: mutations of tools/maintenance/restore-test.sh (candidate tests, mutated script)"
cp "$CAND/tests/db-promotion-check.test.ts" tests/db-promotion-check.test.ts
cp "$CAND/tools/maintenance/restore-test.sh" /tmp/rt.orig.$$
# (a) the identity guard no longer opens the clear stream
"$VP" - <<'PY'
import re
p='tools/maintenance/restore-test.sh'
s=open(p,encoding='utf8').read()
a="  identity_guard_sql\n  printf 'COMMENT ON DATABASE %s IS NULL;"
assert a in s
open(p,'w',encoding='utf8').write(s.replace(a,"  printf 'COMMENT ON DATABASE %s IS NULL;",1))
PY
$V tests/db-promotion-check.test.ts -t "restore-test.sh hashes before restoring" 2>&1 | strip | grep -E "AssertionError|×|Tests " | head -5 | cut -c1-300
cp /tmp/rt.orig.$$ tools/maintenance/restore-test.sh
# (b) the bind is written before the restore
"$VP" - <<'PY'
p='tools/maintenance/restore-test.sh'
s=open(p,encoding='utf8').read()
bind="    printf \"COMMENT ON DATABASE %s IS 'afldb.restore_test.v1 sha256=%s';\\n\" \"$RESTORE_DB\" \"$BACKUP_SHA256\"\n"
assert bind in s
s=s.replace(bind,"    true\n",1)
s=s.replace("START=$(date +%s)\n","START=$(date +%s)\nprintf \"COMMENT ON DATABASE %s IS 'afldb.restore_test.v1 sha256=%s';\\n\" \"$RESTORE_DB\" \"$BACKUP_SHA256\"\n",1)
open(p,'w',encoding='utf8').write(s)
PY
$V tests/db-promotion-check.test.ts -t "restore-test.sh hashes before restoring" 2>&1 | strip | grep -E "AssertionError|×|Tests " | head -5 | cut -c1-300
cp /tmp/rt.orig.$$ tools/maintenance/restore-test.sh; rm -f /tmp/rt.orig.$$
git status --porcelain tools/ | head -3
echo "=== R5 stage-map test vs UNFIXED docs/v2/architecture.md"
$V tests/v2-acquisition-pipeline.test.ts -t "rendered stage map" 2>&1 | strip | grep -E "AssertionError|stale|settle-afl-api.ts:35|×|Tests " | head -10 | cut -c1-300
echo "=== R6 new inventory test: a contract nobody runs"
echo '#!/usr/bin/env python3' > tests/python/zz_unwired_contract.py
$V tests/reference-data.test.ts -t "every tests/python" 2>&1 | strip | grep -E "AssertionError|zz_unwired|×|Tests " | head -6 | cut -c1-300
rm -f tests/python/zz_unwired_contract.py
