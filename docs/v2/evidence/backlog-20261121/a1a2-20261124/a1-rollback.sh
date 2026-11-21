#!/usr/bin/env bash
# Sitting A1, application rollback (never touches data). PRODUCTION, as arm. Two modes, the owner's restart between them:
#   links   release.mjs rollback --attended --to c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC --ledger-head 118_fixtures_unconfirmed_participants.sql
#           (switches the current link back; rebuilds nothing). Then OWNER: sudo systemctl restart afldb
#   verify  release.mjs status --expect c8d4202a… --confirm-restart-invocation <InvocationID>, post-install-check against the
#           new BUILD_ID (the rolled-back-from build must answer 404), /brownlow/2026 still 200 with the published winner.
# The .env lines are harmless under c8d4202a (RC-371-372.md section 4); removing them is optional and needs its own restart.
# The checkout stays at 7d92042f (harmless: the release tree is what is served).
# Run: tr -d '\r' < a1-rollback.sh | ssh.exe -o BatchMode=yes afldb bash -s -- links
#      tr -d '\r' < a1-rollback.sh | ssh.exe -o BatchMode=yes afldb bash -s -- verify <InvocationID> <NEW BUILD_ID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
OLD=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; LEDGER=118_fixtures_unconfirmed_participants.sql
MODE=${1:?mode}
case $MODE in
  links)
    echo "== A1 rollback links $(date -u +%FT%TZ)"
    "$N" deploy/release.mjs rollback --attended --to "$OLD" --ledger-head "$LEDGER"
    [ "$(readlink "$ROOT/current")" = "releases/$OLD" ]; echo "PASS current -> $OLD"
    tail -n 1 "$ROOT/events.log"
    echo "ROLLBACK RESULT LINKS SWITCHED: OWNER NOW: sudo systemctl restart afldb";;
  verify)
    INV=${2:?InvocationID}; [[ $INV =~ ^[0-9a-f]{32}$ ]]; NEWB=${3:?new BUILD_ID}; [[ $NEWB =~ ^[A-Za-z0-9_-]{1,64}$ ]]
    echo "== A1 rollback verify $(date -u +%FT%TZ)"
    "$N" deploy/release.mjs status --expect "$OLD" --confirm-restart-invocation "$INV"
    bash deploy/post-install-check.sh --confirm-restart-invocation "$INV" "$OLD" "$NEWB"
    echo "ROLLBACK RESULT VERIFIED (then run a1-rawhead.sh check: /brownlow/2026 must still be 200 with the published winner)";;
  *) echo "usage: links | verify <InvocationID> <NEW BUILD_ID>"; exit 2;;
esac
}
main "$@" < /dev/null
