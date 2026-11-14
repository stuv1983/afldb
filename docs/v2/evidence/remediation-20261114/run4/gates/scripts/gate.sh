#!/usr/bin/env bash
# gate.sh typecheck|lint : exit-gate checks in the scope checkout, under the heavy lock
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-gates-20261115
cd "$W/cand"
case "$1" in
  typecheck)
    flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 npm run typecheck > "$W/evidence/typecheck.out" 2>&1
    echo "typecheck rc=$?" | tee -a "$W/evidence/typecheck.out"
    ;;
  lint)
    flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 npm run lint:gate > "$W/evidence/lint-gate.out" 2>&1
    echo "lint:gate rc=$?" | tee -a "$W/evidence/lint-gate.out"
    ;;
esac
