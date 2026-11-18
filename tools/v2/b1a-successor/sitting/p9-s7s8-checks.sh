#!/usr/bin/env bash
# AFLDB-ISSUE-366 / AFLDB-ISSUE-351 successor block P9 = S7 (status --expect) and S8 (post-install-check.sh). PRODUCTION, as arm,
# read-only checks after the owner's restart.
# Pass the second argument ONLY when the owner has attested that the restart with that systemd InvocationID was theirs (for
# example because S7 failed on the apt-coincidence signature). It is passed to S7 AND to S8's own status --expect, and is
# valid for that invocation only: if the service is now any other invocation, both fail. It is never inferred from
# promote --attended or an earlier status PASS. A new restart needs a new attestation and a new P9 run.
# Run: tr -d '\r' < p9-s7s8-checks.sh | ssh afldb bash -s -- <NEW_ID> [<InvocationID>]
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}/node; export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; cd "$CHK"
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$ ]]
INV=${2:-}; C=()
if [ -n "$INV" ]; then [[ $INV =~ ^[A-Za-z0-9_-]{1,64}$ ]]; C=(--confirm-restart-invocation "$INV"); fi
echo "== P9 $(date -u +%FT%TZ)${INV:+ owner-attested restart InvocationID $INV}"
systemctl show afldb -p ActiveState -p SubState -p Result -p NRestarts -p InvocationID -p ActiveEnterTimestamp
echo "== S7"
"$N" deploy/release.mjs status --expect "$NEW_ID" ${C[@]+"${C[@]}"}
echo "== S8"
bash deploy/post-install-check.sh ${C[@]+"${C[@]}"} "$NEW_ID"
echo "P9 RESULT S7+S8 PASS${INV:+ (restart $INV owner-attested)} (read any UNVERIFIED journal note: owner lines)"
}
main "$@" < /dev/null
