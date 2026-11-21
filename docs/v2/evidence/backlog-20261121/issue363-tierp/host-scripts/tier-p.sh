#!/usr/bin/env bash
# ISSUE-363 tier P (22 Nov 2026) DEV-host runner. Own workspace /mnt/ssd/afldb-backlog-20261122b-363, own isolated cluster (port 61530).
# The tier S template (afldb_v2_rb_s_test) is never written: every build and every test run uses a FRESH --template copy.
#   bash tier-p.sh <label> <phase> [args...]
#   phases: fp <db> <file>                 whole-database content fingerprint (fp.sql, no exclusions)
#           dry <db>                       tier P refusals + read-only plan on an existing copy (no --apply)
#           build <db>                     fresh copy of the tier S template, tier P applied with --apply, raw fingerprint of the result
#           negctl <db> <template> <name>  expected-refusal controls (the tool must refuse and write nothing)
#           gridley <db>                   the six Gridley/grid-solver/release-gate files, each on its own fresh copy of <db>
#           drop <db> | list | start | stop | status
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-363; C=$W/cand; S=$W/scripts
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61530 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python PYTHON=/home/arm/projects/afldb/.venv/bin/python NEXT_TELEMETRY_DISABLED=1
ST=afldb_v2_rb_s_test
LABEL=$1; PH=$2; shift 2
E=$W/ev/$LABEL; mkdir -p "$E"; SUM=$E/SUMMARY.txt
rec() { echo "$*" | tee -a "$SUM"; }
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
fresh() { IR list 2>&1 | grep -q "^$1	" && IR drop-db "$1" --acknowledge-destroy "$1" >/dev/null 2>&1; IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
drop() { IR drop-db "$1" --acknowledge-destroy "$1" 2>&1 | strip | tail -1; }
psqlf() { IR run "$1" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -v ON_ERROR_STOP=1 \"\$AFLDB_TEST_DATABASE_URL\" -f $2" 2>&1 | strip | grep -v '^isolated-pg:'; }
counts() { strip < "$1" | grep -E '^ +(Test Files|Tests) ' | tr -s ' ' | tr '\n' ';'; }
fails() { strip < "$1" | grep -E '^ +(×|FAIL) ' | head -40 | sed 's/^/    /'; }
tier_p() { # <db> <template> <outdir> [--apply]
  local db=$1 tpl=$2 out=$3; shift 3
  IR run "$db" -- node --conditions=react-server --import tsx tools/v2/rebuild-tier-p.ts --template-name "$tpl" --out "$out" "$@" 2>&1 | strip | grep -v '^isolated-pg:'
  return "${PIPESTATUS[0]}"
}

case "$PH" in
start)
  ss -ltnH "sport = :61530" | grep -q . && { rec "port 61530 already listening"; IR status 2>&1 | strip | tail -1; exit 0; }
  IR start > "$W/ev/pg-start-$(date -u +%H%M%S).out" 2>&1 < /dev/null; sleep 3; IR status 2>&1 | strip | tail -1 ;;
stop) IR stop 2>&1 | strip | tail -1; ss -ltnH "sport = :61530" | grep -q . && echo "port 61530 STILL listening" || echo "port 61530 closed" ;;
status|list) IR status 2>&1 | strip | tail -1; IR list 2>&1 | strip ;;
drop) drop "$1" | tee -a "$SUM" ;;
fp) psqlf "$1" "$S/fp.sql" > "$2"; rec "fingerprint of $1 -> $(basename "$2") sha256=$(sha256sum "$2" | cut -d' ' -f1) lines=$(wc -l < "$2")" ;;
dry)
  db=$1; rec "== $LABEL dry $db tool=$(sha256sum "$C/tools/v2/rebuild-tier-p.ts" | cut -c1-16) $(date -u +%FT%TZ)"
  tier_p "$db" "$ST" "$E/out" | tee -a "$SUM" ;;
build)
  db=$1; rec "== $LABEL build $db from $ST HEAD=$(git -C "$C" rev-parse HEAD) $(date -u +%FT%TZ)"
  [ -e "$E/out" ] && { rec "STOP $E/out exists"; exit 1; }
  fresh "$db" "$ST" | tee -a "$SUM"
  t0=$(date +%s); tier_p "$db" "$ST" "$E/out" --apply | tee -a "$SUM"; rc=${PIPESTATUS[0]}
  rec "tier P rc=$rc seconds=$(( $(date +%s) - t0 ))"
  [ "$rc" = 0 ] || exit "$rc"
  psqlf "$db" "$S/fp.sql" > "$E/fp-raw.txt"; rec "raw fingerprint (fp.sql, no exclusions) sha256=$(sha256sum "$E/fp-raw.txt" | cut -d' ' -f1)"
  sha256sum "$E/out/evidence-rekeyed.json" "$E/out/applier-report.json" "$E/out/tier-p-report.json" | sed "s#$W/##" | tee -a "$SUM" ;;
negctl)
  db=$1; tpl=$2; name=$3; rec "== $LABEL negctl $name: target $db, template-name $tpl $(date -u +%FT%TZ)"
  tier_p "$db" "$tpl" "$E/out-$name" --apply | cut -c1-400 | tee -a "$SUM"; rc=${PIPESTATUS[0]}
  rec "rc=$rc (expected non-zero); out dir exists: $([ -e "$E/out-$name" ] && echo YES || echo no)" ;;
gridley)
  base=$1; n=0
  rec "== $LABEL gridley base=$base HEAD=$(git -C "$C" rev-parse HEAD) $(date -u +%FT%TZ)"
  for f in gridley-corpus gridley-aa-oracle gridley-height-oracle grid-solver grid-solver-investigation release-gates; do
    n=$((n+1)); db="afldb_v2_rb_${LABEL}_g${n}_test"; name=${f//-/_}
    rec "-- $f on a fresh copy of $base ($db) $(date -u +%T)"
    fresh "$db" "$base" | tee -a "$SUM"
    rep=(); [ "$f" = gridley-corpus ] && rep=(--reporter=verbose)
    IR run "$db" -- env AFLDB_TEST_PER_FILE_DB= "AFLDB_GRIDLEY_REPORT=$E/report-$name.json" \
      node node_modules/vitest/vitest.mjs run "${rep[@]}" "tests/integration/$f.test.ts" > "$E/vitest-$name.log" 2>&1
    rc=$?; rec "vitest rc=$rc [$f] $(counts "$E/vitest-$name.log")"; fails "$E/vitest-$name.log" | tee -a "$SUM"
    if [ "$f" = gridley-corpus ]; then
      for id in "has no probed dataset gap" "conforms to the bounded approved-deferral policy" "writes the run report and has no failing cells"; do
        strip < "$E/vitest-$name.log" | grep -F -- "$id" | grep -E '^ *(✓|×|↓)' | head -1 | sed 's/ [0-9]*ms$//; s/^ */    ID: /' | tee -a "$SUM"
      done
      strip < "$E/vitest-$name.log" | grep -E '^\[gridley-corpus\] (dataset gaps|cells solved)' | cut -c1-300 | sed 's/^/    /' | tee -a "$SUM"
    fi
    drop "$db" | tee -a "$SUM"
  done
  node "$S/gridley-summary.mjs" "$E/report-gridley_corpus.json" 2>&1 | sed "s#$W/##" | tee "$E/gridley-summary.json" | cut -c1-2500 ;;
*) echo "unknown phase $PH"; exit 2 ;;
esac
