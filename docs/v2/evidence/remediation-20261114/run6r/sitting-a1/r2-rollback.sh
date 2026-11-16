#!/usr/bin/env bash
# Packet 6R sitting, block R2 = application rollback (B1-RUNBOOK §3; packet 6R §4.3). ONLY on a §4.3 trigger after S5, under Approval B1.
# PRODUCTION, as arm. Mode "links": release.mjs rollback --attended --checkout (moves current back to c1c4b22e; no restart, no DB write);
# then the OWNER runs: sudo systemctl restart afldb. Mode "verify" (after that restart): status --expect + post-install-check on c1c4b22e.
# Never a database reversal or restore. The serving checkout stays at C'.
# Run: tr -d '\r' < r2-rollback.sh | ssh afldb bash -s -- <links|verify>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x
MODE=${1:?mode}; [[ $MODE =~ ^(links|verify)$ ]]
echo "== R2 $MODE $(date -u +%FT%TZ)"
if [ "$MODE" = links ]; then
  echo "current -> $(readlink "$ROOT/current"); previous -> $(readlink "$ROOT/previous")"
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  "$N" deploy/release.mjs rollback --attended --checkout "$CHK"
  [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; tail -n 2 "$ROOT/events.log"
  echo "R2 RESULT LINKS ROLLED BACK: OWNER NOW: sudo systemctl restart afldb"
else
  "$N" deploy/release.mjs status --expect "$OLD_ID"
  bash deploy/post-install-check.sh "$OLD_ID"
  echo "R2 RESULT ROLLBACK VERIFIED"
fi
}
main "$@" < /dev/null
