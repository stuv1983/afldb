#!/bin/bash
# Run as rehearsal. Extract the exact candidate merge tree into the private root.
set -euo pipefail
R=/home/rehearsal/afldb-329-proof-20261030T233836Z
S=/mnt/c/Users/stuar/AppData/Local/Temp/claude/D--dev-afldbV2/35e65da4-c177-4941-b84d-de349e1323f7/scratchpad
C=$R/candidate-6790983a
umask 022
[ -e "$C" ] && { echo "exists: $C"; exit 1; }
mkdir -p "$C"
tar -xf "$S/cand-6790983a.tar" -C "$C"
echo "extracted $(find "$C" -type f | wc -l) files"
cd "$C"
sha256sum deploy/release.mjs deploy/server-cluster.mjs deploy/afldb.service deploy/afldb.service.d/release-route.conf tools/build/env-in-standalone.mjs package-lock.json
echo "=== m7 proof tree 1a95a5c3 vs committed 44251c1f (path-level blob diff)"
cd "$R/tools-checkout"
git -c safe.directory='*' ls-tree -r 1a95a5c3 > /tmp/lstree-1a95.txt
tr -d '\r' < "$S/lstree-44251c1f.txt" > /tmp/lstree-4425.txt
diff /tmp/lstree-4425.txt /tmp/lstree-1a95.txt && echo "IDENTICAL trees (blob-for-blob)"
git -c safe.directory='*' rev-parse 1a95a5c3^{tree}
