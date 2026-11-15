#!/usr/bin/env bash
# run-4 leaks scope: shared definitions (copied verbatim from leaks-setup.sh, itself from run4/baseline/scripts/baseline.sh); source, do not execute.
set -u -o pipefail
export W=/mnt/ssd/afldb-rem4-leaks-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55691
export NEXT_TELEMETRY_DISABLED=1
PORT=55691
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
BUNDLE=/mnt/ssd/afldb-rem4-base/base-B4.bundle
BUNDLE_SHA=b1e2491b9739703c2ea3484300e9f7db9b051cba5e1d44fb595e4badb13b7a74
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
CAND=${CAND:-$W/cand}
E=$W/evidence; mkdir -p "$E"
IN=$W/in
SNAP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SNAP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SNAP_BYTES=30141895
RB_DIR=/mnt/ssd/afldb-rem3-base/rebuilt
RB_DUMP=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
BRIDGE=$RB_DIR/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
BRIDGE_SHA=1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d
STAGEA_SRC=/mnt/ssd/afldb-rem3-qual-20261114/cand/data/sources/draftguru/annual-html-20260826   # run-3 workspace: READ ONLY (copy only)
STAGE=$CAND/data/sources/draftguru/annual-html-20260826
RUNNER=$CAND/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh
TSNAP=afldb_v2_rem4leaks_snap_tmpl_test       # pristine restored snapshot, migrated to ledger 118
TRB=afldb_v2_rem4leaks_rb_tmpl_test           # pristine restored accepted rebuild
TRBB=afldb_v2_rem4leaks_rbb_tmpl_test         # TRB + DraftGuru bridge child + ANALYZE (the base of C1 and C2)

strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
H() { flock "$LOCK" nice -n 10 "$@"; }
pc() { git -C "$CAND" status --porcelain | wc -l; }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E/run.log"; }
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
mkcopy() { IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
# exact count(*) of every public base table, sorted <table>\t<n>
tcounts() {
  local db=$1 out=$2 names sql
  names=$(Q "$db" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  sql=$(echo "$names" | awk 'NF{printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1}')
  Q "$db" "$sql" | tr '|' '\t' | sort > "$out"
  echo "tcounts $db: $(wc -l < "$out") tables -> $out"
}

