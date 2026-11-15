#!/usr/bin/env bash
# run-4 leaks scope: exit gates on the clean final-commit checkout: typecheck and lint:gate (ratchet; never --update), each under the heavy lock.
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-leaks-20261115; E=$W/evidence; CO=$W/cand
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
echo "HEAD=$(git -C $CO rev-parse HEAD) porcelain=$(git -C $CO status --porcelain | wc -l)" > $E/gates.out
flock /mnt/ssd/afldb-rem4-base/heavy.lock nice -n 10 bash -c "cd $CO && timeout 1500 npm run typecheck" > $E/typecheck.log 2>&1; echo "typecheck rc=$?" >> $E/gates.out
flock /mnt/ssd/afldb-rem4-base/heavy.lock nice -n 10 bash -c "cd $CO && timeout 1500 npm run lint:gate" > $E/lint-gate.log 2>&1; echo "lint:gate rc=$?" >> $E/gates.out
echo "HEAD-after=$(git -C $CO rev-parse HEAD) porcelain-after=$(git -C $CO status --porcelain | wc -l)" >> $E/gates.out
echo done >> $E/gates.out
