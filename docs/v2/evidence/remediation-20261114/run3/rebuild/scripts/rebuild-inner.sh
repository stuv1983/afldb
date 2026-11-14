#!/usr/bin/env bash
# Runs INSIDE setsid nohup; holds the heavy lock for the whole rebuild.
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
cd "$C"
ATTEMPT=${1:-1}
echo "start_utc=$(date -u +%FT%TZ) attempt=$ATTEMPT HEAD=$(git rev-parse HEAD) bashpid=$$"
exec 9>/mnt/ssd/afldb-rem3-base/heavy.lock
flock 9
echo "lock_acquired_utc=$(date -u +%FT%TZ)"
S=$(date +%s)
node --import tsx tools/v2/isolated-pg.ts run $DB -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy $DB
RC=$?
E=$(date +%s)
echo "end_utc=$(date -u +%FT%TZ) elapsed_s=$((E-S)) rc=$RC"
echo "$RC" > "$W/evidence/rebuild.exit$ATTEMPT"
