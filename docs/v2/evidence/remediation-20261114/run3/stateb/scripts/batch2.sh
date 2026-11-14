#!/usr/bin/env bash
# Final-commit proof matrix. Each experiment on its own FRESH template copy. SEED recorded.
W=/mnt/ssd/afldb-rem3-stateb-20261114
export CAND=$W/cand
cd "$W" || exit 1
T=tests/integration
SB=$T/settle-afl-api-state-b.test.ts
SA=$T/settle-afl-api.test.ts
SEED=20261114
R="$1"   # round tag, e.g. f
run() { echo "### $*"; timeout 3400 "$@"; }
run bash "$W/in/run.sh" ${R}green1 shared $SB
run bash "$W/in/run.sh" ${R}green2 all $SB
run bash "$W/in/order.sh" ${R}ordsbfirst shared $SB $SA
run bash "$W/in/order.sh" ${R}ordsafirst shared $SA $SB
run bash "$W/in/run.sh" ${R}famshuf shared $T/settle-afl-api --sequence.shuffle.files --sequence.seed=$SEED
run bash "$W/in/order.sh" ${R}famrev shared $SA $SB $T/settle-afl-api-issue276.test.ts $T/settle-afl-api-fixtures.test.ts \
    $T/settle-afl-api-brownlow.test.ts $T/settle-afl-api-brownlow-reschedule.test.ts $T/settle-afl-api-brownlow-backtest.test.ts
run bash "$W/in/run.sh" ${R}famfwd shared $T/settle-afl-api
run bash "$W/in/run.sh" ${R}famall all $T/settle-afl-api
run bash "$W/in/ownleft.sh" ${R}ownleft
echo "BATCH2-DONE" > "$W/evidence/${R}batch2.done"
