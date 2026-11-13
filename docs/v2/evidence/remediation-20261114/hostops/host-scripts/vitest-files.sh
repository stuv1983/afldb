#!/usr/bin/env bash
# hostops: run focused Vitest files in $W/cand, no database variables. Default: under the host-wide heavy-job lock (run-wide R-1).
# LIGHT=1: skip the lock for a SHORT targeted run (two files, ~25 s, nice/ionice still applied); disclosed in the report because
# the lock queue held ~12 waiters behind a 30+ minute full-suite run.
# Usage: W=/mnt/ssd/afldb-rem-hostops-20261114 [LIGHT=1] bash vitest-files.sh <log-name> <file> [<file>...]
set -u
: "${W:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
name="$1"; shift
cd "$W/cand" || exit 2
echo "HEAD=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
free -g | sed -n 2p; df -h /mnt/ssd | tail -1; uptime
LOCK=(flock /mnt/ssd/afldb-rem-20261114-heavy.lock)
[ "${LIGHT:-}" = 1 ] && LOCK=()
env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL "${LOCK[@]}" nice -n 10 ionice -c3 \
  node node_modules/vitest/vitest.mjs run "$@" --reporter=default > "$W/evidence/$name.log" 2>&1
rc=$?
sed 's/\x1b\[[0-9;]*m//g' "$W/evidence/$name.log" | grep -E "FAIL|Tests |Test Files|Duration|AssertionError|Error:" | head -60
echo "rc=$rc"
exit $rc
