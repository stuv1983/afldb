#!/usr/bin/env bash
# Release 17822b29, block P3: build CAND = 17822b29 in detached tmux and wait for it in this one connection (at most 9 min, polling
# the log on the host). PRODUCTION, as arm. Writes builds/ and releases/ via release.mjs only; never moves current/previous;
# nothing served changes. `release.mjs build` extracts CAND by `git archive` (deploy/release.mjs:960-1074) and copies CAND's own
# deploy/server-cluster.mjs beside the bundle (:1097), so the release carries the CAND supervisor whatever the checkout holds.
# Type-check off-host on the recorded evidence: Astra's clean npm install + typecheck of the 69538980 archive on streamanator;
# 69538980..17822b29 = records and tests/python only (P2). If the wait ends before BUILD_EXIT, run r1-p3b-build-check.sh <LOG>.
# Run: tr -d '\r' < r1-p3-build.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CAND=17822b29e6de2b6248cd7ada4221800fd81e0003
echo "== R1 P3 $(date -u +%FT%TZ)"
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS checkout CAND, porcelain empty"
if tmux has-session -t r1-build 2>/dev/null; then echo "STOP tmux session r1-build already exists"; exit 1; fi
LOG=/home/arm/r1-build-$(date -u +%Y%m%dT%H%M%SZ).log; [ ! -e "$LOG" ]
tmux new-session -d -s r1-build "export PATH=$PATH; cd $CHK && $N deploy/release.mjs build --checkout $CHK --revision $CAND \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/brownlow \
  --typecheck-evidence 'clean npm install and typecheck PASS on Linux (streamanator) of the 69538980 archive (independent final review 23 Nov); 69538980..17822b29 records and tests/python only, application tree equal (release-17822b29 P2)' \
  > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG"
echo "LOG $LOG"
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" 2>/dev/null && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3 RESULT STILL RUNNING: run r1-p3b-build-check.sh $LOG"; exit 0; fi
echo "P3 build finished $(date -u +%FT%TZ): run r1-p3b-build-check.sh $LOG"
}
main "$@" < /dev/null
