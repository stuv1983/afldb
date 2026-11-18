#!/usr/bin/env bash
# AFLDB-ISSUE-366 successor block R1: read-only state determination. PRODUCTION, as arm. Writes nothing except, with "probe", the
# recovery transcript $A/recover-<UTC>.txt (creating $A, mode 700, if absent). Prints the release state and the persisted step records; with "probe" it runs
# recover.mts for attempt <STAMP>-commit-1 and EXITS WITH ITS VERDICT (packet 6R R1 printed the probe status but exited 0):
#   0  R1 DECISION COMMITTED       treat B1a as committed; S3 may proceed
#   10 R1 DECISION NOT-COMMITTED   B1a abandoned for this sitting; S3 may proceed
#   any other exit                 STOP the sitting before S3 (uncertain lifecycle, live attempt, failed probe, wrong identity,
#                                  contradictory records, ALREADY-APPLIED, mixed state). Never re-run P6.
# A STOP for a still-live attempt may be followed by R1 again once it has ended; nothing else changes the decision.
# Run: tr -d '\r' < r1-state.sh | ssh afldb bash -s -- <STAMP> [probe]
main() {
set -uo pipefail; export LC_ALL=C
N=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}/node; export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; H=${B1A_HOME:-/home/arm}; ROOT=${B1A_ROOT:-/home/arm/afldb-releases}; cd "$CHK" || exit 1
DB=${B1A_DB:-afldb_prod}; OID=${B1A_OID:-66668}; SYSID=${B1A_SYSID:-7674454702926115004}; IDS=${B1A_IDS:-e5ead8dbf3baf9a7b647b0f55b04c496}
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2; A=$H/b1a-r6r-$STAMP; D=$H/backups/afldb-b1a-$STAMP
echo "== R1 $(date -u +%FT%TZ)"
echo "HEAD $(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
echo "current -> $(readlink "$ROOT/current")"; echo "previous -> $(readlink "$ROOT/previous")"
tail -n 4 "$ROOT/events.log"
"$N" deploy/release.mjs status
systemctl show afldb -p ActiveState -p SubState -p Result -p NRestarts -p InvocationID -p ActiveEnterTimestamp
for f in "$A/p5-result.txt" "$A/dryrun.txt" "$A/p6-attempt.txt" "$A/commit.txt" "$A/p6-result.txt" "$D/baseline-check.txt"; do
  if [ -f "$f" ]; then echo "--- $f"; grep -E '^(OUTCOME|LAUNCH|exit=|ATTEMPT-START|RUNNER-|P5 RESULT|P6 RESULT|BEFORE-CHECK|BASELINE-)' "$f"; else echo "--- $f absent"; fi; done
pgrep -af 'b1a-successor/repair|release.mjs' || echo "no runner/release process"
[ "${2:-}" = probe ] || { echo "R1 RESULT state printed (no probe)"; exit 0; }
# The transcript needs $A even when no step record exists yet (recover.mts decides missing records itself); without this the
# redirect fails before recover.mts runs and the real verdict is lost.
mkdir -p -m 700 "$A" || { echo "R1 RESULT STOP: cannot create $A"; exit 3; }
O="$A/recover-$(date -u +%Y%m%dT%H%M%SZ).txt"
BSHA=$(sed -n 's/^BASELINE-SHA256 //p' "$D/baseline-check.txt" 2>/dev/null)
( set -a; . ./.env; set +a
  "$N" --import tsx tools/v2/b1a-successor/recover.mts --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" \
    --expect-sysid "$SYSID" --expect-ids-md5 "$IDS" --recover-attempt "$STAMP-commit-1" --record-dir "$A" \
    --baseline "$D/baseline-v2.txt" --baseline-sha256 "${BSHA:-missing}" ) > "$O" 2>&1 < /dev/null
rc=$?; chmod 600 "$O" 2>/dev/null; cat "$O"
grep -E '^R1 DECISION (COMMITTED|NOT-COMMITTED|STOP)' "$O" > /dev/null || { echo "R1 RESULT STOP: recovery printed no decision (exit $rc)"; exit 3; }
case $rc in
  0) echo "R1 RESULT COMMITTED: continue to S3 as committed";;
  10) echo "R1 RESULT NOT-COMMITTED: B1a abandoned for this sitting; S3 may proceed";;
  *) echo "R1 RESULT STOP (exit $rc): no S3; report to the owner";;
esac
exit $rc
}
main "$@" < /dev/null
