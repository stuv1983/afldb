#!/usr/bin/env bash
# Experiment batch 2: mutations (mut.sh now restores from a byte copy). Serial.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=$W/cand
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
cd "$CAND" || exit 1
echo "##### exp2 start $(date -u +%T) HEAD=$(git rev-parse HEAD)"
sha256sum tests/integration/awards-reload-links.test.ts tests/integration/settle-afl-api-issue276.test.ts
# leftover database of the aborted batch 1 (mine; created by run.sh)
node --import tsx tools/v2/isolated-pg.ts drop-db afldb_v2_rem4coleman276_m_loaderno2026old_sn_test --acknowledge-destroy afldb_v2_rem4coleman276_m_loaderno2026old_sn_test 2>&1 | tail -1
for e in "keep2026 sn" "loader-no2026 rb" "fin-code-old rb" "fin-code rb" "fin-played-old rb" "fin-played rb" "fin-played sn"; do
  bash "$W/mutexp.sh" $e
done
echo "##### exp2 done $(date -u +%T) porcelain=$(git status --porcelain | wc -l)"
git status --porcelain
sha256sum tests/integration/awards-reload-links.test.ts tests/integration/settle-afl-api-issue276.test.ts
git diff --stat -- src tools | tail -2
