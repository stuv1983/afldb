#!/usr/bin/env bash
# hostops: second light batch (pinned neighbours of my edits) + restore-test.test.sh. Short targeted runs, no heavy lock (disclosed).
W=/mnt/ssd/afldb-rem-hostops-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd "$W"
W=$W LIGHT=1 timeout 600 bash in/vitest-files.sh green-neighbours tests/afl-api-cutover.test.ts tests/afl-api-ingestion-safety.test.ts tests/db-promotion-check.test.ts tests/register-issue224-s9-dev-write-gate.test.ts tests/v2-shadow-capture.test.ts tests/db-test-rebuild.test.ts > "$W/green-neighbours.out" 2>&1
echo "exit $?" >> "$W/green-neighbours.out"
cd "$W/cand"
{ echo "== bash tests/restore-test.test.sh"; nice -n 10 bash tests/restore-test.test.sh; echo "exit $?"; } > "$W/restore-test-sh.out" 2>&1
