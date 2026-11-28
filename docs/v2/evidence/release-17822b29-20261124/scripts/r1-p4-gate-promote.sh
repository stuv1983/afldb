#!/usr/bin/env bash
# Release 17822b29, block P4: host-gate (never --strict, never --skip-host-gate) then promote --attended. PRODUCTION, as arm.
# Only with the owner present and ready to restart, and not after the PROMOTION CUTOFF printed in the runbook (11:30 AEDT on
# Tue 24 Nov). Promote moves current/previous by rename(2) only; it does not restart. The running service keeps the release it
# started in (systemd resolved WorkingDirectory=/home/arm/afldb-releases/current once, at start; P1), so nothing served changes until
# the owner's RESTART, which then starts `node deploy/server-cluster.mjs` inside releases/<NEW_ID>, i.e. the 17822b29 supervisor.
# No .env change in this release (revalidation names already 1/1 since Sunday).
# The cutoff rule, everywhere: promotion is permitted up to and including 11:30:00.000 and refused from 1 ms after it. It is
# enforced three times, the last one by the tool that moves the links:
#   1. here, first (cheap refusal): now in milliseconds must be <= CUTOFF * 1000;
#   2. `release.mjs host-gate --not-after CUTOFF` (read-only) must exit 0 AND print exactly one line
#      "release: PROMOTION DEADLINE ENFORCED not-after=<CUTOFF> not-reached". A release.mjs that predates the option stores it
#      and prints no such line (it would also ignore it on promote), so P4 STOPs before promote: fail closed on an old tool;
#   3. `release.mjs promote <NEW_ID> --attended --not-after CUTOFF` re-reads the clock inside the links lock, after the release
#      hashing, the live-service check and its own host gate, immediately before the two renames. Past the cutoff there it
#      refuses: no link moves and events.log is not written. P4 then confirms both links are unchanged and STOPs.
# Writes: the two links and one events.log line, by promote only. Everything before promote is read-only.
# Run: tr -d '\r' < r1-p4-gate-promote.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CUR=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
CUTOFF=$(TZ=Australia/Melbourne date -d '2026-11-24 11:30' +%s); [[ $CUTOFF =~ ^[0-9]{10}$ ]]
NOW_MS=$(date +%s%3N); [[ $NOW_MS =~ ^[0-9]{13}$ ]]
[ "$NOW_MS" -le "${CUTOFF}000" ] || { echo "STOP past the promotion cutoff (Tue 24 Nov 11:30 AEDT): do not promote; production unchanged; reschedule"; exit 1; }
echo "== R1 P4 host-gate $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ]; [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]
ENF="release: PROMOTION DEADLINE ENFORCED not-after=$CUTOFF not-reached"
HG=$("$N" deploy/release.mjs host-gate --not-after "$CUTOFF" 2>&1) \
  || { printf '%s\n' "$HG"; echo "STOP host gate refused (host state, or the promotion cutoff has passed): do not promote; production unchanged"; exit 1; }
printf '%s\n' "$HG"
[ "$(grep -Fxc -- "$ENF" <<< "$HG")" = 1 ] \
  || { echo "STOP this release.mjs does not enforce the promotion deadline (host-gate did not print '$ENF'): do not promote; production unchanged"; exit 1; }
echo "== R1 P4 promote $(date -u +%FT%TZ)"
"$N" deploy/release.mjs promote "$NEW_ID" --attended --not-after "$CUTOFF" || { rc=$?
  if [ "$(readlink "$ROOT/current")" = "releases/$CUR" ] && [ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]; then
    echo "STOP promote refused (exit $rc): links unchanged (current=$CUR previous=$PREV); production unchanged; do not restart"
  else echo "STOP promote failed (exit $rc) and the links are current=$(readlink "$ROOT/current") previous=$(readlink "$ROOT/previous"): do not restart; inspect"; fi
  exit 1; }
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$CUR" ]; echo "PASS links current=$NEW_ID previous=$CUR"
tail -n 1 "$ROOT/events.log"
systemctl show afldb -p InvocationID -p ActiveEnterTimestamp -p MainPID
echo "process cwd (still the old release until the restart): $(readlink /proc/"$(systemctl show afldb -p MainPID --value)"/cwd)"
echo "P4 RESULT PROMOTED $(date -u +%FT%TZ): OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
}
main "$@" < /dev/null
