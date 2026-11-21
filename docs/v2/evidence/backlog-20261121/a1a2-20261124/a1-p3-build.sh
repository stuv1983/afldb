#!/usr/bin/env bash
# Sitting A1, block P3: build CAND = 7d92042f in detached tmux and wait for it in this one connection (at most 9 min, polling
# the log on the host). PRODUCTION, as arm. Writes builds/ and releases/ via release.mjs only; never moves current/previous;
# nothing served changes. Type-check off-host on the recorded evidence (cf158d60 typecheck rc 0 on Linux; CAND has the same
# executable tree, P2). If the wait ends before BUILD_EXIT, run a1-p3b-build-check.sh <LOG>.
# Run: tr -d '\r' < a1-p3-build.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CAND=7d92042fd11010eaa20966e2f49ae7a93e286568
echo "== A1 P3 $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS checkout CAND, porcelain empty"
if tmux has-session -t a1-build 2>/dev/null; then echo "STOP tmux session a1-build already exists"; exit 1; fi
LOG=/home/arm/a1-build-$(date -u +%Y%m%dT%H%M%SZ).log; [ ! -e "$LOG" ]
tmux new-session -d -s a1-build "export PATH=$PATH; cd $CHK && $N deploy/release.mjs build --checkout $CHK --revision $CAND \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/brownlow \
  --typecheck-evidence 'npm run typecheck rc 0 on Linux (streamanator, node v22.23.2) at cf158d60; cf158d60..7d92042f records-only and executable tree equal (RC-371-372.md section 1, A1 P2)' \
  > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG"
echo "LOG $LOG"
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" 2>/dev/null && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3 RESULT STILL RUNNING: run a1-p3b-build-check.sh $LOG"; exit 0; fi
echo "P3 build finished $(date -u +%FT%TZ): run a1-p3b-build-check.sh $LOG"
}
main "$@" < /dev/null
