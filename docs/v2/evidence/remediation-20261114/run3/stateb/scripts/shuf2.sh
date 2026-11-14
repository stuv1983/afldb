#!/usr/bin/env bash
# Family with FULL shuffle (files AND tests), recorded seed, fresh copy. At the final commit.
W=/mnt/ssd/afldb-rem3-stateb-20261114
export CAND=$W/cand
cd "$CAND" && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
bash "$W/in/run.sh" ffamshuftests shared tests/integration/settle-afl-api --sequence.shuffle --sequence.seed=20261114
bash "$W/in/summall.sh" ffamshuftests
grep -n -i 'seed' "$W/evidence/ffamshuftests/vitest.log" | head -3
grep -n -i 'seed' "$W/evidence/ffamshuf/vitest.log" | head -3
echo SHUF2-DONE
