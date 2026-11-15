#!/usr/bin/env bash
# remediation run 4, scope `leaks`: test-isolation (F-003) attribution + fixes. Adapted from run4/baseline/scripts/leaks-base.sh (same restore recipes).
#   C1 accepted rebuild x per-file (AFLDB_TEST_PER_FILE_DB=all)
#   C2 accepted rebuild x shared   (AFLDB_TEST_PER_FILE_DB unset: every file serially against ONE fresh copy)
#   C3 4 Nov snapshot  x shared    (same)
# Adapted from run3/qualification-3/{setup.sh,qual.sh} and run3/integ/run-rebuilt.sh (restore, bridge import, ANALYZE):
# only paths, ports, database names and the lock path differ; the vitest invocation is the same. Never prints a password or a DSN.
#
#   mkdir -p /mnt/ssd/afldb-rem4-leaks-20261115/in   (plain mkdir; the workspace must not exist yet)
#   scp this script and vfail.js counts.js into $W/in/
#   bash $W/in/leaks-base.sh <phase...>     phases: clone cluster tmpl_snap tmpl_rb bridge c1 c2 c3 seal stop
#   (the first run was `clone cluster tmpl_snap tmpl_rb`; its tmpl_rb stopped at the Stage A manifest check because the script prefixed
#    raw/years/ to manifest paths that already carry it. The phase was then split: tmpl_rb (restore + count diff, as run) and bridge
#    (path fixed), run as `bridge`.)
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
CAND=$W/cand
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

phase_clone() {
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha256 mismatch"; return 1; }
  grep -F "$BUNDLE_SHA" /mnt/ssd/afldb-rem4-base/SHA256SUMS >/dev/null || { echo "bundle sha not in SHA256SUMS"; return 1; }
  echo "bundle verified sha256 $BUNDLE_SHA"
  [ "$(stat -c %s "$SNAP")" = "$SNAP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$SNAP" | cut -d' ' -f1)" = "$SNAP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified: $SNAP_BYTES bytes sha256 $SNAP_SHA"
  ( cd "$RB_DIR" && sha256sum -c SHA256SUMS ) || { echo "rebuilt dir SHA256SUMS check failed"; return 1; }
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "rebuilt dump sha256 mismatch"; return 1; }
  [ "$(sha256sum "$BRIDGE" | cut -d' ' -f1)" = "$BRIDGE_SHA" ] || { echo "bridge child sha256 mismatch"; return 1; }
  echo "rebuilt dump and bridge child verified"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port in use"; return 1; fi
  [ ! -e "$CAND" ] || { echo "checkout already exists: workspace is not fresh"; return 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || return 1
  cd "$CAND" || return 1
  git bundle verify "$BUNDLE" 2>&1 | tail -2
  git fetch -q "$BUNDLE" claude/remediation-20261114:refs/heads/base || return 1
  git checkout -q base || return 1
  echo "HEAD=$(git rev-parse HEAD) want=$B4"
  [ "$(git rev-parse HEAD)" = "$B4" ] || { echo "HEAD MISMATCH"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present: refusing"; return 1; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "node $(node --version) vitest $(node node_modules/vitest/vitest.mjs --version 2>/dev/null)"
  echo "porcelain lines: $(pc)"
  [ "$(pc)" = 0 ] || return 1
}

phase_cluster() {
  [ ! -e "$AFLDB_V2_PG_ROOT" ] || { echo "cluster root already exists: not fresh"; return 1; }
  IR init || return 1
  IR start > "$E/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || return 1
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$E/listener.txt"
  PM=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  grep "pid=$PM," "$E/listener.txt" >/dev/null || { echo "the listener on $PORT is not this cluster's postmaster"; return 1; }
}

phase_tmpl_snap() {
  IR create-db "$TSNAP" || return 1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TSNAP -- node /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs $SNAP $SNAP_SHA" 2>&1 | strip | tail -4
  RUNDB "$TSNAP" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$CAND/.probe-dbs.mjs"
  RUNDB "$TSNAP" node .probe-dbs.mjs "$TSNAP" | tee "$E/snap-tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$E/snap-tmpl-probe.txt" > /dev/null || { echo "ledger is not 118"; return 1; }
  IR verify "$TSNAP" 2>&1 | strip | tail -2
  {
    echo "identity of the snapshot template (aggregates only):"
    Q "$TSNAP" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TSNAP" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players)||' fixtures='||(SELECT count(*) FROM fixtures) FROM matches"
    Q "$TSNAP" "SELECT 'seasons_row_2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$TSNAP" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
    Q "$TSNAP" "SELECT 'player_match_stats_authority_rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"
    Q "$TSNAP" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)"
  } 2>&1 | tee "$E/snap-template-identity.txt"
  tcounts "$TSNAP" "$E/snap-template.table-counts.tsv"
}

