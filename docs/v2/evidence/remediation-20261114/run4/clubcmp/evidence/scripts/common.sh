#!/usr/bin/env bash
# rem4-clubcmp common env. Source me.
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-clubcmp-20261115
PORT=55683
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; EV="$W/evidence"; LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
RB_DIR=/mnt/ssd/afldb-rem3-base/rebuilt
RB_DUMP=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
BRIDGE=$RB_DIR/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
SNAP_DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SNAP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
TMPL_RB=afldb_v2_rem4clubcmp_rb_tmpl_test
TMPL_RBB=afldb_v2_rem4clubcmp_rb_bridged_test
TMPL_SN=afldb_v2_rem4clubcmp_snap_tmpl_test
mkdir -p "$EV"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
mkcopy() { IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
# read-only SQL file: Qf <db> <sqlfile>
Qf() { local db=$1 f=$2; (cd "$CAND" && timeout 300 node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -F"|" "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$f" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
# writable SQL file on a scratch copy: Wf <db> <sqlfile>
Wf() { local db=$1 f=$2; (cd "$CAND" && timeout 300 node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c '"$AFLDB_V2_PG_BIN/psql" -X -A -F"|" -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$f" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
summ() { node -e '
const j=require(process.argv[1]); const out=[];
for(const f of j.testResults){
  const n=f.name.replace(/\\/g,"/").replace(/^.*\/tests\//,"tests/");
  const bad=f.assertionResults.filter(a=>a.status==="failed");
  if(f.status==="failed"&&bad.length===0) out.push(n+"\t<file-level>\t"+String(f.message||"").split("\n")[0].slice(0,200));
  for(const a of bad) out.push(n+"\t"+a.fullName+"\t"+String(a.failureMessages[0]||"").split("\n")[0].slice(0,200));
}
console.log("total "+j.numTotalTests+" passed "+j.numPassedTests+" failed "+j.numFailedTests+" skipped "+(j.numPendingTests+(j.numTodoTests||0))+" files "+j.testResults.length);
console.log(out.sort().join("\n"));' "$1"; }
