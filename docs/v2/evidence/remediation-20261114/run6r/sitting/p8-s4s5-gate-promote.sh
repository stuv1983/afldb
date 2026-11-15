#!/usr/bin/env bash
# Packet 6R sitting, block P8 = B1-RUNBOOK S4 (host-gate, never --strict, never --skip-host-gate) then S5 (promote --attended).
# PRODUCTION, as arm. Only with the owner present and ready to restart, and after the owner confirmed browser readiness.
# Promote moves current/previous only; it does not restart. After "PROMOTED", the owner runs: sudo systemctl restart afldb
# Run: tr -d '\r' < p8-s4s5-gate-promote.sh | ssh afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; OLD_PREV=0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^a2e6ea9995a4-[A-Za-z0-9_-]{1,64}$ ]]
echo "== P8/S4 host-gate $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
"$N" deploy/release.mjs host-gate
echo "== P8/S5 promote $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote "$NEW_ID" --attended
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]; echo "PASS links current=$NEW_ID previous=$OLD_ID"
tail -n 1 "$ROOT/events.log"
echo "P8 RESULT PROMOTED $(date -u +%FT%TZ): OWNER NOW: sudo systemctl restart afldb"
}
main "$@" < /dev/null
