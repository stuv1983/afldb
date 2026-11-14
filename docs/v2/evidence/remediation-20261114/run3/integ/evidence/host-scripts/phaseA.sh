#!/usr/bin/env bash
# rem3-integ phase A experiments. usage: phaseA.sh <step> [args]
# Every database-touching command runs through isolated-pg run on THIS scope's cluster (port 55673) only.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem3-integ-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55673
CAND="$W/cand"; EV="$W/evidence/a"; LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
TMPL=afldb_v2_rem3integ_tmpl_test
mkdir -p "$EV"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/phaseA.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }
mk() { IR create-db "$1" --template "$TMPL" 2>&1 | strip | tail -1; }
# read-only SQL on a database of this cluster
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | grep -a -v '^isolated-pg:'); }
# shared-mode vitest: vt <db> <label> <timeout> <vitest args...>
vt() {
  local db=$1 label=$2 to=$3; shift 3
  say "vt $label db=$db: $*"
  (cd "$CAND" && ${HEAVY:+flock "$LOCK"} timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
     --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1); local rc=$?
  say "vt $label rc=$rc: $(strip < "$EV/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  return $rc
}
# per-file vitest: pf <base-db> <label> <timeout> <vitest args...>  (MODE=all: every file its own database from the base)
pf() {
  local base=$1 label=$2 to=$3; shift 3
  say "pf $label base=$base: $*"
  ${HEAVY:+flock "$LOCK"} timeout "$to" env CAND="$CAND" BASE="$base" MODE=all \
    bash "$CAND/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh" "$@" \
    --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1; local rc=$?
  say "pf $label rc=$rc: $(strip < "$EV/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  return $rc
}

case "$1" in
  mkq) shift; for d in "$@"; do mk "$d"; done ;;
  q) shift; Q "$@" ;;
  vt) shift; vt "$@" ;;
  pf) shift; pf "$@" ;;
  list) IR list ;;
  drop) shift; for d in "$@"; do IR drop-db "$d" --acknowledge-destroy "$d" 2>&1 | strip | tail -1; done ;;
  *) echo "unknown step"; exit 2 ;;
esac
