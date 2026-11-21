#!/usr/bin/env bash
# ISSUE-363 (2026-11-21) DEV-host runner. Own workspace /mnt/ssd/afldb-i363-20261121, own isolated cluster (port 61490), two
# read-only templates made by setup.sh: rb = accepted source-only rebuild, sn = populated 4 Nov snapshot. Every run uses a
# FRESH --template copy, dropped afterwards (a kept copy is named explicitly). No other port, cluster, workspace, the shared
# afldb_test, DEV services or production is touched.
#   bash i363.sh <label> <phase> [args...]
#   phases: sh <base> <file>...        shared run of <file>s on one fresh copy, then whole-database + row-level diff vs template
#           shn <base> <file> -- <neighbour>...   shared: <file> first, then the neighbours in a SECOND vitest run, same copy
#           pf <base> <file>...        per-file mode (AFLDB_TEST_PER_FILE_DB=all) on a fresh copy
#           vt <base> <db-suffix> <env...> -- <vitest args>   one vitest run on a fresh copy (Gridley / release gates)
#           overlay <base> <db>        make a KEPT overlay copy (GAP-029 labels via the audited applier, rekeyed by natural key)
#           start | stop | status
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-i363-20261121; C=$W/cand; S=$W/scripts
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61490 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python PYTHON=/home/arm/projects/afldb/.venv/bin/python NEXT_TELEMETRY_DISABLED=1
LABEL=$1; PH=$2; shift 2
E=$W/ev/$LABEL; mkdir -p "$E"; SUM=$E/SUMMARY.txt
rec() { echo "$*" | tee -a "$SUM"; }
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
tpl() { case "$1" in rb) echo afldb_v2_i363_rbtpl_test;; sn) echo afldb_v2_i363_sntpl_test;; rbb) echo afldb_v2_i363_rbbtpl_test;;
  rbov|rbbov|rbbovr) echo "afldb_v2_i363_${1}_test";; *) echo "bad base $1" >&2; return 1;; esac; }
fresh() { IR list 2>&1 | grep -q "^$1	" && IR drop-db "$1" --acknowledge-destroy "$1" >/dev/null 2>&1; IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
drop() { IR drop-db "$1" --acknowledge-destroy "$1" 2>&1 | strip | tail -1; }
psqlf() { IR run "$1" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -v ON_ERROR_STOP=1 ${3:-} \"\$AFLDB_TEST_DATABASE_URL\" -f $2" 2>&1 | strip | grep -v '^isolated-pg:'; }
counts() { strip < "$1" | grep -E '^ +(Test Files|Tests) ' | tr -s ' ' | tr '\n' ';'; }
fails() { strip < "$1" | grep -E '^ +(×|FAIL) ' | head -40 | sed 's/^/    /'; }
vrun() { # <db> <log> <env...> -- <vitest args>
  local db=$1 log=$2; shift 2; local envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  IR run "$db" -- env "${envs[@]}" node node_modules/vitest/vitest.mjs run "$@" > "$log" 2>&1
}
compare() { # <db> <tmpl> [suffix] : whole-database fingerprint diff, row-level diff of the award tables, FK refs to new batches
  local db=$1 t=$2 x=${3:-}
  rec "-- compare$x vs untouched template"
  psqlf "$t" "$S/fp.sql" > "$E/fp-template.txt"; psqlf "$db" "$S/fp.sql" > "$E/fp-after$x.txt"
  diff "$E/fp-template.txt" "$E/fp-after$x.txt" > "$E/fp$x.diff"
  rec "whole-db tables differing: $(grep '^>' "$E/fp$x.diff" | grep -c -v 'max_id=')"
  # name, row counts template -> after (hashes stay on the host)
  join -t= <(grep '^<' "$E/fp$x.diff" | sed 's/^< //' | grep -v max_id= | sort) <(grep '^>' "$E/fp$x.diff" | sed 's/^> //' | grep -v max_id= | sort) \
    | awk -F= '{split($2,a,":"); split($3,b,":"); printf "    %s rows %s -> %s%s\n", $1, a[1], b[1], (a[2]==b[2]?"":" content differs")}' | tee -a "$SUM"
  psqlf "$t" "$S/rows.sql" > "$E/rows-template.txt"; psqlf "$db" "$S/rows.sql" > "$E/rows-after$x.txt"
  awk -f "$S/rowdiff.awk" "$E/rows-template.txt" "$E/rows-after$x.txt" | sort | grep -v 'only_template=0 only_after=0 changed=0 ' | sed 's/^/    /' | tee -a "$SUM"
  local maxid; maxid=$(grep '^import_batches.max_id=' "$E/fp-template.txt" | cut -d= -f2)
  psqlf "$db" "$S/refs.sql" "-v maxid=$maxid" | grep -v '=0$' | sed 's/^/    /' | tee -a "$SUM"
}

case "$PH" in
start)
  ss -ltnH "sport = :61490" | grep -q . && { rec "port 61490 already listening"; IR status 2>&1 | strip | tail -1; exit 0; }
  IR start > "$W/ev/pg-start-$(date -u +%H%M%S).out" 2>&1 < /dev/null; sleep 3; IR status 2>&1 | strip | tail -1 ;;
