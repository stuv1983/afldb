#!/usr/bin/env bash
# rbfail experiment runner. All databases are on MY cluster (port 55690).
#   bash rf.sh pf  <tag> <snap|rb> <vitest file args...>   per-file mode (AFLDB_TEST_PER_FILE_DB=all) on a fresh copy of the template
#   bash rf.sh sh  <tag> <snap|rb> <vitest file args...>   shared mode (one fresh copy, files serially, vitest order)
#   bash rf.sh sql <snap|rb> <sqlfile>                      read-only probe on the pristine template
#   bash rf.sh drop <db>                                    drop one of my databases
# A `pf`/`sh` run leaves $E/<tag>.log, <tag>.json, <tag>-failures.tsv, and (sh) <tag>-before/after table counts; the copy is dropped unless KEEP=1.
set -u -o pipefail
export W=/mnt/ssd/afldb-rem4-rbfail-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55690
export NEXT_TELEMETRY_DISABLED=1
CAND=${CAND_OVERRIDE:-$W/cand}; E=$W/evidence; IN=$W/in; mkdir -p "$E"
RUNNER=$CAND/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh
TSNAP=afldb_v2_rem4rbfail_snap_tmpl_test
TRBB=afldb_v2_rem4rbfail_rbb_tmpl_test
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
tmpl_of() { case "$1" in snap) echo $TSNAP;; rb) echo $TRBB;; *) echo "bad base $1" >&2; return 1;; esac; }
tcounts() { # <db> <out>
  local db=$1 out=$2 names sql
  names=$(Q "$db" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  sql=$(echo "$names" | awk 'NF{printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1}')
  Q "$db" "$sql" | tr '|' '\t' | sort > "$out"
}
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
mode=$1; shift
case "$mode" in
  sql) db=$(tmpl_of "$1"); f=$2; bash "$IN/probe.sh" "$db" "$f";;
  drop) IR drop-db "$1" --acknowledge-destroy "$1" 2>&1 | strip | tail -2;;
  pf|sh)
    tag=$1; base=$2; shift 2
    tmpl=$(tmpl_of "$base") || exit 2
    db=afldb_v2_rem4rbfail_${tag}_test
    IR create-db "$db" --template "$tmpl" 2>&1 | strip | tail -1
    if [ "$mode" = sh ]; then tcounts "$db" "$E/$tag-before.table-counts.tsv"; fi
    if [ "$mode" = pf ]; then
      CAND="$CAND" BASE="$db" MODE=all AUDIT="$E/$tag-audit.jsonl" \
        timeout 3000 bash "$RUNNER" "$@" --reporter=default --reporter=json --outputFile.json="$E/$tag.json" > "$E/$tag.log" 2>&1
    else
      (cd "$CAND" && timeout 3000 env -u AFLDB_TEST_PER_FILE_DB node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" --reporter=default --reporter=json --outputFile.json="$E/$tag.json") > "$E/$tag.log" 2>&1
    fi
    rc=$?; echo "$tag rc=$rc" | tee -a "$E/$tag.log"
    strip < "$E/$tag.log" | grep -a -E "Test Files|Tests |Duration" | tail -4
    [ -s "$E/$tag.json" ] && node "$IN/vfail.js" "$E/$tag.json" "$CAND" > "$E/$tag-failures.tsv" && cat "$E/$tag-failures.tsv" | cut -c1-330
    if [ "$mode" = sh ]; then tcounts "$db" "$E/$tag-after.table-counts.tsv"; diff "$E/$tag-before.table-counts.tsv" "$E/$tag-after.table-counts.tsv" > "$E/$tag.table-counts.diff"; echo "table-count rows changed: $(grep -c '^>' "$E/$tag.table-counts.diff")"; cat "$E/$tag.table-counts.diff" | head -20; fi
    if [ "${KEEP:-0}" != 1 ]; then IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1; fi
    ;;
  *) echo "usage"; exit 2;;
esac
