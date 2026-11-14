#!/usr/bin/env bash
. /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh
label="$1"
{ echo "=== $label $(date -u +%FT%TZ) HEAD=$(git -C $CAND rev-parse HEAD) dirty=$(git -C $CAND status --porcelain | wc -l)"
  flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 bash -c "cd $CAND && node node_modules/next/dist/bin/next typegen && node node_modules/typescript/bin/tsc --noEmit -p ." 2>&1 | strip
  echo "=== exit ${PIPESTATUS[0]}"; } > $EV/$label.log 2>&1
