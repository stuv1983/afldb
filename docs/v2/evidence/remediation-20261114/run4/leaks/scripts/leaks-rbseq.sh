#!/usr/bin/env bash
# run-4 leaks scope: rebuild-base focused sequence: per-file red (B4 files) + green (fixed files), then the shared-mode chain red + green.
set -u -o pipefail
IN=/mnt/ssd/afldb-rem4-leaks-20261115/in; W=/mnt/ssd/afldb-rem4-leaks-20261115
RB=afldb_v2_rem4leaks_rb_tmpl_test
F7="tests/integration/match-results-promotion.test.ts tests/integration/draftguru-import.test.ts tests/integration/dob-enrichment-issues.test.ts tests/integration/submission-promotion.test.ts tests/integration/sealed-editor-guard.test.ts tests/integration/match-admin-delete.test.ts tests/integration/join-request-approval.test.ts"
CHAIN="tests/integration/match-results-promotion.test.ts tests/integration/draftguru-import.test.ts tests/integration/dob-enrichment-issues.test.ts tests/integration/admin-season-lists.test.ts tests/integration/submission-promotion.test.ts tests/integration/settle-afl-api-state-b.test.ts tests/integration/sealed-editor-guard.test.ts tests/integration/match-admin-delete.test.ts tests/integration/special-records-lifecycle.test.ts tests/integration/afl-api-c7-observation.test.ts tests/integration/join-request-approval.test.ts"
export LOCKCMD=env
bash $IN/leaks-pf.sh redrb $RB $W/cand-red $F7 > $W/evidence/run-pf-redrb.out 2>&1
bash $IN/leaks-pf.sh greenrb $RB $W/cand $F7 > $W/evidence/run-pf-greenrb.out 2>&1
CAND=$W/cand-red bash $IN/leaks-attrib.sh chainredrb $RB - $CHAIN > $W/evidence/run-chainredrb.out 2>&1
CAND=$W/cand bash $IN/leaks-attrib.sh chaingreenrb $RB - $CHAIN > $W/evidence/run-chaingreenrb.out 2>&1
echo done-rbseq > $W/evidence/rbseq.done
