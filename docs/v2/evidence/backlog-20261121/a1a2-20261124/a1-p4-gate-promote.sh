#!/usr/bin/env bash
# Sitting A1, block P4: host-gate (never --strict, never --skip-host-gate) then promote --attended. PRODUCTION, as arm.
# Only with the owner present and ready for the env change and the restart. Promote moves current/previous only; it does not
# restart. After "PROMOTED" the owner runs blocks E1-E3 (env) and then RESTART (each its own block; ATTENDED-PLAN §A1.5).
# On a gate refusal: wait and re-run; never --skip-host-gate.
# Run: tr -d '\r' < a1-p4-gate-promote.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CUR=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; PREV=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]]
echo "== A1 P4 host-gate $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ]; [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]
"$N" deploy/release.mjs host-gate
echo "== A1 P4 promote $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote "$NEW_ID" --attended
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$CUR" ]; echo "PASS links current=$NEW_ID previous=$CUR"
tail -n 1 "$ROOT/events.log"
systemctl show afldb -p InvocationID -p ActiveEnterTimestamp -p MainPID
echo "P4 RESULT PROMOTED $(date -u +%FT%TZ): OWNER NOW: env blocks E1-E3, then RESTART"
}
main "$@" < /dev/null
