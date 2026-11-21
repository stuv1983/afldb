#!/usr/bin/env bash
# ISSUE-372 requalification at cf158d60: green2 (awards, builds cand2) then green2_brownlow (reuses that build).
W=/mnt/ssd/afldb-backlog-20261122-q; cd $W
bash h/i372-repro.sh run green2 cand2 awards > evidence/run-green2.out 2>&1
SKIP_BUILD=1 bash h/i372-repro.sh run green2_brownlow cand2 brownlow > evidence/run-green2_brownlow.out 2>&1
echo CHAINDONE > evidence/chain2.done
