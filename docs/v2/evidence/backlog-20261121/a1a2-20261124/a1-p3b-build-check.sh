#!/usr/bin/env bash
# Sitting A1, block P3b: post-build checks (read-only). PRODUCTION, as arm.
# Waits up to 9 min for BUILD_EXIT, then checks the owner's pins BEFORE any promotion:
#   the release id starts 7d92042fd110- AND release.json "revision" is the full 7d92042fd11010eaa20966e2f49ae7a93e286568
#   (if the tooling did not pin 7d92042f: STOP before promotion, nothing to roll back); release.mjs verify PASS; links untouched.
# Prints NEW_ID and the new BUILD_ID (for S9 and the rollback record).
# Run: tr -d '\r' < a1-p3b-build-check.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <LOG>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CAND=7d92042fd11010eaa20966e2f49ae7a93e286568; CUR=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; PREV=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5
LOG=${1:?LOG}; [[ $LOG =~ ^/home/arm/a1-build-[0-9]{8}T[0-9]{6}Z\.log$ ]]
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3b RESULT STILL RUNNING"; exit 0; fi
echo "== A1 P3b $(date -u +%FT%TZ)"
NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1); echo "NEW_ID $NEW_ID"
grep -q '^BUILD_EXIT=0$' "$LOG"; echo "PASS BUILD_EXIT=0"
[[ $NEW_ID =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]] || { echo "STOP release id does not start 7d92042fd110-: tooling did not pin the candidate; do NOT promote"; exit 1; }
REV=$("$N" -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).revision))' "$ROOT/releases/$NEW_ID/release.json")
[ "$REV" = "$CAND" ] || { echo "STOP release.json revision $REV is not $CAND; do NOT promote"; exit 1; }
echo "PASS release id prefix 7d92042fd110- and release.json revision = $CAND"
tail -n 1 "$ROOT/events.log"
"$N" deploy/release.mjs verify "$NEW_ID"
echo "BUILD_ID $(cat "$ROOT/releases/$NEW_ID/.next/standalone/.next/BUILD_ID")"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ]; [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]; echo "PASS links untouched"
grep -E '^release: (admission|smoke|build:|npm ci:)' "$LOG" || true
[ -z "$(git status --porcelain)" ]; [ "$(git rev-parse HEAD)" = "$CAND" ]; echo "PASS checkout CAND, porcelain empty"
echo "P3b RESULT BUILD PASS $NEW_ID"
}
main "$@" < /dev/null
