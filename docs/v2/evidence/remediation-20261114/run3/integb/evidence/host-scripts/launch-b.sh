#!/usr/bin/env bash
# launch run-rebuilt.sh detached: launch-b.sh <tag> [extra run-rebuilt args...]
set -uo pipefail
W=/mnt/ssd/afldb-rem3-integb-20261114
R=/mnt/ssd/afldb-rem3-base/rebuilt
TAG=$1; shift
cd "$W/cand"
setsid nohup bash docs/v2/evidence/remediation-20261114/run3/integ/run-rebuilt.sh \
  --dump $R/afldb_v2_rb_rem3-6d5388ea.dump \
  --sha256 d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63 \
  --bridge $R/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json \
  --keep-cluster --tag "$TAG" "$@" > "$W/in/run-$TAG.out" 2>&1 < /dev/null &
echo "pid $!"
