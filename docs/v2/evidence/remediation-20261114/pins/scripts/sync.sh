#!/usr/bin/env bash
# iteration helper: scp the changed tracked files from the pins worktree into the host checkout (NOT the final qualification)
cd /d/dev/afldb-rem-pins || exit 1
FILES=$( (git diff --name-only; git ls-files --others --exclude-standard) | grep -v '^docs/v2/evidence/remediation-20261114' )
tar cf - $FILES | ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100 'cd /mnt/ssd/afldb-rem-pins-20261114/cand && tar xf - && git status --porcelain'
