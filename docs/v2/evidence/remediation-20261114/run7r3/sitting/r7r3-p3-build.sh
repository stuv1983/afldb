#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block P3 = S3: start the build of CAND in detached tmux, wait for it in this one connection (at most 9 min, polling the
# log on the host). PRODUCTION, as arm. Writes builds/ and releases/ via release.mjs only; never moves current/previous.
# The build extracts CAND from Git, runs npm ci and next build against the checkout's .env (the production database, read for
# prerendering), so prebuilt player pages already carry the D-370-W wording. Type-check off-host on the recorded DEV evidence.
# If the wait ends before BUILD_EXIT, run r7r3-p3b-build-check.sh <LOG> later.
# Run: tr -d '\r' < r7-p3-build.sh | ssh afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CAND=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76
echo "== R7R3 P3/S3 $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS checkout CAND, porcelain empty"
if tmux has-session -t r7r3-build 2>/dev/null; then echo "STOP tmux session r7r3-build already exists"; exit 1; fi
LOG=/home/arm/r7r3-build-$(date -u +%Y%m%dT%H%M%SZ).log; [ ! -e "$LOG" ]
tmux new-session -d -s r7r3-build "export PATH=$PATH; cd $CHK && $N deploy/release.mjs build --checkout $CHK --revision $CAND \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/draft \
  --typecheck-evidence 'npm run typecheck rc 0 on Linux (DEV streamanator, node v22.23.2) at c8d4202a, exact tree (run7r3/DEV-QUALIFICATION.md section 2)' \
  > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG"
echo "LOG $LOG"
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" 2>/dev/null && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3 RESULT STILL RUNNING: run r7r3-p3b-build-check.sh $LOG"; exit 0; fi
echo "P3 build finished $(date -u +%FT%TZ): run r7r3-p3b-build-check.sh $LOG"
}
main "$@" < /dev/null
