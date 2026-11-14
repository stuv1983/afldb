#!/usr/bin/env bash
# Same full-shuffle family run at BASE (6d5388ea), same seed, fresh copy; then back to the final commit.
W=/mnt/ssd/afldb-rem3-stateb-20261114
export CAND=$W/cand
cd "$CAND" || exit 1
git checkout -q base && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
bash "$W/in/run.sh" basefamshuftests shared tests/integration/settle-afl-api --sequence.shuffle --sequence.seed=20261114
bash "$W/in/summall.sh" basefamshuftests
git checkout -q stateb2 && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
echo SHUF3-DONE
