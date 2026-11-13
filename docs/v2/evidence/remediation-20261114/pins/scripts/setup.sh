#!/usr/bin/env bash
set -u -o pipefail
W=/mnt/ssd/afldb-rem-pins-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
mkdir -p "$W/evidence" "$W/in"
cd "$W"
if [ ! -d cand ]; then
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$W/cand" || exit 1
fi
cd "$W/cand"
git checkout -q --detach de640826d13489c58392563e7ae1ff62403ed293 || exit 1
echo "HEAD=$(git rev-parse HEAD)"
npm ci --no-audit --no-fund 2>&1 | tail -5
echo "status: $(git status --porcelain | wc -l)"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
stat -c %s "$DUMP"; sha256sum "$DUMP" | cut -d' ' -f1
