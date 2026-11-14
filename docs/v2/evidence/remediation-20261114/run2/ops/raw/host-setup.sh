#!/bin/bash
# scope ops: create the host workspace and the base checkout (AGENT-BRIEF-COMMON), then npm ci. Own workspace only.
set -eu
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem2-ops-20261114
mkdir -p "$W/in" "$W/out"
cd "$W"
if [ ! -d cand ]; then
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$W/cand"
fi
cd "$W/cand"
git fetch -q /mnt/ssd/afldb-rem2-base/base-e8666c17.bundle claude/remediation-20261114:refs/heads/base
git checkout -q base
git rev-parse HEAD
timeout 900 nice npm ci --no-audit --no-fund > "$W/out/npm-ci.log" 2>&1; echo "npm ci rc=$?"
git status --porcelain | head
