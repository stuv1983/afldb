#!/usr/bin/env bash
# Release 17822b29, block P3b: post-build checks (read-only) BEFORE any promotion. PRODUCTION, as arm.
# Waits up to 9 min for BUILD_EXIT, then requires: BUILD_EXIT=0; the release id starts 17822b29e6de-; release.json revision is the
# full CAND; the release's deploy/server-cluster.mjs is byte-equal to Git blob CAND:deploy/server-cluster.mjs (sha256 4e8ea9b5...)
# and its MANIFEST pins that hash (so promotion selects these supervisor bytes); release.mjs verify PASS; links untouched.
# Any failure: STOP before promotion; production unchanged; the unpromoted release directory is harmless.
# Prints NEW_ID and the new BUILD_ID (for S9, the browser check and the rollback record).
# Run: tr -d '\r' < r1-p3b-build-check.sh | MSYS_NO_PATHCONV=1 C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <LOG>
#      (MSYS_NO_PATHCONV=1 on ssh.exe: Git Bash would otherwise rewrite the /home/arm/... argument; Sunday defect D2)
# Test seam: R1_LIB_ONLY=1 when sourced; release_pins <release-dir> <revision> <supervisor-sha256>.
release_pins() { # release-dir revision supervisor-sha256
  local rel=$1 rev=$2 sup=$3 r h
  r=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).revision))' "$rel/release.json") || { echo "STOP release.json unreadable"; return 1; }
  [ "$r" = "$rev" ] || { echo "STOP release.json revision $r is not $rev; do NOT promote"; return 1; }
  h=$(sha256sum < "$rel/deploy/server-cluster.mjs" | cut -c1-64) || { echo "STOP no supervisor in the release"; return 1; }
  [ "$h" = "$sup" ] || { echo "STOP release supervisor sha256 $h is not the pinned blob $sup; do NOT promote"; return 1; }
  grep -qx "$sup  deploy/server-cluster.mjs" "$rel/MANIFEST.sha256" || { echo "STOP MANIFEST does not pin deploy/server-cluster.mjs = $sup"; return 1; }
  echo "PASS release.json revision = $rev; supervisor = Git blob ($sup) and pinned in MANIFEST.sha256"
}
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CAND=17822b29e6de2b6248cd7ada4221800fd81e0003; CUR=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
SUP_NEW=4e8ea9b5be9cda02a6d1e7251a68ab95887be9a2bf055e67ed03703d1ff81a17
LOG=${1:?LOG}; [[ $LOG =~ ^/home/arm/r1-build-[0-9]{8}T[0-9]{6}Z\.log$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
for i in $(seq 1 108); do grep -q '^BUILD_EXIT=' "$LOG" && break; sleep 5; done
tail -n 5 "$LOG"
if ! grep -q '^BUILD_EXIT=' "$LOG"; then echo "P3b RESULT STILL RUNNING"; exit 0; fi
echo "== R1 P3b $(date -u +%FT%TZ)"
NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1); echo "NEW_ID $NEW_ID"
grep -q '^BUILD_EXIT=0$' "$LOG"; echo "PASS BUILD_EXIT=0"
[[ $NEW_ID =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]] || { echo "STOP release id does not start 17822b29e6de-: the tooling did not pin the candidate; do NOT promote"; exit 1; }
release_pins "$ROOT/releases/$NEW_ID" "$CAND" "$SUP_NEW"
tail -n 1 "$ROOT/events.log"
"$N" deploy/release.mjs verify "$NEW_ID"
echo "BUILD_ID $(cat "$ROOT/releases/$NEW_ID/.next/standalone/.next/BUILD_ID")"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ]; [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]; echo "PASS links untouched"
grep -E '^release: (admission|smoke|build:|npm ci:)' "$LOG" || true
[ -z "$(git status --porcelain)" ]; [ "$(git rev-parse HEAD)" = "$CAND" ]; echo "PASS checkout CAND, porcelain empty"
echo "P3b RESULT BUILD PASS $NEW_ID"
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
