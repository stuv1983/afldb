#!/usr/bin/env bash
# AFLDB-ISSUE-366 successor block P3c: the sitting-specific v2 BEFORE capture that P5 and P6 bind to. PRODUCTION, as arm, read-only
# (one REPEATABLE READ READ ONLY transaction as the backup role). Runs after the P3 dump, in the same backup directory $D.
# Writes $D/baseline-v2.txt (600, never overwritten) and $D/baseline-check.txt: "BEFORE-CHECK PASS|FAIL ..." and "BASELINE-SHA256 <hex>".
# Run: tr -d '\r' < p3c-baseline.sh | ssh afldb bash -s -- <STAMP>
# Environment overrides (B1A_*) exist only so the block can be rehearsed off-host.
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=${B1A_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}:$PATH
CHK=${B1A_CHECKOUT:-/home/arm/projects/afldb}; H=${B1A_HOME:-/home/arm}; cd "$CHK"
DB=${B1A_DB:-afldb_prod}; OID=${B1A_OID:-66668}; SYSID=${B1A_SYSID:-7674454702926115004}; IDS=${B1A_IDS:-e5ead8dbf3baf9a7b647b0f55b04c496}
T=tools/v2/b1a-successor
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; D=$H/backups/afldb-b1a-$STAMP
echo "== P3c baseline $(date -u +%FT%TZ)"
[ -d "$D" ]; [ ! -e "$D/baseline-v2.txt" ]; [ ! -e "$D/baseline-check.txt" ]
set +e; trap - ERR
( set -a; . ./.env; set +a
  node --import tsx "$T/capture.mts" --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-db "$DB" --expect-oid "$OID" --expect-sysid "$SYSID" \
    --sitting "$STAMP" --out "$D/baseline-v2.txt" --verify-before --expect-ids-md5 "$IDS" ) > "$D/baseline-run.txt" 2>&1
rc=$?; set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
chmod 600 "$D/baseline-run.txt"; cat "$D/baseline-run.txt"
if [ $rc = 0 ] && grep -qx 'BEFORE-CHECK PASS' "$D/baseline-run.txt"; then
  S=$(sed -n 's/^BASELINE-SHA256 //p' "$D/baseline-run.txt")
  [ "$(sha256sum "$D/baseline-v2.txt" | cut -d' ' -f1)" = "$S" ]
  printf 'BEFORE-CHECK PASS\nBASELINE-SHA256 %s\n' "$S" > "$D/baseline-check.txt"
else
  echo "BEFORE-CHECK FAIL: capture exit=$rc; do not run B1a (packet 6R §4.2)" > "$D/baseline-check.txt"
fi
chmod 600 "$D/baseline-check.txt"; cat "$D/baseline-check.txt"
grep -qx 'BEFORE-CHECK PASS' "$D/baseline-check.txt" && echo "P3c RESULT BASELINE PASS" || { echo "P3c RESULT BASELINE FAIL"; exit 1; }
}
main "$@" < /dev/null
