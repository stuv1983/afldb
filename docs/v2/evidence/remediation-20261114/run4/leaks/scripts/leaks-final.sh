#!/usr/bin/env bash
# run-4 leaks scope: per-file-mode proof of the 7 changed files on the clean final-commit checkout, both bases (heavy lock held for each multi-file group).
set -u -o pipefail
IN=/mnt/ssd/afldb-rem4-leaks-20261115/in; W=/mnt/ssd/afldb-rem4-leaks-20261115; L=/mnt/ssd/afldb-rem4-base/heavy.lock
F7="tests/integration/match-results-promotion.test.ts tests/integration/draftguru-import.test.ts tests/integration/dob-enrichment-issues.test.ts tests/integration/submission-promotion.test.ts tests/integration/sealed-editor-guard.test.ts tests/integration/match-admin-delete.test.ts tests/integration/join-request-approval.test.ts"
export LOCKCMD=env
echo "HEAD=$(git -C $W/cand rev-parse HEAD) porcelain=$(git -C $W/cand status --porcelain | wc -l)"
flock $L bash $IN/leaks-pf.sh finalsnap afldb_v2_rem4leaks_snap_tmpl_test $W/cand $F7 > $W/evidence/run-pf-finalsnap.out 2>&1
flock $L bash $IN/leaks-pf.sh finalrb   afldb_v2_rem4leaks_rb_tmpl_test   $W/cand $F7 > $W/evidence/run-pf-finalrb.out 2>&1
echo "HEAD-after=$(git -C $W/cand rev-parse HEAD) porcelain-after=$(git -C $W/cand status --porcelain | wc -l)"
echo done
