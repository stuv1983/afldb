#!/usr/bin/env bash
# Release 17822b29, block P4: host-gate (never --strict, never --skip-host-gate) then promote --attended. PRODUCTION, as arm.
# Only with the owner present and ready to restart, and not after the PROMOTION CUTOFF printed in the runbook (11:30 AEDT on
# Tue 24 Nov). Promote moves current/previous by rename(2) only; it does not restart. The running service keeps the release it
# started in (systemd resolved WorkingDirectory=/home/arm/afldb-releases/current once, at start; P1), so nothing served changes until
# the owner's RESTART, which then starts `node deploy/server-cluster.mjs` inside releases/<NEW_ID>, i.e. the 17822b29 supervisor.
# No .env change in this release (revalidation names already 1/1 since Sunday).
# Run: tr -d '\r' < r1-p4-gate-promote.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CUR=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
CUTOFF=$(TZ=Australia/Melbourne date -d '2026-11-24 11:30' +%s)
[ "$(date +%s)" -le "$CUTOFF" ] || { echo "STOP past the promotion cutoff (Tue 24 Nov 11:30 AEDT): do not promote; production unchanged; reschedule"; exit 1; }
echo "== R1 P4 host-gate $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ]; [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]
"$N" deploy/release.mjs host-gate
echo "== R1 P4 promote $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote "$NEW_ID" --attended
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$CUR" ]; echo "PASS links current=$NEW_ID previous=$CUR"
tail -n 1 "$ROOT/events.log"
systemctl show afldb -p InvocationID -p ActiveEnterTimestamp -p MainPID
echo "process cwd (still the old release until the restart): $(readlink /proc/"$(systemctl show afldb -p MainPID --value)"/cwd)"
echo "P4 RESULT PROMOTED $(date -u +%FT%TZ): OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
}
main "$@" < /dev/null
