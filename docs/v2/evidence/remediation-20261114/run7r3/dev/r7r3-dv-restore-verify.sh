#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block D1v = proof of the D1 backup. Runs on the DEV host (streamanator) as arm. Touches NO production
# system: it restores the D1 dump (already copied to this host) into a BRAND-NEW isolated PostgreSQL cluster (new root, loopback port,
# generated credentials) and passes only if:
#   1. the file's size and sha256 equal the values D1 printed on production; the archive header names afldb_prod;
#   2. pg_restore exits 0 with no stderr line;
#   3. the nine parity aggregates on the copy equal D1's parity-prod.txt;
#   4. r7r3-a1-facts.sh `before` on the copy equals production's facts-before.txt on every line but `identity` (the 2026 state and the
#      fingerprints of every other season);
#   5. r7r3-d2-attach.sh `target` + `plan` on the copy, run from the CAND checkout on this host, produce EXACTLY production's D2 plan
#      digest, and its `dry` run on the copy passes (so the reviewed plan is also the plan for the backup).
# It then stops the cluster and deletes nothing but its temporary DSN file: the dump copy and the stopped cluster hold production data
# (including auth tables) and stay 0700 until the owner decides their removal.
# Usage: bash r7r3-dv-restore-verify.sh <dir holding the dump, .sha256, parity-prod.txt, facts-before.txt> <sha256> <bytes> <prod plan digest>
# Env: R7R3_DUMP_DBNAME (default afldb_prod; DEV self-test only), PORT (default 61471; outside 32768-60999, free), CAND (default /mnt/ssd/afldb-r7r3-20261121/cand at c8d4202a),
#      BLOCKS (default ../sitting beside this script, i.e. the hash-checked run7r3 copy).
set -u -o pipefail; umask 077
W=${1:?dir}; SHA=${2:?sha256}; BYTES=${3:?bytes}; DIG=${4:?digest}
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
CAND=${CAND:-/mnt/ssd/afldb-r7r3-20261121/cand}; HERE=$(cd "$(dirname "$0")" && pwd); BLOCKS=${BLOCKS:-$HERE/../sitting}
PORT=${PORT:-61471}; ROOT=$W/pg-verify; DB=afldb_v2_r7r3_d1v_test
export AFLDB_V2_PG_ROOT=$ROOT AFLDB_V2_PG_PORT=$PORT AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
FAIL=0; fail() { echo "FAIL $*"; FAIL=1; }
stopnow() { echo "STOP $*"; echo "VERDICT FAIL (stopped before completion)"; exit 1; }
echo "=== R7R3 D1v $(date -u +%FT%TZ) host=$(hostname) dir=$W"
[ "$(stat -c %a "$W")" = 700 ] || stopnow "$W must be 0700"
DUMP=$(ls -1 "$W"/afldb_prod-*.dump 2>/dev/null); [ "$(echo "$DUMP" | grep -c .)" = 1 ] || stopnow "exactly one afldb_prod dump expected in $W"
for f in "$W/parity-prod.txt" "$W/facts-before.txt" "$BLOCKS/r7r3-a1-facts.sh" "$BLOCKS/r7r3-d2-attach.sh"; do [ -s "$f" ] || stopnow "missing $f"; done
[ "$PORT" -ge 61000 ] && [ "$PORT" -le 65535 ] || stopnow "PORT $PORT is inside the ephemeral range or invalid"
ss -ltn | grep -q ":$PORT " && stopnow "port $PORT already listening"
[ -e "$ROOT" ] && stopnow "$ROOT exists: a fresh cluster is required"
(cd "$CAND" && [ "$(git rev-parse HEAD)" = c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76 ] && [ -z "$(git status --porcelain)" ]) || stopnow "CAND checkout not at c8d4202a or not clean"
echo "blocks: $(cd "$BLOCKS" && sha256sum r7r3-a1-facts.sh r7r3-d2-attach.sh | tr '\n' ' ')"

