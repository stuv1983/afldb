#!/usr/bin/env bash
set -euo pipefail
W=/mnt/ssd/afldb-rem3-rebuild-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
mkdir -p "$W/evidence" "$W/capture-root"
cd "$W"
echo "bundle sha256:"; sha256sum /mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle
test "$(sha256sum /mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle | cut -d' ' -f1)" = "0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68"
if [ ! -d "$W/cand" ]; then
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$W/cand"
fi
cd "$W/cand"
git fetch -q /mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle claude/remediation-20261114:refs/heads/base
git checkout -q base
HEAD=$(git rev-parse HEAD); echo "HEAD=$HEAD"
test "$HEAD" = "6d5388ea5305e73b0420fbccfa7b0cea4fe75927"
echo "porcelain:"; git status --porcelain | head
ls -a | grep -i '^\.env' || echo "no .env in checkout"
timeout 480 npm ci --no-audit --no-fund 2>&1 | tail -5
echo "npm ci rc=$?"
ls node_modules/tsx/dist/cli.mjs
