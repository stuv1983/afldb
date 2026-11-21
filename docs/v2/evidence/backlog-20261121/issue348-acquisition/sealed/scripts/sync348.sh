#!/usr/bin/env bash
# Push the orchestrator's changed/untracked files (DraftGuru scope) to the 348 workspace checkout.
set -euo pipefail
S=/c/Users/stuar/AppData/Local/Temp/claude/7c1ddba8e80ea2f3/585ebde3-b3fc-4a72-8b5b-ac5070a9c5a6/scratchpad
cd /d/dev/afldb-backlog-20261122
git status --porcelain --untracked-files=all | awk '{print $NF}' | grep -E '^(tools/rebuild/draftguru|legacy/offline|tests/|docs/rebuild-manifests/)' > $S/changed.txt || true
cat $S/changed.txt
tar --force-local -czf $S/chg.tgz -T $S/changed.txt
scp -q -o BatchMode=yes -i ~/.ssh/afldb_dev $S/chg.tgz arm@10.0.40.100:/mnt/ssd/afldb-backlog-20261122b-348/chg.tgz
ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100 'tar -xzf /mnt/ssd/afldb-backlog-20261122b-348/chg.tgz -C /mnt/ssd/afldb-backlog-20261122b-348/co && echo synced'
