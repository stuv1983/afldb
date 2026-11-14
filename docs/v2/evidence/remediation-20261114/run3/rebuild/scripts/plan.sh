#!/usr/bin/env bash
set -uo pipefail
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
test ! -e .env || { echo ".env present"; exit 9; }
echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
timeout 480 node --import tsx tools/v2/isolated-pg.ts run $DB -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy $DB --plan "$@" > $W/evidence/plan.out 2>&1
echo "plan rc=$?"
wc -l $W/evidence/plan.out
