#!/usr/bin/env bash
# usage: unit.sh <label> <vitest files...>   (no database variables)
. /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh
label="$1"; shift
{ echo "=== $label $(date -u +%FT%TZ) HEAD=$(git -C $CAND rev-parse HEAD) dirty=$(git -C $CAND status --porcelain | wc -l)"
  flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 bash -c "cd $CAND && env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run $*" 2>&1 | strip
  echo "=== exit ${PIPESTATUS[0]}"; } > $EV/$label.log 2>&1
