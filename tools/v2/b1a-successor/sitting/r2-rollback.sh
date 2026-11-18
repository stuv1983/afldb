#!/usr/bin/env bash
# AFLDB-ISSUE-366 successor block R2 = application rollback (B1-RUNBOOK §3; packet 6R §4.3), only on a §4.3 trigger after S5.
# PRODUCTION, as arm. "links <OLD_ID>": release.mjs rollback --attended --checkout (moves current back; no restart, no DB write);
# then the OWNER runs: sudo systemctl restart afldb. "verify <OLD_ID> [<InvocationID>]" (after that restart): status --expect and
# post-install-check on OLD_ID; the InvocationID, given only when the owner attested THAT restart, reaches both (same rule as P9).
# Never a database reversal or restore: each is a separate owner decision.
# Run: tr -d '\r' < r2-rollback.sh | ssh afldb bash -s -- <links|verify> <OLD_ID> [<InvocationID>]
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}/node; export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; ROOT=${B1A_ROOT:-/home/arm/afldb-releases}; cd "$CHK"
MODE=${1:?mode}; [[ $MODE =~ ^(links|verify)$ ]]; OLD_ID=${2:?OLD_ID}; [[ $OLD_ID =~ ^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$ ]]
INV=${3:-}; C=()
if [ -n "$INV" ]; then [ "$MODE" = verify ]; [[ $INV =~ ^[A-Za-z0-9_-]{1,64}$ ]]; C=(--confirm-restart-invocation "$INV"); fi
echo "== R2 $MODE $(date -u +%FT%TZ)"
if [ "$MODE" = links ]; then
  echo "current -> $(readlink "$ROOT/current"); previous -> $(readlink "$ROOT/previous")"
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  "$N" deploy/release.mjs rollback --attended --checkout "$CHK"
  [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; tail -n 2 "$ROOT/events.log"
  echo "R2 RESULT LINKS ROLLED BACK: OWNER NOW: sudo systemctl restart afldb"
else
  "$N" deploy/release.mjs status --expect "$OLD_ID" ${C[@]+"${C[@]}"}
  bash deploy/post-install-check.sh ${C[@]+"${C[@]}"} "$OLD_ID"
  echo "R2 RESULT ROLLBACK VERIFIED"
fi
}
main "$@" < /dev/null
