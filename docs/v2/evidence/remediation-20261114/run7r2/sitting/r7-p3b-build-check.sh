#!/usr/bin/env bash
# Release 7 revision 2 (R7R2), block P3b = S3 post-build checks (read-only). PRODUCTION, as arm.
# Waits up to 9 min for BUILD_EXIT in the given log, then reads the release id, verifies it and prints its BUILD_ID (for S9).
# Run: tr -d '\r' < r7-p3b-build-check.sh | ssh afldb bash -s -- <LOG>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
OLD_ID=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5; OLD_PREV=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x
LOG=${1:?LOG}; [[ $LOG =~ ^/home/arm/r7-build-[0-9]{8}T[0-9]{6}Z\.log$ ]]
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3b RESULT STILL RUNNING"; exit 0; fi
echo "== R7 P3b/S3 checks $(date -u +%FT%TZ)"
NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1); echo "NEW_ID $NEW_ID"
grep -q '^BUILD_EXIT=0$' "$LOG"; [[ $NEW_ID =~ ^a3c8c67cc98f-[A-Za-z0-9_-]{1,64}$ ]]; echo "PASS BUILD_EXIT=0 and READY id"
tail -n 1 "$ROOT/events.log"
"$N" deploy/release.mjs verify "$NEW_ID"
echo "BUILD_ID $(cat "$ROOT/releases/$NEW_ID/.next/standalone/.next/BUILD_ID")"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "PASS links untouched"
grep -E '^release: (admission|smoke|build:|npm ci:)' "$LOG" || true
[ -z "$(git status --porcelain)" ]; echo "PASS checkout porcelain empty"
echo "P3b RESULT BUILD PASS $NEW_ID"
}
main "$@" < /dev/null
