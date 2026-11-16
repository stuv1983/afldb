#!/usr/bin/env bash
# Packet 6R sitting, block P7b = B1-RUNBOOK S3 post-build checks (read-only). PRODUCTION, as arm.
# Waits up to 9 min for BUILD_EXIT in the given log, then reads the id and verifies it.
# Run: tr -d '\r' < p7b-s3-build-check.sh | ssh afldb bash -s -- <LOG>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; OLD_PREV=0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN
LOG=${1:?LOG}; [[ $LOG =~ ^/home/arm/b1-build-[0-9]{8}T[0-9]{6}Z\.log$ ]]
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P7b RESULT STILL RUNNING"; exit 0; fi
echo "== P7b/S3 checks $(date -u +%FT%TZ)"
NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1); echo "NEW_ID $NEW_ID"
grep -q '^BUILD_EXIT=0$' "$LOG"; [[ $NEW_ID =~ ^a2e6ea9995a4-[A-Za-z0-9_-]{1,64}$ ]]; echo "PASS BUILD_EXIT=0 and READY id"
tail -n 1 "$ROOT/events.log"
"$N" deploy/release.mjs verify "$NEW_ID"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "PASS links untouched"
grep -E '^release: (admission|smoke|build:|npm ci:)' "$LOG" || true
[ -z "$(git status --porcelain)" ]; echo "PASS checkout porcelain empty"
echo "P7b RESULT BUILD PASS $NEW_ID"
}
main "$@" < /dev/null
