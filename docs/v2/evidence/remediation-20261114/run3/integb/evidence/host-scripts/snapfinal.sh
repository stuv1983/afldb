#!/usr/bin/env bash
# snapshot-copy results at the final HEAD for the files this scope touched or classified (fresh copy per file, shared mode)
set -uo pipefail
W=/mnt/ssd/afldb-rem3-integb-20261114
S=afldb_v2_rem3integb_snap_tmpl_test
cd "$W/in"
bash it.sh sf_de $S tests/integration/data-editor.test.ts
bash it.sh sf_aw $S tests/integration/awards-reload-links.test.ts
bash it.sh sf_276 $S tests/integration/settle-afl-api-issue276.test.ts
bash it.sh sf_cole $S tests/integration/v2-coleman-publication.test.ts
bash it.sh sf_db $S tests/integration/database.test.ts
bash it.sh sf_brn $S tests/integration/settle-afl-api-brownlow.test.ts
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
cd "$W/cand"
D=afldb_v2_rb_rem3bs_test
node --import tsx tools/v2/isolated-pg.ts create-db "$D" --template $S 2>&1 | tail -1
timeout 1700 node --import tsx tools/v2/isolated-pg.ts run "$D" -- node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api.test.ts --no-cache -t 'OD-5 reinstate \(rolled back, no rebuild\)' \
  --reporter=default --reporter=json --outputFile.json="$W/evidence/it/sf_od5.json" > "$W/evidence/it/sf_od5.log" 2>&1
echo "od5 rc=$?"
node -e 'const j=require(process.argv[1]);console.log("sf_od5 total",j.numTotalTests,"passed",j.numPassedTests,"failed",j.numFailedTests,"skipped",j.numPendingTests)' "$W/evidence/it/sf_od5.json"
