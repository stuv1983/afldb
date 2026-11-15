#!/usr/bin/env bash
# remediation run 4, scope `qual`: shared environment and helpers (sourced by setup.sh, closure.sh, rebuild.sh, qual.sh, clones.sh).
# Adapted from run3/qualification-3/{setup.sh,qual.sh} and run4/baseline/scripts/baseline.sh: workspace, port, database names, bundle,
# lock and revision are run 4's. Never prints a password or a DSN.
export W=/mnt/ssd/afldb-rem4-qual-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55687
export NEXT_TELEMETRY_DISABLED=1
PORT=55687
QPP=1f7b0d717b37e98432716d6b9170fbd45142ab63
BUNDLE=/mnt/ssd/afldb-rem4-base/base-Qpp.bundle
BUNDLE_SHA=63727560f7511534fd355ec94044205b354cacbd9ab65da6ea40444707737427
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
CAND=$W/cand          # the qualification checkout (no data/ inputs of the rebuild; Stage A absent during integration)
RB=$W/rb              # the rebuild checkout (holds the run-3 rebuild inputs; used only for P1)
E=$W/evidence; mkdir -p "$E" 2>/dev/null
IN=$W/in
SNAP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SNAP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SNAP_BYTES=30141895
RB_DIR=/mnt/ssd/afldb-rem3-base/rebuilt
RB_DUMP=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
BRIDGE=$RB_DIR/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
BRIDGE_SHA=1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d
RBDB=afldb_v2_rb_rem4q_test                      # the Q'' rebuild target (rebuild-name pattern)
TSNAP=afldb_v2_rem4qual_snap_tmpl_test           # restored snapshot, migrated to ledger 118
TRB=afldb_v2_rem4qual_rb_tmpl_test               # pristine restore of the rebuild dump used (Q'' dump, or the run-3 dump if reuse was proven)
TRBB=afldb_v2_rem4qual_rbb_tmpl_test             # TRB + DraftGuru bridge child + ANALYZE (the rebuild base of R-PF and R-SH)
EVR=remediation-20261114
REPO_EVD=docs/v2/evidence/$EVR

strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
IRB() { (cd "$RB" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
H() { flock "$LOCK" nice -n 10 "$@"; }
pc() { git -C "${1:-$CAND}" status --porcelain | wc -l; }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E/run.log"; }
# read-only psql: Q <db> <sql>
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
# read-write psql for SCRATCH copies only: QW <db> <sql>
QW() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c '"$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
mkcopy() { IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
dropdb() { IR drop-db "$1" --acknowledge-destroy "$1" 2>&1 | strip | tail -1; }
# exact count(*) of every public base table, sorted <table>\t<n>
tcounts() {
  local db=$1 out=$2 names sql
  names=$(Q "$db" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  sql=$(echo "$names" | awk 'NF{printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1}')
  Q "$db" "$sql" | tr '|' '\t' | sort > "$out"
  echo "tcounts $db: $(wc -l < "$out") tables -> $out"
}

# the driver: refuse on a non-clean checkout before and after each phase; print raw rc
run_phases() { # <porcelain checkout> <phase...>
  local co=$1; shift
  for ph in "$@"; do
    echo "##### $ph start $(date -u +%FT%TZ) HEAD=$(git -C "$co" rev-parse --short=8 HEAD) porcelain-before=$(pc "$co")"
    [ "$(pc "$co")" = 0 ] || { echo "##### PORCELAIN NOT CLEAN BEFORE $ph: stopping"; git -C "$co" status --porcelain | head; exit 3; }
    "phase_$ph"; local rc=$?
    echo "##### $ph end $(date -u +%FT%TZ) rc=$rc porcelain-after=$(pc "$co")"
    [ "$rc" = 0 ] || { echo "##### FAILED $ph"; exit 1; }
    [ "$(pc "$co")" = 0 ] || { echo "##### PORCELAIN NOT CLEAN AFTER $ph: stopping"; git -C "$co" status --porcelain | head; exit 3; }
  done
  echo "##### done $(date -u +%FT%TZ)"
}
