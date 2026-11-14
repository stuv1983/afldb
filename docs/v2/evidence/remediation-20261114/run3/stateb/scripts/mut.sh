#!/usr/bin/env bash
# Mutation proofs + base comparison. Run under the heavy lock AFTER batch2. Restores the checkout and proves it clean.
W=/mnt/ssd/afldb-rem3-stateb-20261114
export CAND=$W/cand
cd "$CAND" || exit 1
FINAL=$(git rev-parse stateb2)
git checkout -q stateb2 && echo "HEAD=$(git rev-parse HEAD)"
SB=tests/integration/settle-afl-api-state-b.test.ts
SA=tests/integration/settle-afl-api.test.ts

# 1. mutation: state-b's own id put back to the REAL id (old behaviour), new assertions left in place
sed -i "s|^const BRIDGED_PROVIDER_PLAYER_ID = \`CD_I\${FIXTURE_SEASON}275001\`;|const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354';|" $SB
git diff --stat | tail -1; git diff -U0 $SB | grep '^[-+]const BRIDGED_PROVIDER_PLAYER_ID'
bash "$W/in/run.sh" mutsb shared $SB
git checkout -q -- $SB; echo "restored porcelain=$(git status --porcelain | wc -l)"

# 2. mutation: settle-afl-api's own id put back to the REAL id, new assertions left in place
sed -i "s/^const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I2026228001';/const BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354';/" $SA
git diff --stat | tail -1; git diff -U0 $SA | grep '^[-+]const BRIDGED_PROVIDER_PLAYER_ID'
bash "$W/in/run.sh" mutsa shared $SA
git checkout -q -- $SA; echo "restored porcelain=$(git status --porcelain | wc -l)"

# 3. base (6d5388ea): settle-afl-api alone, shared, fresh copy -> does it delete the snapshot row?
git checkout -q base && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
bash "$W/in/run.sh" basesa shared $SA
git checkout -q stateb2 && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) final=$FINAL"
echo MUT-DONE > "$W/evidence/mut.done"
