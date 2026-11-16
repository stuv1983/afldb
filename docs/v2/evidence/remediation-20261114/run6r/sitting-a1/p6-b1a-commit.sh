#!/usr/bin/env bash
# Packet 6R sitting, block P6 = packet 6R §5.3 step 2): ONE B1a commit run, then the read-only acceptance AFTER, its diff against the
# BEFORE capture, and removal of the untracked artifacts from the checkout (porcelain must be empty before S3). PRODUCTION, as arm.
# Only after P5 printed DRY-RUN PASS and P4 printed VERDICT PASS. Never re-run this block: whatever the outcome, packet 6R §4.2 decides.
# Run: tr -d '\r' < p6-b1a-commit.sh | ssh afldb bash -s -- <STAMP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=/home/arm/b1a-r6r-$STAMP; D=/home/arm/backups/afldb-b1a-$STAMP
REL=docs/v2/evidence/remediation-20261114/run6r/b1a; M=$REL/b1a-repair-2026-r6r.mts
echo "== P6 commit $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$CP" ]
[ "$(sha256sum "$M" | cut -d' ' -f1)" = bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c ]
# AMENDMENT A1: P3's and P5's persisted verdicts are required, not only the runner's own dry-run line.
grep -qx 'BEFORE-CHECK PASS' "$D/before-check.txt"; grep -qx 'P5 RESULT DRY-RUN PASS' "$A/p5-result.txt"
grep -qx 'OUTCOME DRY-RUN-PASS (rolled back)' "$A/dryrun.txt"; [ ! -e "$A/commit.txt" ]; echo "PASS preconditions (BEFORE-CHECK, P5 verdict and dry run passed; no earlier commit run)"
set +e; trap - ERR
( set -a && . ./.env && set +a
  node --import tsx "$M" --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
    --expect-sysid 7674454702926115004 --expect-ids-md5 e5ead8dbf3baf9a7b647b0f55b04c496 --commit ) > "$A/commit.txt" 2>&1
rc=$?; echo "exit=$rc" >> "$A/commit.txt"; chmod 600 "$A/commit.txt"
echo "COMMIT-RUN-END $(date -u +%FT%TZ)"; cat "$A/commit.txt"
echo "== P6 acceptance AFTER (read-only) $(date -u +%FT%TZ)"
( set -a && . ./.env && set +a
  pgconn() { local d="${!1}" re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; [[ $d =~ $re ]] || { echo "bad DSN shape in $1" >&2; return 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD; DSN="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"; }
  pgconn AFLDB_BACKUP_DATABASE_URL &&
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -v db=afldb_prod -v oid=66668 \
    -v sysid=7674454702926115004 -d "$DSN" -f "$A/b1a-accept-r6r.sql" ) > "$D/accept-after-prod.txt"
arc=$?; chmod 600 "$D/accept-after-prod.txt"; echo "accept exit=$arc"; cat "$D/accept-after-prod.txt"
echo "--- diff BEFORE AFTER"; diff "$D/accept-before-prod.txt" "$D/accept-after-prod.txt" > "$D/accept-diff.txt"; chmod 600 "$D/accept-diff.txt"; cat "$D/accept-diff.txt"
# Expected: exactly pss2026 not_applicable|669|0 -> pending|669|0 and na_pss 669|n -> 0|n; every other line identical.
gone=$(diff <(sort "$D/accept-before-prod.txt") <(sort "$D/accept-after-prod.txt") | sed -n 's/^< //p' | sort | tr '\n' ' ')
came=$(diff <(sort "$D/accept-before-prod.txt") <(sort "$D/accept-after-prod.txt") | sed -n 's/^> //p' | sort | tr '\n' ' ')
n=$(sed -n 's/^na_pss|669|//p' "$D/accept-before-prod.txt")
exact=0
[ "$gone" = "na_pss|669|$n pss2026|not_applicable|669|0 " ] && [ "$came" = "na_pss|0|$n pss2026|pending|669|0 " ] && [ "$arc" = 0 ] \
  && { exact=1; echo "ACCEPTANCE-DIFF EXACT"; } || echo "ACCEPTANCE-DIFF NOT EXACT: removed [$gone] added [$came]"
# AMENDMENT A1: one machine-readable verdict; anything but COMMITTED + exit 0 + EXACT ends non-zero and sends the operator to R1 probe.
if [ "$rc" = 0 ] && grep -qx 'OUTCOME COMMITTED' "$A/commit.txt" && [ $exact = 1 ]; then V="P6 RESULT COMMITTED EXACT"; vrc=0
else V="P6 RESULT ATTENTION runner exit=$rc ($(grep '^OUTCOME' "$A/commit.txt" || echo 'no OUTCOME line')), exact=$exact: run r1-state.sh $STAMP probe before S3 (packet 6R §4.2)"; vrc=3; fi
set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
echo "== P6 remove untracked artifacts from the checkout"
rm -f "$REL"/b1a-repair-2026-r6r.mts "$REL"/b1a-accept-r6r.sql; rmdir -p "$REL" 2>/dev/null || true
[ -z "$(git status --porcelain)" ]; echo "PASS porcelain empty"
echo "$V" > "$A/p6-result.txt"; chmod 600 "$A/p6-result.txt"; echo "$V"; exit $vrc
}
main "$@" < /dev/null
