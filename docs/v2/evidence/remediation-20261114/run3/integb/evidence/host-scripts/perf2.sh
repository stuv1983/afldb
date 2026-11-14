#!/usr/bin/env bash
# perf2.sh: club-comparison "long rivalry performance" on copies of the bridged base, with and without planner statistics
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
cd "$W/in"
T=afldb_v2_rem3integb_rb_bridged_test
bash it.sh perfa_nostats $T tests/integration/club-comparison.test.ts -t 'long rivalry performance' 2>&1 | tail -2
# the same copy as perfA, then ANALYZE only (no data change), through isolated-pg run (credentials stay in the child's environment)
cd "$W/cand"
db=afldb_v2_rem3integb_it_perfb_stats_test
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$T" 2>&1 | tail -1
node --import tsx tools/v2/isolated-pg.ts run "$db" -- node --input-type=module -e "import postgres from 'postgres'; const s=postgres(process.env.AFLDB_TEST_DATABASE_URL,{max:1}); await s.unsafe('ANALYZE'); await s.end(); console.log('analyze done')" 2>&1 | grep -a -v '^isolated-pg:'
timeout 1700 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/club-comparison.test.ts --no-cache -t 'long rivalry performance' \
  --reporter=default --reporter=json --outputFile.json="$W/evidence/it/perfb_stats.json" > "$W/evidence/it/perfb_stats.log" 2>&1
echo "perfB rc=$?"
node -e 'const j=require(process.argv[1]);console.log("perfb_stats total",j.numTotalTests,"passed",j.numPassedTests,"failed",j.numFailedTests)' "$W/evidence/it/perfb_stats.json"
