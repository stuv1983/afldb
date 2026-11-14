#!/usr/bin/env bash
# rem3-integ phase A queue 3: does vitest's file order decide the war-years case in a shared-mode run?
# Same two files, one invocation, a fresh snapshot copy each: (a) with vitest's results cache (failed files first),
# (b) with --no-cache (no history: files ordered by size).
set -u
W=/mnt/ssd/afldb-rem3-integ-20261114
A="bash $W/in/phaseA.sh"; EV=$W/evidence/a; CAND=$W/cand
say() { echo "$(date -u +%FT%TZ) QUEUE3 $*" | tee -a $EV/queue.log; }
ls -la $CAND/node_modules/.vite/vitest/ 2>&1 | head -5 > $EV/mech3-cache-state.txt
for v in a b; do
  D=afldb_v2_rem3integ_m3${v}_test
  say "m3$v"
  $A mkq $D
  if [ $v = a ]; then
    $A vt $D mech3-order-with-cache 2400 tests/integration/settle-afl-api-brownlow.test.ts tests/integration/database.test.ts
  else
    $A vt $D mech3-order-no-cache 2400 tests/integration/settle-afl-api-brownlow.test.ts tests/integration/database.test.ts --no-cache
  fi
  $A drop $D
done
say "QUEUE3 DONE"