echo "--- 1. file identity"
[ "$(stat -c %s "$DUMP")" = "$BYTES" ] || stopnow "size $(stat -c %s "$DUMP") != $BYTES"
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$SHA" ] || stopnow "sha256 differs"
"$AFLDB_V2_PG_BIN/pg_restore" --list "$DUMP" | grep -E "^; +dbname: ${R7R3_DUMP_DBNAME:-afldb_prod}$" > /dev/null || stopnow "dump header does not name ${R7R3_DUMP_DBNAME:-afldb_prod}"
echo "PASS size $BYTES, sha256 $SHA, header dbname afldb_prod"

echo "--- 2. brand-new isolated cluster, restore"
mkdir -m 700 "$ROOT" || stopnow "mkdir"
IR init 2>&1 | strip | tail -1
IR start > "$ROOT/start.out" 2>&1 < /dev/null; sleep 3
IR roles 2>&1 | strip | tail -1
IR create-db "$DB" 2>&1 | strip | tail -1
T0=$(date +%s)
RO=$(IR run "$DB" -- bash -c '
  set -u; u=$AFLDB_TEST_DATABASE_URL
  PGPASSWORD=$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$u") \
  "$AFLDB_V2_PG_BIN/pg_restore" --no-password --no-comments --no-owner -j 4 -h 127.0.0.1 -p "$AFLDB_V2_PG_PORT" \
    -U "$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$u")" -d "'"$DB"'" "'"$DUMP"'" 2>&1
  echo "pg_restore exit=$?"' 2>&1 | strip | grep -v '^isolated-pg:')
echo "$RO" | tail -4; echo "restore seconds=$(( $(date +%s) - T0 ))"
echo "$RO" | grep -q '^pg_restore exit=0$' || fail "pg_restore exit status not 0"
[ "$(echo "$RO" | grep -vc '^pg_restore exit=')" = 0 ] || fail "pg_restore wrote stderr line(s)"

echo "--- 3-5. parity, facts equality, plan digest and dry run on the copy"
CD=$W/copy-$(date -u +%Y%m%dT%H%M%SZ); mkdir -m 700 "$CD"; STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$(IR run "$DB" -- bash -c '
  set -u; I=$AFLDB_TEST_IMPORT_DATABASE_URL; O=$AFLDB_TEST_DATABASE_URL; CD=$1; BL=$2; STAMP=$3; DIG=$4; CAND=$5; W=$6
  ENVF=$CD/copy.env; printf "AFLDB_BACKUP_DATABASE_URL=%s\nAFLDB_IMPORT_DATABASE_URL=%s\n" "$O" "$I" > "$ENVF"; chmod 600 "$ENVF"
  IDC=$(psql "$I" -XAtq -c "SELECT current_database(), d.oid, c.system_identifier FROM pg_database d, pg_control_system() c WHERE d.datname = current_database()")
  echo "### parity"
  PGOPTIONS="-c default_transaction_read_only=on" psql "$I" -X -q -v ON_ERROR_STOP=1 -At -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" \
    -c "SELECT '"'"'player_match_stats rows'"'"', count(*) FROM player_match_stats" -c "SELECT '"'"'players rows'"'"', count(*) FROM players" \
    -c "SELECT '"'"'matches rows'"'"', count(*) FROM matches" -c "SELECT '"'"'clubs rows'"'"', count(*) FROM clubs" \
    -c "SELECT '"'"'career games total'"'"', sum(games) FROM player_career_stats" -c "SELECT '"'"'career goals total'"'"', sum(goals) FROM player_career_stats" \
    -c "SELECT '"'"'Brownlow votes total'"'"', sum(votes) FROM brownlow_season_votes" -c "SELECT '"'"'unrecorded disposals'"'"', count(*) FROM player_match_stats WHERE disposals IS NULL" \
    -c "SELECT '"'"'stat_availability rows'"'"', count(*) FROM stat_availability" -c "ROLLBACK"
  echo "### facts"
  R7R3_CHECKOUT=$CAND R7R3_ENV_FILE=$ENVF R7R3_DATA=$CD R7R3_IDENTITY=$IDC bash "$BL/r7r3-a1-facts.sh" "$STAMP" before
  echo "### target"
  ACT=$(psql "$O" -XAtq -c "SELECT min(id) FROM auth_users WHERE role = '"'"'super_admin'"'"' AND disabled_at IS NULL")
  R7R3_CHECKOUT=$CAND R7R3_ENV_FILE=$ENVF R7R3_DATA=$CD R7R3_IDENTITY=$IDC bash "$BL/r7r3-d2-attach.sh" "$STAMP" target 2>&1 | grep -v "^ACTOR-CANDIDATE"
  echo "### plan"
  R7R3_CHECKOUT=$CAND R7R3_ENV_FILE=$ENVF R7R3_DATA=$CD R7R3_IDENTITY=$IDC R7R3_EXPECT_DIGEST=$DIG bash "$BL/r7r3-d2-attach.sh" "$STAMP" plan
  echo "### dry"
  R7R3_CHECKOUT=$CAND R7R3_ENV_FILE=$ENVF R7R3_DATA=$CD R7R3_IDENTITY=$IDC bash "$BL/r7r3-d2-attach.sh" "$STAMP" dry "$DIG" "$ACT"
  rm -f "$ENVF"' _ "$CD" "$BLOCKS" "$STAMP" "$DIG" "$CAND" "$W" 2>&1 | strip | grep -v '^isolated-pg:')
sec() { awk -v s="### $1" '$0==s{f=1;next} /^### /{f=0} f' <<< "$OUT"; }
P=$(sec parity)
if diff <(echo "$P") <(tr -d '\r' < "$W/parity-prod.txt") > /dev/null; then echo "PASS 3. nine parity aggregates equal production's"
else fail "3. parity differs:"; diff <(echo "$P") <(tr -d '\r' < "$W/parity-prod.txt") | sed 's/^/    /'; fi
sec facts | grep -E '^(PASS|FAIL|A1 RESULT)' | sed 's/^/  copy /'
if diff <(grep -v '^identity|' "$CD/facts-before.txt") <(tr -d '\r' < "$W/facts-before.txt" | grep -v '^identity|') > /dev/null; then
  echo "PASS 4. facts on the copy equal production's facts-before on every line but identity ($(grep -vc '^identity|' "$CD/facts-before.txt") lines)"
else fail "4. facts differ:"; diff <(grep -v '^identity|' "$CD/facts-before.txt") <(tr -d '\r' < "$W/facts-before.txt" | grep -v '^identity|') | sed 's/^/    /'; fi
for s in target plan dry; do sec $s | grep -E '^(PLAN|APPLY|REFUSED|STOP|D RESULT|PASS digest)' | cut -c1-200 | sed "s/^/  $s /"; done
sec plan | grep -q "^D RESULT plan PASS digest=$DIG$" && echo "PASS 5a. plan on the copy has production's digest $DIG" || fail "5a. plan digest on the copy is not $DIG"
sec dry | grep -q '^D RESULT dry PASS$' && echo "PASS 5b. dry run on the copy" || fail "5b. dry run on the copy did not pass"
[ ! -e "$CD/copy.env" ] || { rm -f "$CD/copy.env"; fail "temporary DSN file had to be removed by the fallback"; }
IR stop 2>&1 | strip | tail -1
ss -ltn | grep -q ":$PORT " && fail "port $PORT still listening" || echo "cluster stopped; $ROOT and the dump copy retained (0700) for the owner's decision"
[ "$FAIL" = 0 ] && echo "VERDICT PASS backup proven by a fresh disposable restore" || echo "VERDICT FAIL"
exit "$FAIL"
