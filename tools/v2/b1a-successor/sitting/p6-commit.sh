#!/usr/bin/env bash
# AFLDB-ISSUE-366 successor block P6: ONE B1a commit attempt (<STAMP>-commit-1), then the independent read-only acceptance AFTER.
# PRODUCTION, as arm. Never re-run: whatever the outcome, r1-state.sh <STAMP> probe decides (packet 6R §4.2, one-attempt limit).
#
# Lifecycle record for recovery, $A/p6-attempt.txt: ATTEMPT-START (attempt, this block's pid and start time) before the launch,
# RUNNER-PID after it, RUNNER-EXIT after the runner ended. The runner ignores SIGHUP (nohup), so a lost caller does not cut its
# transaction in half; recover.mts waits for it to be terminal instead of reading an early snapshot.
# Requires: P3c BEFORE-CHECK PASS + BASELINE-SHA256, P5 DRY-RUN PASS bound to the same sha256, no earlier attempt record.
# Run: tr -d '\r' < p6-commit.sh | ssh afldb bash -s -- <STAMP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; H=${B1A_HOME:-/home/arm}; cd "$CHK"
DB=${B1A_DB:-afldb_prod}; OID=${B1A_OID:-66668}; SYSID=${B1A_SYSID:-7674454702926115004}; IDS=${B1A_IDS:-e5ead8dbf3baf9a7b647b0f55b04c496}
T=tools/v2/b1a-successor
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=$H/b1a-r6r-$STAMP; D=$H/backups/afldb-b1a-$STAMP; ATT=$STAMP-commit-1
echo "== P6 commit $ATT $(date -u +%FT%TZ)"
grep -qx 'BEFORE-CHECK PASS' "$D/baseline-check.txt"
BSHA=$(sed -n 's/^BASELINE-SHA256 //p' "$D/baseline-check.txt"); [[ $BSHA =~ ^[0-9a-f]{64}$ ]]
[ "$(sha256sum "$D/baseline-v2.txt" | cut -d' ' -f1)" = "$BSHA" ]
grep -qx 'P5 RESULT DRY-RUN PASS' "$A/p5-result.txt"; grep -qx "BASELINE-SHA256 $BSHA" "$A/p5-result.txt"
grep -qx 'OUTCOME DRY-RUN-PASS (rolled back)' "$A/dryrun.txt"
[ ! -e "$A/commit.txt" ]; [ ! -e "$A/p6-attempt.txt" ]
echo "PASS preconditions (baseline $BSHA verified, bound by P5; no earlier attempt)"
echo "ATTEMPT-START $ATT wrapper_pid=$$ wrapper_start=$(sed 's/.*) //' /proc/$$/stat | cut -d' ' -f20) $(date -u +%FT%TZ)" > "$A/p6-attempt.txt"
chmod 600 "$A/p6-attempt.txt"
set +e; trap - ERR
( set -a; . ./.env; set +a
  exec nohup node --import tsx "$T/repair.mts" --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" \
    --expect-sysid "$SYSID" --expect-ids-md5 "$IDS" --attempt "$ATT" --baseline "$D/baseline-v2.txt" --baseline-sha256 "$BSHA" --commit
) > "$A/commit.txt" 2>&1 < /dev/null &
RP=$!; echo "RUNNER-PID $RP" >> "$A/p6-attempt.txt"
wait "$RP"; rc=$?
echo "RUNNER-EXIT $rc" >> "$A/p6-attempt.txt"; echo "exit=$rc" >> "$A/commit.txt"; chmod 600 "$A/commit.txt"
echo "COMMIT-RUN-END $(date -u +%FT%TZ)"; cat "$A/commit.txt"
echo "== P6 acceptance AFTER (read-only, independent session) $(date -u +%FT%TZ)"
( set -a; . ./.env; set +a
  node --import tsx "$T/capture.mts" --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYSID" \
    --sitting "$STAMP" --compare "$D/baseline-v2.txt" --baseline-sha256 "$BSHA" --expect repaired --out "$D/accept-after-v2.txt" ) > "$A/accept-after.txt" 2>&1 < /dev/null
arc=$?; chmod 600 "$A/accept-after.txt"; cat "$A/accept-after.txt"
if [ "$rc" = 0 ] && grep -qx 'OUTCOME COMMITTED' "$A/commit.txt" && grep -q '^BASELINE-CHECK PASS ' "$A/commit.txt" \
   && [ "$arc" = 0 ] && grep -qx 'ACCEPTANCE repaired EXACT' "$A/accept-after.txt"; then V="P6 RESULT COMMITTED EXACT"; vrc=0
else V="P6 RESULT ATTENTION runner exit=$rc ($(grep '^OUTCOME' "$A/commit.txt" || echo 'no OUTCOME line')), acceptance exit=$arc: run r1-state.sh $STAMP probe before S3 (packet 6R §4.2)"; vrc=3; fi
set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
[ -z "$(git status --porcelain)" ]; echo "PASS porcelain empty"
echo "$V" > "$A/p6-result.txt"; chmod 600 "$A/p6-result.txt"; echo "$V"; exit $vrc
}
main "$@" < /dev/null
