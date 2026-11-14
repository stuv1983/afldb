#!/usr/bin/env bash
# Host: run vitest files against a FRESH disposable copy of the snapshot template, under the run-wide heavy lock.
# Usage: bash run-suite.sh <label> <dbname> <vitest path ...>      (integration paths need the DB; unit paths ignore it)
# Log: $W/evidence/<label>.log (ANSI stripped, no DSNs). Exit code = vitest's.
set -u -o pipefail
. /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh
label="$1"; db="$2"; shift 2
log="$EV/$label.log"
{
  echo "=== $label $(date -u +%FT%TZ) HEAD=$(git -C "$CAND" rev-parse HEAD) dirty=$(git -C "$CAND" status --porcelain | wc -l)"
  echo "=== database $db (fresh copy of $TMPL)"
  IR create-db "$db" --template "$TMPL" 2>&1 | strip
  flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 \
    bash -c ". /mnt/ssd/afldb-rem-admin-20261114/in/host-env.sh; cd \"$CAND\" && node --import tsx tools/v2/isolated-pg.ts run $db -- node node_modules/vitest/vitest.mjs run $* " 2>&1 | strip
  echo "=== exit ${PIPESTATUS[0]}"
} > "$log" 2>&1
tail -40 "$log" | grep -E "✓|✗|×|FAIL|Tests |Test Files|Duration|=== exit|AssertionError|expected" | head -60
