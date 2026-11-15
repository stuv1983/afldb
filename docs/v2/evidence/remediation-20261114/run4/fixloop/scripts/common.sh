#!/usr/bin/env bash
# remediation run 4, scope `fixloop`: shared environment and helpers (sourced by setup.sh and fix.sh).
# Adapted from run4/qualification-4/scripts/common.sh (qual): workspace, port, database names, bundle and revision are the fix-loop's;
# the Q'' rebuild dump and the 4 Nov snapshot are the qual run's inputs (read-only). Never prints a password or a DSN.
export W=/mnt/ssd/afldb-rem4-fixloop-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55689
export NEXT_TELEMETRY_DISABLED=1
PORT=55689
TIP=9346605bd4cbd00465fd6a69d47ff3bf2ea064ed      # the integration tip (records-only above Q''')
QTRI=16027092e075d9064df8a3749c4b17805c2eaaeb    # Q''' = the fix-loop executable revision
QPP=1f7b0d717b37e98432716d6b9170fbd45142ab63     # Q''
BUNDLE=/mnt/ssd/afldb-rem4-base/base-Q3.bundle
BUNDLE_SHA=692120bbae25c11189abdcf8929a5a8eaf82f1a37a73816d65fa98b40e426c45
BRANCH=claude/rem4-fixloop-20261115
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
CAND=$W/cand
E=$W/evidence; mkdir -p "$E" 2>/dev/null
SNAP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SNAP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SNAP_BYTES=30141895
QDUMP=/mnt/ssd/afldb-rem4-qual-20261115/rebuilt/afldb_v2_rb_rem4q-1f7b0d71.dump   # the Q'' rebuild dump (qual P1), READ ONLY
QDUMP_SHA=f3c7dca967ba9a0c7b3f8907af9cf00648aba879e25acc6da9770067a7715e5b
QDUMP_BYTES=20662027
RB_DIR=/mnt/ssd/afldb-rem3-base/rebuilt                                       # holds restore-dump.mjs (RESTORE.md); READ ONLY
TSNAP=afldb_v2_rem4fixloop_snap_tmpl_test        # restored 4 Nov snapshot, migrated to ledger 118
TRB=afldb_v2_rem4fixloop_rb_tmpl_test            # restore of the Q'' rebuild dump (+ANALYZE), no bridge (club-comparison has no draft/bridge reference)
EVR=remediation-20261114
REPO_EVD=docs/v2/evidence/$EVR

strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
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
    echo "##### $ph start $(date -u +%FT%TZ) HEAD=$(git -C "$co" rev-parse --short=8 HEAD 2>/dev/null) porcelain-before=$(pc "$co")"
    [ "$(pc "$co")" = 0 ] || { echo "##### PORCELAIN NOT CLEAN BEFORE $ph: stopping"; git -C "$co" status --porcelain | head; exit 3; }
    "phase_$ph"; local rc=$?
    echo "##### $ph end $(date -u +%FT%TZ) rc=$rc porcelain-after=$(pc "$co")"
    [ "$rc" = 0 ] || { echo "##### FAILED $ph"; exit 1; }
    [ "$(pc "$co")" = 0 ] || { echo "##### PORCELAIN NOT CLEAN AFTER $ph: stopping"; git -C "$co" status --porcelain | head; exit 3; }
  done
  echo "##### done $(date -u +%FT%TZ)"
}