phase_tmpl_rb() {
  # restore exactly per RESTORE.md: create-db, restore-dump.mjs, verify, 83-table count diff
  IR create-db "$TRB" 2>&1 | strip | tail -1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TRB -- node $RB_DIR/restore-dump.mjs $RB_DUMP $RB_SHA" 2>&1 | strip | tee "$E/rb-restore.log" | tail -6
  IR verify "$TRB" 2>&1 | strip | tee -a "$E/rb-restore.log" | tail -2
  IR list 2>&1 | strip | grep -F "$TRB" | tee -a "$E/rb-restore.log" || true
  local TC; TC=$(ls "$RB_DIR"/*table-counts.tsv | head -1)
  local SQLTXT
  SQLTXT=$(awk -F'\t' 'NF==2 { printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1 }' "$TC")
  Q "$TRB" "$SQLTXT" | tr '|' '\t' | sort > "$E/rb-table-counts.restored.tsv"
  sort "$TC" > "$E/rb-table-counts.published.tsv"
  if diff "$E/rb-table-counts.published.tsv" "$E/rb-table-counts.restored.tsv" > "$E/rb-table-counts.diff"; then say "rebuilt table counts: IDENTICAL to $(basename "$TC") ($(wc -l < "$E/rb-table-counts.restored.tsv") tables)"; else say "rebuilt table counts: DIFFER (rb-table-counts.diff)"; return 1; fi
  {
    echo "identity of the restored accepted rebuild (aggregates only):"
    Q "$TRB" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TRB" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players)||' fixtures='||(SELECT count(*) FROM fixtures) FROM matches"
    Q "$TRB" "SELECT 'season2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$TRB" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
    Q "$TRB" "SELECT 'player_match_stats_authority_rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"
    Q "$TRB" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)"
  } 2>&1 | tee "$E/rb-template-identity.txt"
}

phase_bridge() {
  # DraftGuru bridge child (RESTORE.md): Stage A raw pages copied READ-ONLY from the run-3 workspace after all 42 match the committed
  # manifest; they are removed again after the import so no cell runs with Stage A present (as run 3's qualification integration run).
  say "stage A: verify and copy the 42 raw year pages from $STAGEA_SRC"
  local MISMATCH
  MISMATCH=$(node -e '
const fs=require("fs"),c=require("crypto");
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); let bad=0;
for(const e of m.source_urls){ const p=process.argv[2]+"/"+e.raw_filename; let ok=false; try{ ok=c.createHash("sha256").update(fs.readFileSync(p)).digest("hex")===e.sha256; }catch(_){} if(!ok){ bad++; console.error("MISMATCH "+e.raw_filename); } }
console.log(bad);' "$CAND/docs/rebuild-manifests/draftguru/annual-html-20260826.json" "$STAGEA_SRC")
  [ "$MISMATCH" = 0 ] || { echo "Stage A raw pages do not match the committed manifest ($MISMATCH)"; return 1; }
  [ ! -e "$STAGE" ] || { echo "Stage A destination exists"; return 1; }
  mkdir -p "$STAGE/raw" && cp -a "$STAGEA_SRC/raw/years" "$STAGE/raw/years" && chmod -R a-w "$STAGE/raw/years" || return 1
  say "stage A: 42/42 raw files match the manifest at source; copied"
  mkcopy "$TRBB" "$TRB"
  H timeout 1800 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TRBB -- $AFLDB_PYTHON tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge $BRIDGE" > "$E/bridge-import.log" 2>&1 && say "bridge import rc=0" || { say "bridge import FAILED (bridge-import.log)"; return 1; }
  RUNDB "$TRBB" bash -c '"$AFLDB_V2_PG_BIN/psql" -X -q "$AFLDB_TEST_DATABASE_URL" -c ANALYZE' 2>&1 < /dev/null | strip > "$E/bridge-analyze.log"
  say "bridge: ANALYZE after import (planner statistics only)"
  { Q "$TRBB" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)||' bridge_identities='||(SELECT count(*) FROM external_identities WHERE match_method='draftguru_person_page_afltables_bridge')"; } 2>&1 | tee "$E/bridged-identity.txt"
  chmod -R u+w "$STAGE" && rm -rf "$STAGE"
  [ ! -e "$STAGE" ] && say "stage A removed from the checkout (draftguru-import stays skipped in every cell)"
  tcounts "$TRBB" "$E/rb-bridged-template.table-counts.tsv"
  echo "porcelain lines: $(pc)"
}

# vitest summary lines from the log, failing ids, counts, order
derive() { # <tag>
  local t=$1
  strip < "$E/$t.log" | grep -a -E "Test Files|Tests |Duration" | tail -4 | tee "$E/$t-summary.txt"
  node "$IN/vfail.js" "$E/$t.json" "$CAND" > "$E/$t-failures.tsv"
  echo "$t failing ids: $(wc -l < "$E/$t-failures.tsv") ($(grep -c '<file-level>' "$E/$t-failures.tsv") file-level)" | tee -a "$E/$t-summary.txt"
  node "$IN/counts.js" "$E/$t.json" "$CAND" > "$E/$t-counts.txt"; head -6 "$E/$t-counts.txt" | tee -a "$E/$t-summary.txt"
  strip < "$E/$t.log" | grep -a -E '^\s*(✓|×|↓|❯|✗|-)?\s*tests/integration/[A-Za-z0-9_./-]+\.test\.ts' \
    | awk '{for(i=1;i<=NF;i++) if($i ~ /^tests\/integration\//){print $i; break}}' | awk '!s[$0]++' > "$E/$t-order-log.txt"
  echo "$t files in log order: $(wc -l < "$E/$t-order-log.txt")" | tee -a "$E/$t-summary.txt"
}

cell_guard() {
  [ "$(git -C "$CAND" rev-parse HEAD)" = "$B4" ] || { echo "HEAD is not B4"; return 1; }
  [ "$(pc)" = 0 ] || { echo "porcelain not clean"; git -C "$CAND" status --porcelain | head; return 1; }
  [ ! -e "$STAGE" ] || { echo "Stage A present"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB_PREFIX:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB_PREFIX set: refused"; return 1; }
  [ -z "${AFLDB_TEST_DATABASE_URL:-}${DATABASE_URL:-}" ] || { echo "ambient DSN set: refused"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB set in the driver env: refused"; return 1; }
  rm -rf "$CAND/node_modules/.vite/vitest" "$CAND/node_modules/.vitest"   # no vitest cache: the same default file order in every cell
}

cell_perfile() { # <tag> <template>
  local t=$1 tmpl=$2 base=afldb_v2_rem4leaks_${1}_base_test
  cell_guard || return 1
  mkcopy "$base" "$tmpl"
  tcounts "$base" "$E/$t-base-before.table-counts.tsv"
  say "$t start: per-file (AFLDB_TEST_PER_FILE_DB=all) base=$base template=$tmpl"
  local BR=""; [ "$t" = c1 ] && BR="AFLDB_DRAFTGURU_BRIDGE=$BRIDGE"
  H timeout 10800 env CAND="$CAND" BASE="$base" MODE=all AUDIT="$E/$t-audit.jsonl" $BR \
    bash "$RUNNER" tests/integration --reporter=default --reporter=json --outputFile.json="$E/$t.json" > "$E/$t.log" 2>&1
  local rc=$?
  echo "$t rc=$rc" | tee -a "$E/$t.log"; say "$t end rc=$rc"
  derive "$t"
  echo "per-file DBs left: $(IR list 2>/dev/null | grep -c '_pf_' || true)" | tee -a "$E/$t-summary.txt"
  tcounts "$base" "$E/$t-base-after.table-counts.tsv"
  diff "$E/$t-base-before.table-counts.tsv" "$E/$t-base-after.table-counts.tsv" > "$E/$t-base.table-counts.diff" && echo "base table counts unchanged by the run" | tee -a "$E/$t-summary.txt" || echo "BASE table counts CHANGED (see $t-base.table-counts.diff)" | tee -a "$E/$t-summary.txt"
  return 0
}

cell_shared() { # <tag> <template> <bridge 0|1>
  local t=$1 tmpl=$2 br=$3 db=afldb_v2_rem4leaks_${1}_test
  cell_guard || return 1
  mkcopy "$db" "$tmpl"
  tcounts "$db" "$E/$t-before.table-counts.tsv"
  say "$t start: shared (AFLDB_TEST_PER_FILE_DB unset) db=$db template=$tmpl bridge=$br"
  local BR=""; [ "$br" = 1 ] && BR="AFLDB_DRAFTGURU_BRIDGE=$BRIDGE"
  env | sed 's/=.*//' | grep -E '^AFLDB_' | sort > "$E/$t-env-names.txt"
  H timeout 10800 bash -c "cd '$CAND' && exec env -u AFLDB_TEST_PER_FILE_DB $BR node --import tsx tools/v2/isolated-pg.ts run $db -- node node_modules/vitest/vitest.mjs run tests/integration --reporter=default --reporter=json --outputFile.json=$E/$t.json" > "$E/$t.log" 2>&1
  local rc=$?
  echo "$t rc=$rc" | tee -a "$E/$t.log"; say "$t end rc=$rc"
  derive "$t"
  tcounts "$db" "$E/$t-after.table-counts.tsv"
  diff "$E/$t-before.table-counts.tsv" "$E/$t-after.table-counts.tsv" > "$E/$t.table-counts.diff"
  echo "$t table-count rows changed by the run: $(grep -c '^>' "$E/$t.table-counts.diff") (see $t.table-counts.diff)" | tee -a "$E/$t-summary.txt"
  { echo "fixtures rows before: $(grep -P '^fixtures\t' "$E/$t-before.table-counts.tsv" | cut -f2)"; echo "fixtures rows after:  $(grep -P '^fixtures\t' "$E/$t-after.table-counts.tsv" | cut -f2)"; } | tee -a "$E/$t-summary.txt"
  return 0
}

phase_c1() { cell_perfile c1 "$TRBB"; }
phase_c2() { cell_shared c2 "$TRBB" 1; }
phase_c3() { cell_shared c3 "$TSNAP" 0; }

phase_seal() {
  cd "$E" || return 1
  for f in c1 c2 c3; do [ -f "$f.json" ] && gzip -kf "$f.json"; [ -f "$f.log" ] && gzip -kf "$f.log"; done
  find . -maxdepth 1 -type f ! -name 'SHA256SUMS-host.txt' ! -name '*.json' ! -name '*.log' -printf '%f\n' | sort | xargs sha256sum | sed 's/  / */' > SHA256SUMS-host.txt
  wc -l SHA256SUMS-host.txt
  sha256sum "$IN/leaks-base.sh" "$IN/vfail.js" "$IN/counts.js" | tee "$E/scripts.sha256"
}

phase_stop() {
  IR stop; sleep 2
  echo "listeners on $PORT: $(ss -ltnH | awk '{print $4}' | grep -cE ":$PORT$")"
  echo "processes under $W: $(pgrep -u arm -af "$W" | grep -v pgrep | wc -l)"
}

for ph in "$@"; do
  echo "##### $ph start $(date -u +%FT%TZ)"
  "phase_$ph"; rc=$?
  echo "##### $ph end $(date -u +%FT%TZ) rc=$rc"
  [ "$rc" = 0 ] || { echo "##### FAILED $ph"; exit 1; }
done
echo "##### done $(date -u +%FT%TZ)"
