#!/usr/bin/env bash
# Packet 6R sitting, block P5 = packet 6R §5.3 step 1): the B1a DRY RUN on afldb_prod (always rolls back). PRODUCTION, as arm.
# Only after P4 printed VERDICT PASS. Compares the runner's BEFORE fingerprints with H1/H2/H3 of the BEFORE capture.
# Run: tr -d '\r' < p5-b1a-dryrun.sh | ssh afldb bash -s -- <STAMP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=/home/arm/b1a-r6r-$STAMP; D=/home/arm/backups/afldb-b1a-$STAMP
M=docs/v2/evidence/remediation-20261114/run6r/b1a/b1a-repair-2026-r6r.mts
echo "== P5 dry run $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$CP" ]
[ "$(sha256sum "$M" | cut -d' ' -f1)" = bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c ]; echo "PASS runner at pinned sha256"
[ ! -e "$A/dryrun.txt" ]
set +e; trap - ERR
( set -a && . ./.env && set +a
  node --import tsx "$M" --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
    --expect-sysid 7674454702926115004 --expect-ids-md5 e5ead8dbf3baf9a7b647b0f55b04c496 ) > "$A/dryrun.txt" 2>&1
rc=$?; set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR; echo "exit=$rc" >> "$A/dryrun.txt"; chmod 600 "$A/dryrun.txt"
cat "$A/dryrun.txt"
X="$D/accept-before-prod.txt"
H1=$(sed -n 's/^fp_pss_other(H1)|//p' "$X"); H2=$(sed -n 's/^fp_pss2026_nonstatus(H2)|//p' "$X"); H3=$(sed -n 's/^fp_stat_availability(H3)|[0-9]*|//p' "$X")
B=$(grep '^BEFORE ' "$A/dryrun.txt" || true); AF=$(grep '^AFTER(in tx) ' "$A/dryrun.txt" || true); ok=1
for line in "$B" "$AF"; do
  for kv in "fp2026NonStatus\":\"$H2" "fpOtherSeasons\":\"$H1" "fpStatAvailability\":\"$H3"; do
    [[ -n $line && $line == *"$kv"* ]] && echo "  ok   ${line%% *} $kv" || { echo "  DIFF ${line%% *} $kv"; ok=0; }; done; done
[[ $B == *'"pss2026":"669 rows, not_applicable 669, pending 0, votes 0"'* ]] && echo "  ok   BEFORE pss2026" || { echo "  DIFF BEFORE pss2026"; ok=0; }
[[ $AF == *'"pss2026":"669 rows, not_applicable 0, pending 669, votes 0"'* ]] && echo "  ok   AFTER pss2026" || { echo "  DIFF AFTER pss2026"; ok=0; }
grep -q '^LOCKED .*"rows2026":669' "$A/dryrun.txt" && echo "  ok   LOCKED 669" || { echo "  DIFF LOCKED"; ok=0; }
grep -qx 'OUTCOME DRY-RUN-PASS (rolled back)' "$A/dryrun.txt" && [ "$rc" = 0 ] && echo "  ok   OUTCOME DRY-RUN-PASS, exit 0" || { echo "  DIFF outcome/exit"; ok=0; }
[ $ok = 1 ] && echo "P5 RESULT DRY-RUN PASS" || echo "P5 RESULT NOT PASS: no commit; packet 6R §4.2"
}
main "$@" < /dev/null
