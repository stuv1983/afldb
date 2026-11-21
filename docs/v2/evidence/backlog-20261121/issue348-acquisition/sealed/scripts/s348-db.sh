#!/usr/bin/env bash
# ISSUE-348 backlog run b: guarded dry run + disposable rehearsal of the real load on isolated R0 restores.
#   bash s348-db.sh <phase>...   phases: cluster template pre dry1 recon dry2 reh1 reh2 stop
# Every database is an isolated-pg afldb_v2_b348_*_test copy on 127.0.0.1:61540 in this workspace. No other host,
# cluster or workspace is written. The R0 dump is a read-only COPY in $W/in. Nothing here contacts production.
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-348; C=$W/co; E=$W/ev; P=$W/ev-private; mkdir -p "$E" "$P"; chmod 700 "$P"
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61540 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
PY=$W/venv/bin/python
DUMP=$W/in/afldb_prod-20261122-025248.dump; DUMP_SHA=26db476126b8a2e5474a452d5bfdb9b790031a11e797481065e37041c1761d8b
CHILD=$W/in/s2-child.json; CHILD_SHA=d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e
OWNER=/mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111
LABEL=annual-html-20261122
TPL=afldb_v2_b348_r0tpl_test
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
fresh() { IR list 2>&1 | grep -q "^$1	" && IR drop-db "$1" --acknowledge-destroy "$1" 2>&1 | strip | tail -1; IR create-db "$1" --template "$TPL" 2>&1 | strip | tail -1; }
imp() { local db=$1; shift; IR run "$db" -- "$PY" tools/rebuild/draftguru/import_draftguru.py --label "$LABEL" --bridge "$CHILD" --no-seed "$@"; }
st() { IR run "$1" -- "$PY" -I "$W/state348.py" "$E/state-$2.json" "$P/rows-$2" 2>&1 | strip | grep -v '^isolated-pg:'; }

phase_cluster() {
  ss -ltnH "sport = :61540" | grep -q . && { echo "STOP port 61540 held"; return 1; }
  [ -e "$C/.env" ] && { echo "STOP .env in checkout"; return 1; }
  IR init 2>&1 | strip | tail -1 || return 1
  IR start > "$E/pg-start.out" 2>&1 < /dev/null; sleep 3
  IR roles 2>&1 | strip | tail -1
  IR status 2>&1 | strip | tail -2
}
phase_template() {
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "dump sha mismatch"; return 1; }
  [ "$(sha256sum "$CHILD" | cut -d' ' -f1)" = "$CHILD_SHA" ] || { echo "child sha mismatch"; return 1; }
  IR create-db "$TPL" 2>&1 | strip | tail -1
  IR run "$TPL" -- node "$W/restore348.mjs" "$DUMP" "$DUMP_SHA" 2>&1 | strip | grep -v '^isolated-pg:'
  IR run "$TPL" -- node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -3
  IR run "$TPL" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c 'ANALYZE' -c \"SELECT 'ledger=' || count(*) FROM afldb_meta.schema_migrations\"" 2>&1 | strip | grep -v '^isolated-pg:'
}
phase_pre() { st "$TPL" pre; }
phase_dry1() {
  fresh afldb_v2_b348_dry1_test
  rm -f "$E/guard-1.json"
  imp afldb_v2_b348_dry1_test --dry-run --guard-report "$E/guard-1.json" > "$E/dry1.log" 2>&1; echo "dry1 rc=$?"
  strip < "$E/dry1.log" | grep -E "snapshot|persons|picks|bridge|reload guard|REFUSED|digest" | cut -c1-400
}
phase_recon() {
  "$PY" -I "$W/recon348.py" "$C" "$E/guard-1.json" "$OWNER" "$E/reconciliation.json"
}
phase_dry2() {
  local sha; sha=$(sha256sum "$E/reconciliation.json" | cut -d' ' -f1)
  fresh afldb_v2_b348_dry2_test
  rm -f "$E/guard-2.json"
  imp afldb_v2_b348_dry2_test --dry-run --guard-report "$E/guard-2.json" --reconciliation "$E/reconciliation.json" --reconciliation-sha256 "$sha" > "$E/dry2.log" 2>&1; echo "dry2 rc=$?"
  strip < "$E/dry2.log" | grep -E "reload guard|REFUSED|digest|dry run|DRY|seed|ledger|bridge|authority" | cut -c1-300
}
reh() {
  local n=$1 sha; sha=$(sha256sum "$E/reconciliation.json" | cut -d' ' -f1)
  fresh "afldb_v2_b348_reh${n}_test"
  rm -f "$E/guard-reh$n.json"
  imp "afldb_v2_b348_reh${n}_test" --guard-report "$E/guard-reh$n.json" --reconciliation "$E/reconciliation.json" --reconciliation-sha256 "$sha" > "$E/reh$n.log" 2>&1; echo "reh$n rc=$?"
  strip < "$E/reh$n.log" | tail -40 | cut -c1-300
  st "afldb_v2_b348_reh${n}_test" "reh$n"
}
phase_reh1() { reh 1; }
phase_reh2() { reh 2; }
phase_stop() { IR stop 2>&1 | strip | tail -1; ss -ltnH "sport = :61540" | grep -q . && echo "still listening" || echo "stopped"; }
for ph in "$@"; do
  echo "=== $ph $(date -u +%T)"
  "phase_$ph" 2>&1 | tee -a "$E/run-$ph.log"
  rc=${PIPESTATUS[0]}
  echo "=== $ph rc=$rc $(date -u +%T)"
  [ "$rc" = 0 ] || exit "$rc"
done
