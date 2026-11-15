#!/usr/bin/env bash
# Packet 6R sitting, block P7 = B1-RUNBOOK S3: start the build in detached tmux (exact packet arguments), wait for it in this one
# connection (at most 9 min, polling the log on the host), then the post-build checks. PRODUCTION, as arm. Writes builds/ and releases/
# via release.mjs only; never moves current/previous. If the wait ends before BUILD_EXIT, run p7b-s3-build-check.sh <LOG> later.
# Run: tr -d '\r' < p7-s3-build.sh | ssh afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5
echo "== P7/S3 $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$CP" ]; [ -z "$(git status --porcelain)" ]; echo "PASS checkout CP, porcelain empty"
if tmux has-session -t b1-build 2>/dev/null; then echo "STOP tmux session b1-build already exists"; exit 1; fi
LOG=/home/arm/b1-build-$(date -u +%Y%m%dT%H%M%SZ).log; [ ! -e "$LOG" ]
tmux new-session -d -s b1-build "export PATH=$PATH; cd $CHK && $N deploy/release.mjs build --checkout $CHK --revision $CP \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/draft \
  --typecheck-evidence 'npm run typecheck rc 0 on Linux (DEV streamanator, node v22.23.2) at f6af6da9 (run5/T2-QUALIFICATION.md section 2); C-prime a2e6ea99 = f6af6da9 + records-only' \
  > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG"
echo "LOG $LOG"
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" 2>/dev/null && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P7 RESULT STILL RUNNING: run p7b-s3-build-check.sh $LOG"; exit 0; fi
echo "P7 build finished $(date -u +%FT%TZ)"
}
main "$@" < /dev/null
