#!/usr/bin/env bash
# Packet 6R sitting, block P9 = B1-RUNBOOK S7 (status --expect) and S8 (post-install-check.sh). PRODUCTION, as arm, read-only checks.
# After the owner's restart. Pass a third argument "confirm" ONLY if S7's sole FAIL was the apt-coincidence and the owner confirmed the
# restart was theirs.
# Run: tr -d '\r' < p9-s7s8-checks.sh | ssh afldb bash -s -- <NEW_ID> [confirm]
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^a2e6ea9995a4-[A-Za-z0-9_-]{1,64}$ ]]; C=${2:-}
echo "== P9 $(date -u +%FT%TZ)"
systemctl show afldb -p ActiveState -p SubState -p Result -p NRestarts -p InvocationID -p ActiveEnterTimestamp
echo "== S7"
if [ "$C" = confirm ]; then "$N" deploy/release.mjs status --expect "$NEW_ID" --confirm-attended-restart
else "$N" deploy/release.mjs status --expect "$NEW_ID"; fi
echo "== S8"
bash deploy/post-install-check.sh "$NEW_ID"
echo "P9 RESULT S7+S8 PASS (read any UNVERIFIED journal note: owner lines)"
}
main "$@" < /dev/null
