#!/usr/bin/env bash
# rbfail exit gate: typecheck and lint:gate (no --update, ever) on the host checkout, under ONE hold of the heavy lock.
#   flock /mnt/ssd/afldb-rem4-base/heavy.lock bash gate.sh <tag>
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-rbfail-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
tag=${1:-gate}
cd "$W/cand" || exit 1
echo "HEAD=$(git rev-parse HEAD)"
git status --porcelain
echo "== typecheck"; timeout 1500 npm run typecheck > "$W/evidence/$tag-typecheck.log" 2>&1; echo "typecheck rc=$?"
tail -5 "$W/evidence/$tag-typecheck.log"
echo "== lint:gate"; timeout 1500 npm run lint:gate > "$W/evidence/$tag-lintgate.log" 2>&1; echo "lint:gate rc=$?"
tail -12 "$W/evidence/$tag-lintgate.log"
git status --porcelain
