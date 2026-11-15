#!/usr/bin/env bash
# B1a-0 option A, packet 6R. OPERATIONAL EXECUTABLE ARTIFACT (packet 6R §3). Runs on the DEV host (streamanator) as arm. Touches NO
# production system: it restores a production dump that was already copied to this host into a BRAND-NEW isolated PostgreSQL cluster
# (new root, new port, loopback only, generated credentials) and proves the backup:
#   1. the file's size and sha256 equal the values recorded on production; `pg_restore --list` names afldb_prod;
#   2. pg_restore into afldb_v2_b1a0_verify_test exits 0 with no stderr line (stricter than restore.mjs's own exit rule);
#   3. the nine restore-test.sh parity aggregates on the copy equal the production values read right after the dump (parity-prod.txt);
#   4. the B1a acceptance probe on the copy equals production's BEFORE capture (accept-before-prod.txt) on every line but `identity`:
#      the exact 2026 rows (ids2026), their non-status columns (H2), every other season (H1), all coverage (H3), inputs2026;
#   5. the B1a runner's DRY RUN on the copy (copy identity, the pinned 2026 id-set hash) prints DRY-RUN-PASS.
# Then it stops the cluster. It deletes nothing: the dump copy and the stopped cluster stay (0700) until the owner decides.
#
# Usage: bash b1a0-dev-restore-verify.sh <dump-on-this-host> <sha256> <bytes> <dir with parity-prod.txt and accept-before-prod.txt> <ids-md5>
# Env: PORT (default 61432; must be outside the ephemeral range 32768-60999 and free), CAND (default the run-5 candidate checkout, f6af6da9,
# whose src/ and tools/ equal a2e6ea99's), ART (default the directory holding this script: b1a0-parity.sql, ../b1a/*-r6r.*).
set -u -o pipefail
DUMP=${1:?dump}; SHA=${2:?sha256}; BYTES=${3:?bytes}; PE=${4:?prod evidence dir}; IDS=${5:?ids md5}
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
CAND=${CAND:-/mnt/ssd/afldb-rem5-t2-20261115/cand}
HERE=$(cd "$(dirname "$0")" && pwd); ART=${ART:-$HERE}
PORT=${PORT:-61432}
STAMP=$(basename "$DUMP" .dump | tr -c 'A-Za-z0-9\n' '-' | tr 'A-Z' 'a-z')
ROOT=/mnt/ssd/afldb-b1a0-verify-$STAMP-pg
DB=afldb_v2_b1a0_verify_test
REL=docs/v2/evidence/remediation-20261114/run6r/b1a
export AFLDB_V2_PG_ROOT=$ROOT AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
FAIL=0; fail() { echo "FAIL $*"; FAIL=1; }
stopnow() { echo "STOP $*"; echo "VERDICT FAIL (stopped before completion)"; exit 1; }

echo "=== B1a-0 option A $(date -u +%FT%TZ) host=$(hostname) dump=$DUMP"
[ "$PORT" -ge 61000 ] && [ "$PORT" -le 65535 ] || stopnow "PORT $PORT is inside the ephemeral range or invalid"
ss -ltn | grep -q ":$PORT " && stopnow "port $PORT already listening"
[ -e "$ROOT" ] && stopnow "$ROOT exists: a fresh cluster is required"
for f in "$PE/parity-prod.txt" "$PE/accept-before-prod.txt" "$ART/b1a0-parity.sql" "$ART/../b1a/b1a-accept-r6r.sql" "$ART/../b1a/b1a-repair-2026-r6r.mts"; do
  [ -s "$f" ] || stopnow "missing $f"; done
(cd "$CAND" && [ -z "$(git status --porcelain)" ]) || stopnow "candidate checkout not clean"
echo "checkout $(cd "$CAND" && git rev-parse HEAD)"
echo "artifacts: $(cd "$ART/.." && sha256sum b1a0/b1a0-parity.sql b1a/b1a-accept-r6r.sql b1a/b1a-repair-2026-r6r.mts | tr '\n' ' ')"

echo "--- 1. file identity"
[ "$(stat -c %s "$DUMP")" = "$BYTES" ] || stopnow "size $(stat -c %s "$DUMP") != $BYTES"
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$SHA" ] || stopnow "sha256 differs"
"$AFLDB_V2_PG_BIN/pg_restore" --list "$DUMP" | grep -E '^; +dbname: afldb_prod$' || stopnow "dump header does not name afldb_prod"
echo "PASS size $BYTES, sha256 $SHA, header dbname afldb_prod"