stop) IR stop 2>&1 | strip | tail -1; ss -ltnH "sport = :61490" | grep -q . && echo "port 61490 STILL listening" || echo "port 61490 closed" ;;
status) IR status 2>&1 | strip | tail -1; IR list 2>&1 | strip ;;
sh|shn)
  base=$1; shift; t=$(tpl "$base"); db="afldb_v2_i363_${LABEL}_test"
  first=(); while [ $# -gt 0 ] && [ "$1" != "--" ]; do first+=("$1"); shift; done; [ $# -gt 0 ] && shift
  rec "== $LABEL $PH base=$base tmpl=$t HEAD=$(git -C "$C" rev-parse HEAD) porcelain=$(git -C "$C" status --porcelain | wc -l) $(date -u +%FT%TZ)"
  fresh "$db" "$t" | tee -a "$SUM"
  vrun "$db" "$E/vitest-1.log" AFLDB_TEST_PER_FILE_DB= -- "${first[@]}"; rc=$?
  rec "shared run 1 rc=$rc [${first[*]}] $(counts "$E/vitest-1.log")"; fails "$E/vitest-1.log" | tee -a "$SUM"
  compare "$db" "$t" 1
  if [ "$PH" = shn ] && [ $# -gt 0 ]; then
    vrun "$db" "$E/vitest-2.log" AFLDB_TEST_PER_FILE_DB= -- "$@"; rc=$?
    rec "shared run 2 (neighbours, same copy) rc=$rc [$*] $(counts "$E/vitest-2.log")"; fails "$E/vitest-2.log" | tee -a "$SUM"
    compare "$db" "$t" 2
  fi
  [ "${KEEP:-0}" = 1 ] && rec "kept $db" || drop "$db" | tee -a "$SUM" ;;
pf)
  base=$1; shift; t=$(tpl "$base"); db="afldb_v2_i363_${LABEL}_test"
  rec "== $LABEL pf base=$base tmpl=$t HEAD=$(git -C "$C" rev-parse HEAD) $(date -u +%FT%TZ)"
  fresh "$db" "$t" | tee -a "$SUM"
  vrun "$db" "$E/vitest-pf.log" AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
    "AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE=$AFLDB_V2_PG_ROOT/secrets/superuser.pw" -- "$@"; rc=$?
  rec "per-file rc=$rc [$*] $(counts "$E/vitest-pf.log")"; fails "$E/vitest-pf.log" | tee -a "$SUM"
  rec "per-file databases (afldb_v2_pf_*) left in the cluster after the run: $(IR list 2>&1 | strip | grep -c '^afldb_v2_pf_')"
  drop "$db" | tee -a "$SUM" ;;
vt)
  base=$1; sfx=$2; shift 2; t=$(tpl "$base"); db="afldb_v2_i363_${sfx}_test"
  envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  rec "== $LABEL vt base=$base tmpl=$t env=[${envs[*]}] HEAD=$(git -C "$C" rev-parse HEAD) $(date -u +%FT%TZ)"
  fresh "$db" "$t" | tee -a "$SUM"
  vrun "$db" "$E/vitest-$sfx.log" AFLDB_TEST_PER_FILE_DB= "${envs[@]}" -- "$@"; rc=$?
  rec "vitest rc=$rc [$*] $(counts "$E/vitest-$sfx.log")"; fails "$E/vitest-$sfx.log" | tee -a "$SUM"
  strip < "$E/vitest-$sfx.log" | grep -E '^\[gridley-corpus\]|gapped criteria' | head -30 | sed 's/^/    /' | tee -a "$SUM"
  drop "$db" | tee -a "$SUM" ;;
overlay)
  base=$1; db=$2; t=$(tpl "$base")
  rec "== $LABEL overlay base=$base -> $db HEAD=$(git -C "$C" rev-parse HEAD) $(date -u +%FT%TZ)"
  fresh "$db" "$t" | tee -a "$SUM"
  IR run "$db" -- node "$S/overlay-rekey.mjs" "$C/docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json" "$E/evidence-rekeyed.json" \
    2>&1 | strip | grep -v '^isolated-pg:' | tee -a "$SUM"
  [ -s "$E/evidence-rekeyed.json" ] || { rec "STOP rekey produced no evidence"; exit 1; }
  IR run "$db" -- node --conditions=react-server --import tsx tools/v2/apply-gap029-match-events.ts --apply \
    "--evidence=$E/evidence-rekeyed.json" "--report=$E/applier-report.json" 2>&1 | strip | grep -v '^isolated-pg:' | cut -c1-600 | tee -a "$SUM"
  psqlf "$db" "$S/fp.sql" > "$E/fp-overlay.txt"
  IR run "$db" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT 'data_overrides ' || entity_type || '/' || field_group || '=' || count(*) FROM data_overrides GROUP BY entity_type, field_group ORDER BY 1\" -c \"SELECT 'match_event ' || match_event || '=' || count(*) FROM matches WHERE match_event IS NOT NULL GROUP BY match_event ORDER BY 1\" -c \"SELECT 'data_edits=' || count(*) FROM data_edits\"" 2>&1 | strip | grep -v '^isolated-pg:' | tee -a "$SUM" ;;
*) echo "unknown phase $PH"; exit 2 ;;
esac
