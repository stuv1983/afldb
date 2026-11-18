#!/usr/bin/env bash
# AFLDB-ISSUE-366 successor block P5: the B1a DRY RUN (always rolls back), bound to the verified P3c baseline. PRODUCTION, as arm.
# Requires P3c's BEFORE-CHECK PASS and BASELINE-SHA256, and the operator's literal VERDICT-PASS from P4 bound to the dump sha256.
# The runner itself compares every baseline line under its locks before the UPDATE (BASELINE-CHECK PASS). Persists $A/p5-result.txt.
# Run: tr -d '\r' < p5-dryrun.sh | ssh afldb bash -s -- <STAMP> VERDICT-PASS <dump sha256 that P4 verified>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; H=${B1A_HOME:-/home/arm}; cd "$CHK"
DB=${B1A_DB:-afldb_prod}; OID=${B1A_OID:-66668}; SYSID=${B1A_SYSID:-7674454702926115004}; IDS=${B1A_IDS:-e5ead8dbf3baf9a7b647b0f55b04c496}
T=tools/v2/b1a-successor
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=$H/b1a-r6r-$STAMP; D=$H/backups/afldb-b1a-$STAMP
echo "== P5 dry run $(date -u +%FT%TZ)"
[ "${2:-}" = VERDICT-PASS ]; VSHA=${3:?dump sha256 verified by P4}; [[ $VSHA =~ ^[0-9a-f]{64}$ ]]
[ "$(ls -1 "$D"/afldb_prod-*.dump.sha256 | wc -l)" = 1 ]; [ "$(cut -d' ' -f1 "$D"/afldb_prod-*.dump.sha256)" = "$VSHA" ]
grep -qx 'BEFORE-CHECK PASS' "$D/baseline-check.txt"
BSHA=$(sed -n 's/^BASELINE-SHA256 //p' "$D/baseline-check.txt"); [[ $BSHA =~ ^[0-9a-f]{64}$ ]]
[ "$(sha256sum "$D/baseline-v2.txt" | cut -d' ' -f1)" = "$BSHA" ]; echo "PASS baseline $BSHA verified"
[ ! -e "$A/dryrun.txt" ]
set +e; trap - ERR
( set -a; . ./.env; set +a
  node --import tsx "$T/repair.mts" --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYSID" \
    --expect-ids-md5 "$IDS" --attempt "$STAMP-dry-1" --baseline "$D/baseline-v2.txt" --baseline-sha256 "$BSHA" ) > "$A/dryrun.txt" 2>&1 < /dev/null
rc=$?; set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
echo "exit=$rc" >> "$A/dryrun.txt"; chmod 600 "$A/dryrun.txt"; cat "$A/dryrun.txt"
ok=1
grep -q '^LOCKED .*"rows2026":669' "$A/dryrun.txt" && echo "  ok   LOCKED 669" || { echo "  DIFF LOCKED"; ok=0; }
grep -q '^BASELINE-CHECK PASS ' "$A/dryrun.txt" && echo "  ok   BASELINE-CHECK PASS (every line = the P3c capture, before the UPDATE)" || { echo "  DIFF baseline check"; ok=0; }
grep -qx 'OUTCOME DRY-RUN-PASS (rolled back)' "$A/dryrun.txt" && [ "$rc" = 0 ] && echo "  ok   OUTCOME DRY-RUN-PASS, exit 0" || { echo "  DIFF outcome/exit"; ok=0; }
if [ $ok = 1 ]; then printf 'P5 RESULT DRY-RUN PASS\nBASELINE-SHA256 %s\n' "$BSHA" > "$A/p5-result.txt"
else echo "P5 RESULT NOT PASS: no commit; packet 6R §4.2" > "$A/p5-result.txt"; fi
chmod 600 "$A/p5-result.txt"; head -n 1 "$A/p5-result.txt"; [ $ok = 1 ]
}
main "$@" < /dev/null
