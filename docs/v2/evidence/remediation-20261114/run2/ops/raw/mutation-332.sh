#!/bin/bash
# scope ops: red proof by mutation. The status check must not report OK for a failed run: neutralise the Result test in a
# COPY of the script inside the host checkout, run the focused tests (expect failures), then restore the original bytes.
set -u
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd /mnt/ssd/afldb-rem2-ops-20261114/cand
unset DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_OWNER_DATABASE_URL AFLDB_BACKUP_DATABASE_URL
F=deploy/afldb-settle-failure-status.sh
cp "$F" ../out/status.orig && sha256sum "$F"
sed -i 's/elif \[ "\$result" != "success" \] || \[ "\$active" = "failed" \]; then failed=1/elif false; then failed=1/' "$F"
diff ../out/status.orig "$F" | head -4
timeout 200 nice node node_modules/vitest/vitest.mjs run tests/afl-api-ingestion-safety.test.ts -t "failure delivery" > ../out/ingestion-332-red.txt 2>&1; echo "mutated rc=$?"
cp ../out/status.orig "$F" && sha256sum "$F" && git status --porcelain | head -3
grep -E "AssertionError|Tests |FAIL" ../out/ingestion-332-red.txt | head -8
