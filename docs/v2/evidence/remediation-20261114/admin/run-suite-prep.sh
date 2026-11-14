#!/usr/bin/env bash
# scope: admin-rem-20261114 (ISSUE-353/354 worker). Like run-suite.sh, but a disposable copy first has the snapshot's
# player_match_stats authority row removed (prep-authority.mjs) so the replay suites' clean-baseline guard can pass.
# Usage: bash run-suite-prep.sh <label> <dbname> <vitest path ...>
set -u -o pipefail
. /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh
label="$1"; db="$2"; shift 2
log="$EV/$label.log"
{
  echo "=== $label $(date -u +%FT%TZ) HEAD=$(git -C "$CAND" rev-parse HEAD) dirty=$(git -C "$CAND" status --porcelain | wc -l)"
  echo "=== database $db (fresh copy of $TMPL, player_match_stats authority row removed)"
  IR create-db "$db" --template "$TMPL" 2>&1 | strip
  cp /mnt/ssd/afldb-rem-admin-20261114/in/prep-authority.mjs "$CAND/.prep-authority.mjs"
  RUNDB "$db" node .prep-authority.mjs 2>&1 | strip; rm -f "$CAND/.prep-authority.mjs"
  flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 \
    bash -c ". /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh; cd \"$CAND\" && node --import tsx tools/v2/isolated-pg.ts run $db -- node node_modules/vitest/vitest.mjs run $* " 2>&1 | strip
  echo "=== exit ${PIPESTATUS[0]}"
} > "$log" 2>&1
tail -40 "$log" | grep -E "✓|✗|×|FAIL|Tests |Test Files|Duration|=== exit|AssertionError|expected" | head -60
