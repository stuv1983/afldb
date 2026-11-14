#!/usr/bin/env bash
# Static checks of the committed checkout, queued behind the shared heavy lock. Usage: bash final-static.sh
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=$W/cand
cd "$CAND" || exit 1
mkdir -p "$W/ev/final"
echo "##### static start $(date -u +%T) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
echo "##### typecheck"
( flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 npm run typecheck > "$W/ev/final/typecheck.log" 2>&1; echo "typecheck rc=$?" ) | tee "$W/ev/final/typecheck.rc"
tail -3 "$W/ev/final/typecheck.log"
echo "##### lint:gate"
( flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 npm run lint:gate > "$W/ev/final/lint-gate.log" 2>&1; echo "lint:gate rc=$?" ) | tee "$W/ev/final/lint-gate.rc"
tail -6 "$W/ev/final/lint-gate.log"
echo "##### static done $(date -u +%T) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
