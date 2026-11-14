#!/usr/bin/env bash
# rem3-integ phase A queue 2: what in a full shared run keeps the war-years case green after settle-afl-api-brownlow?
set -u
W=/mnt/ssd/afldb-rem3-integ-20261114
A="bash $W/in/phaseA.sh"; EV=$W/evidence/a
say() { echo "$(date -u +%FT%TZ) QUEUE2 $*" | tee -a $EV/queue.log; }
STATE="SELECT 'season2026 '||status::text FROM seasons WHERE year=2026; SELECT stat_key||' '||season||' '||coverage::text FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%' ORDER BY 1;"
D=afldb_v2_rem3integ_m2_test
say "m2 settle-afl-api first, then settle-afl-api-brownlow, then the war-years case"
$A mkq $D
{ echo "--- m2 before"; $A q $D "$STATE"; } > $EV/mech2-state-0.txt 2>&1
$A vt $D mech2-settle-afl-api 3000 tests/integration/settle-afl-api.test.ts
{ echo "--- m2 after settle-afl-api"; $A q $D "$STATE"; } > $EV/mech2-state-1.txt 2>&1
$A vt $D mech2-settle-brownlow 2400 tests/integration/settle-afl-api-brownlow.test.ts
{ echo "--- m2 after settle-afl-api then settle-afl-api-brownlow"; $A q $D "$STATE"; } > $EV/mech2-state-2.txt 2>&1
$A vt $D mech2-war-after-both 1200 tests/integration/database.test.ts -t "separates the war years"
$A drop $D
say "QUEUE2 DONE"
