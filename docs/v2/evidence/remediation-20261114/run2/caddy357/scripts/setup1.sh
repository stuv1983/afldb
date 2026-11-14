#!/usr/bin/env bash
# caddy357 step 1: checkout of the base + npm ci. SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u -o pipefail
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W" || exit 1
echo "$(sha256sum /mnt/ssd/afldb-rem2-base/base-e8666c17.bundle)" | tee "$EV/bundle-sha256.txt"
[ "$(cut -d' ' -f1 "$EV/bundle-sha256.txt")" = 02940af6d3065abae2e0cd42f8ca6384462a42350a293401b368d0db2453d44a ] || { echo "bundle sha mismatch"; exit 1; }
[ -d "$CAND" ] || git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || exit 1
cd "$CAND" || exit 1
git fetch -q /mnt/ssd/afldb-rem2-base/base-e8666c17.bundle claude/remediation-20261114:refs/heads/base 2>&1 | tail -2
git checkout -q base && git rev-parse HEAD
git status --porcelain | wc -l
nice -n 10 npm ci --no-audit --no-fund > "$EV/npm-ci.log" 2>&1; echo "npm ci rc=$?"
echo SETUP1_DONE