echo "--- 2. brand-new isolated cluster, restore"
mkdir -m 700 "$ROOT" || stopnow "mkdir"
IR init 2>&1 | strip | tail -2
IR start > "$ROOT/start.out" 2>&1 < /dev/null; sleep 3
IR roles 2>&1 | strip | tail -1
IR status 2>&1 | strip | tail -1
IR create-db "$DB" 2>&1 | strip | tail -1
T0=$(date +%s)
RO=$(IR run "$DB" -- bash -c '
  set -u; u=$AFLDB_TEST_DATABASE_URL
  PGPASSWORD=$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$u") \
  "$AFLDB_V2_PG_BIN/pg_restore" --no-password --no-comments --no-owner -j 4 -h 127.0.0.1 -p "$AFLDB_V2_PG_PORT" \
    -U "$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$u")" -d "'"$DB"'" "'"$DUMP"'" 2>&1
  echo "pg_restore exit=$?"' 2>&1 | strip | grep -v '^isolated-pg:')
echo "$RO" | tail -8; echo "restore seconds=$(( $(date +%s) - T0 ))"
echo "$RO" | grep -q '^pg_restore exit=0$' || fail "pg_restore exit status not 0"
[ "$(echo "$RO" | grep -vc '^pg_restore exit=')" = 0 ] || fail "pg_restore wrote $(echo "$RO" | grep -vc '^pg_restore exit=') stderr line(s)"

echo "--- 3-5. parity, acceptance equality, runner dry run (artifacts copied into the checkout untracked, removed after)"
(cd "$CAND" && [ ! -e "$REL" ]) || stopnow "$REL already present in the checkout"
mkdir -p "$CAND/$REL" && cp "$ART/../b1a/b1a-accept-r6r.sql" "$ART/../b1a/b1a-repair-2026-r6r.mts" "$CAND/$REL/"
OUT=$(IR run "$DB" -- bash -c '
  set -u; I=$AFLDB_TEST_IMPORT_DATABASE_URL
  read -r OID SYS < <(psql "$I" -XAtq -c "SELECT d.oid, c.system_identifier FROM pg_database d, pg_control_system() c WHERE d.datname = current_database()" | tr "|" " ")
  echo "### parity"
  PGOPTIONS="-c default_transaction_read_only=on" psql "$I" -X -v ON_ERROR_STOP=1 -At -f "'"$ART"'/b1a0-parity.sql"
  echo "### accept"
  PGOPTIONS="-c default_transaction_read_only=on" psql "$I" -X -v ON_ERROR_STOP=1 -At -v db="'"$DB"'" -v oid="$OID" -v sysid="$SYS" -f "'"$REL"'/b1a-accept-r6r.sql"
  echo "### runner"
  node --import tsx "'"$REL"'/b1a-repair-2026-r6r.mts" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "'"$DB"'" --expect-oid "$OID" --expect-sysid "$SYS" --expect-ids-md5 "'"$IDS"'"
  echo "runner exit=$?"' 2>&1 | strip | grep -v '^isolated-pg:')
rm -f "$CAND/$REL/b1a-accept-r6r.sql" "$CAND/$REL/b1a-repair-2026-r6r.mts"; (cd "$CAND" && rmdir -p "$REL" 2>/dev/null); true
(cd "$CAND" && [ -z "$(git status --porcelain)" ]) && echo "checkout clean again" || fail "checkout not clean after cleanup"
sec() { awk -v s="### $1" '$0==s{f=1;next} /^### /{f=0} f' <<< "$OUT"; }
P=$(sec parity); A=$(sec accept | grep -v '^identity|'); RN=$(sec runner)
echo "$P" | sed 's/^/  copy  /'
if diff <(echo "$P") <(tr -d '\r' < "$PE/parity-prod.txt") > /dev/null; then echo "PASS 3. nine parity aggregates equal production's"
else fail "3. parity differs:"; diff <(echo "$P") <(tr -d '\r' < "$PE/parity-prod.txt") | sed 's/^/    /'; fi
if diff <(echo "$A") <(tr -d '\r' < "$PE/accept-before-prod.txt" | grep -v '^identity|') > /dev/null; then
  echo "PASS 4. acceptance probe equals production's BEFORE capture on every line but identity ($(echo "$A" | wc -l) lines)"
else fail "4. acceptance differs:"; diff <(echo "$A") <(tr -d '\r' < "$PE/accept-before-prod.txt" | grep -v '^identity|') | sed 's/^/    /'; fi
echo "$RN" | grep -E '^(LOCKED|OUTCOME|runner exit)' | cut -c1-220 | sed 's/^/  /'
echo "$RN" | grep -q '^OUTCOME DRY-RUN-PASS (rolled back)$' && echo "PASS 5. runner dry run on the restored copy" || fail "5. runner dry run did not pass"

IR stop 2>&1 | strip | tail -1
ss -ltn | grep -q ":$PORT " && fail "port $PORT still listening" || echo "cluster stopped; root $ROOT and the dump copy retained (0700) for the owner's decision"
[ "$FAIL" = 0 ] && echo "VERDICT PASS backup proven by a fresh disposable restore" || echo "VERDICT FAIL"
exit "$FAIL"
