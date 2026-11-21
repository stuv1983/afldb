#!/usr/bin/env bash
# Release 7 revision 2 (R7R2), block P4 = S4 (host-gate; never --strict, never --skip-host-gate) then S5 (promote --attended). PRODUCTION, as arm.
# Only with the owner present and ready to restart, and after the owner confirmed browser readiness.
# Promote moves current/previous only; it does not restart. After "PROMOTED", the owner runs: sudo systemctl restart afldb
# Run: tr -d '\r' < r7-p4-gate-promote.sh | ssh afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
OLD_ID=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5; OLD_PREV=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^a3c8c67cc98f-[A-Za-z0-9_-]{1,64}$ ]]
echo "== R7 P4/S4 host-gate $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
"$N" deploy/release.mjs host-gate
echo "== R7 P4/S5 promote $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote "$NEW_ID" --attended
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]; echo "PASS links current=$NEW_ID previous=$OLD_ID"
tail -n 1 "$ROOT/events.log"
systemctl show afldb -p InvocationID -p ActiveEnterTimestamp
echo "P4 RESULT PROMOTED $(date -u +%FT%TZ): OWNER NOW: sudo systemctl restart afldb"
}
main "$@" < /dev/null
