#!/usr/bin/env bash
# ISSUE-372 requalification at cf158d60: focused unit, typecheck, lint:gate at cand2 (no build here; the harness builds).
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH NEXT_TELEMETRY_DISABLED=1
W=/mnt/ssd/afldb-backlog-20261122-q; cd $W/cand2; E=$W/evidence/cand2; mkdir -p $E
npx vitest run tests/settle-season-revalidation.test.ts tests/v2-coleman-projection.test.ts tests/admin-brownlow-actions.test.ts tests/auth.test.ts > $E/unit-cand2.log 2>&1; echo "unit rc=$?" > $E/part1-rc.txt
npm run typecheck > $E/typecheck-cand2.log 2>&1; echo "typecheck rc=$?" >> $E/part1-rc.txt
npm run lint:gate > $E/lint-gate-cand2.log 2>&1; echo "lint:gate rc=$?" >> $E/part1-rc.txt
echo done >> $E/part1-rc.txt
