#!/usr/bin/env bash
# remediation run 4, scope `qual`: P2 static/unit/shell/build and P3 the four integration cells at Q'' in $W/cand.
# Adapted from run3/qualification-3/{qual.sh,fixtures.sh} and run4/baseline/scripts/baseline.sh (vitest invocation, guards, vfail, counts, order extraction
# are the same; paths, port, database names, lock, revision and fixture sources are run 4's).
#   Q=... bash $W/in/qual.sh <phase...>
#   phases: tmpl_rb bridge static s_pf r_pf r_sh s_sh shell build fixtures_base fixtures_stagea unit_allfix seal
# Cells run with Stage A ABSENT from the checkout (as the baseline and run 3 did); the unit run installs every fixture AFTER the cells.
set -u -o pipefail
. "$(dirname "$0")/common.sh"
EVD=$CAND/$REPO_EVD
VF=$EVD/run4/baseline/scripts/vfail.js
CT=$EVD/run4/baseline/scripts/counts.js
RUNNER=$EVD/run2/tests363/run-integration-per-file.sh
STAGE=$CAND/data/sources/draftguru/annual-html-20260826
R3Q=/mnt/ssd/afldb-rem3-qual-20261114/cand/data      # run-3 qual workspace fixtures: READ ONLY (copy only)

phase_bridge() {  # TRBB = TRB + DraftGuru bridge child (RESTORE.md) + ANALYZE, imported from the RB checkout (it holds Stage A); the cells' checkout stays Stage-A-free
  [ -d "$RB/data/sources/draftguru/annual-html-20260826/raw/years" ] || { echo "RB checkout has no Stage A"; return 1; }
  mkcopy "$TRBB" "$TRB"
  H timeout 1800 bash -c "cd $RB && node --import tsx tools/v2/isolated-pg.ts run $TRBB -- $AFLDB_PYTHON tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge $BRIDGE" > "$E/bridge-import.log" 2>&1 \
    && say "bridge import rc=0" || { say "bridge import FAILED (bridge-import.log)"; tail -5 "$E/bridge-import.log"; return 1; }
  RUNDB "$TRBB" bash -c '"$AFLDB_V2_PG_BIN/psql" -X -q "$AFLDB_TEST_DATABASE_URL" -c ANALYZE' 2>&1 < /dev/null | strip > "$E/bridge-analyze.log"
  say "bridge: ANALYZE after import (planner statistics only)"
  Q "$TRBB" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)||' bridge_identities='||(SELECT count(*) FROM external_identities WHERE match_method='draftguru_person_page_afltables_bridge')" | tee "$E/bridged-identity.txt"
  tcounts "$TRBB" "$E/rb-bridged-template.table-counts.tsv"
  diff "$E/rb-table-counts.restored.tsv" "$E/rb-bridged-template.table-counts.tsv" > "$E/rb-bridged-vs-restored.diff"; echo "bridged vs pristine restored counts (expect only import_batches +1):"; cat "$E/rb-bridged-vs-restored.diff"
  [ ! -e "$STAGE" ] && echo "Stage A absent from $CAND"
}

phase_static() {
  cd "$CAND"
  H timeout 1200 npm run -s typecheck > "$E/typecheck.log" 2>&1; echo "typecheck rc=$?" | tee -a "$E/typecheck.log"
  strip < "$E/typecheck.log" | grep -a -E "error TS" | head -10
  H timeout 1200 npm run -s lint:gate > "$E/lint-gate.log" 2>&1; echo "lint:gate rc=$?" | tee -a "$E/lint-gate.log"
  strip < "$E/lint-gate.log" | tail -8
  return 0
}

cell_guard() {
  [ "$(git -C "$CAND" rev-parse HEAD)" = "$QPP" ] || { echo "HEAD is not Q''"; return 1; }
  [ "$(pc)" = 0 ] || { echo "porcelain not clean"; git -C "$CAND" status --porcelain | head; return 1; }
  [ ! -e "$STAGE" ] || { echo "Stage A present"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB_PREFIX:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB_PREFIX set: refused"; return 1; }
  [ -z "${AFLDB_TEST_DATABASE_URL:-}${DATABASE_URL:-}" ] || { echo "ambient DSN set: refused"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB set in the driver env: refused"; return 1; }
  rm -rf "$CAND/node_modules/.vite/vitest" "$CAND/node_modules/.vitest"   # no vitest cache: the same default file order in every cell
}

derive() { # <tag>
  local t=$1
  strip < "$E/$t.log" | grep -a -E "Test Files|Tests |Duration" | tail -4 | tee "$E/$t-summary.txt"
  node "$VF" "$E/$t.json" "$CAND" > "$E/$t-failures.tsv"
  echo "$t failing ids: $(wc -l < "$E/$t-failures.tsv") ($(grep -c '<file-level>' "$E/$t-failures.tsv") file-level)" | tee -a "$E/$t-summary.txt"
  node "$CT" "$E/$t.json" "$CAND" > "$E/$t-counts.txt"; head -6 "$E/$t-counts.txt" | tee -a "$E/$t-summary.txt"
  strip < "$E/$t.log" | grep -a -E '^ (✓|×|↓|❯) tests/integration/[^ ]+\.test\.ts \(' | awk '{print NR "\t" $2 "\t" $1}' > "$E/$t-order.txt"
  echo "$t files in execution order: $(wc -l < "$E/$t-order.txt")" | tee -a "$E/$t-summary.txt"
}

cell_perfile() { # <tag> <template> <bridge 0|1>
  local t=$1 tmpl=$2 br=$3 base=afldb_v2_rem4qual_${1}_base_test
  cell_guard || return 1
  mkcopy "$base" "$tmpl"
  tcounts "$base" "$E/$t-base-before.table-counts.tsv"
  say "$t start: per-file (AFLDB_TEST_PER_FILE_DB=all) base=$base template=$tmpl bridge=$br"
  local BR=""; [ "$br" = 1 ] && BR="AFLDB_DRAFTGURU_BRIDGE=$BRIDGE"
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
  local t=$1 tmpl=$2 br=$3 db=afldb_v2_rem4qual_${1}_test
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

phase_s_pf() { cell_perfile s_pf "$TSNAP" 0; }     # snapshot x per-file   (run 3's cell; no bridge, like run 3)
phase_r_pf() { cell_perfile r_pf "$TRBB" 1; }      # rebuild  x per-file   (baseline C1)
phase_r_sh() { cell_shared  r_sh "$TRBB" 1; }      # rebuild  x shared     (baseline C2)
phase_s_sh() { cell_shared  s_sh "$TSNAP" 0; }     # snapshot x shared     (baseline C3)

phase_shell() {
  cd "$CAND"
  for t in tests/restore-test.test.sh tests/sync-dev-remote.test.sh; do
    timeout 600 bash "$t" > "$E/$(basename "$t").log" 2>&1; echo "$t rc=$?" | tee -a "$E/$(basename "$t").log"
    grep -a -E "^(FAIL|passed|failed)|[0-9]+ passed|[0-9]+ failed|NOT RUN" "$E/$(basename "$t").log" | tail -4
  done
  return 0
}

phase_build() {
  cd "$CAND"
  mkcopy afldb_v2_rem4qual_app_test "$TSNAP" > "$E/build-mk.log" 2>&1 || { cat "$E/build-mk.log"; return 1; }
  H timeout 2400 node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rem4qual_app_test -- env NODE_ENV=production node node_modules/next/dist/bin/next build --webpack > "$E/build-next.log" 2>&1
  local b=$?; echo "build rc=$b" | tee -a "$E/build-next.log"; strip < "$E/build-next.log" | grep -a -v -E '^\s*$' | tail -6
  [ $b -eq 0 ] || return 0
  node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rem4qual_app_test -- node tools/build/prepare-standalone.mjs > "$E/build-standalone.log" 2>&1
  echo "standalone rc=$? BUILD_ID=$(cat .next/BUILD_ID)" | tee -a "$E/build-standalone.log"
  return 0
}

# ---- fixtures (read-only copies from the RUN-3 qual workspace, hash-verified against committed manifests before and after) ----
sha() { sha256sum "$1" | cut -d' ' -f1; }
FH_SRC=$R3Q/sources/afltables/fitzroy_core/full-history-20260902
FH_DST=$CAND/data/sources/afltables/fitzroy_core/full-history-20260902
SJ_SRC=$R3Q/sources/draftguru/person-html-20260826/sample.json
SJ_DST=$CAND/data/sources/draftguru/person-html-20260826/sample.json
SJ_SHA=d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28
RI_SRC=$R3Q/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
RI_DST=$CAND/data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
SA_SRC=$R3Q/sources/draftguru/annual-html-20260826
SA_DST=$STAGE

phase_fixtures_base() {
  local exp=$EVD/run2/fixtures/fh-expected.sha256
  [ -e "$FH_SRC" ] && [ -e "$SJ_SRC" ] || { echo "run-3 qual workspace fixtures missing"; return 1; }
  (cd "$FH_SRC" && sha256sum -c --quiet "$exp") || { echo "SOURCE fitzRoy hash mismatch"; return 1; }
  [ "$(ls "$FH_SRC" | wc -l)" = 131 ] || { echo "source file count not 131"; return 1; }
  [ "$(sha "$SJ_SRC")" = "$SJ_SHA" ] || { echo "SOURCE sample.json hash mismatch"; return 1; }
  [ ! -e "$FH_DST" ] && [ ! -e "$SJ_DST" ] || { echo "destination exists"; return 1; }
  mkdir -p "$(dirname "$FH_DST")" "$(dirname "$SJ_DST")"
  cp -a "$FH_SRC" "$FH_DST" && cp -p "$SJ_SRC" "$SJ_DST" || return 1
  chmod -R a-w "$FH_DST" "$SJ_DST"
  (cd "$FH_DST" && sha256sum -c --quiet "$exp") && echo "fitzRoy copy: 131 files re-verified against run2/fixtures/fh-expected.sha256" || { echo "COPY mismatch"; return 1; }
  [ "$(ls "$FH_DST" | wc -l)" = 131 ] || { echo "copy count not 131"; return 1; }
  [ "$(sha "$SJ_DST")" = "$SJ_SHA" ] && echo "sample.json copy re-verified" || { echo "COPY sample mismatch"; return 1; }
  { echo "# fixtures (base) copied read-only $(date -u +%FT%TZ) into $CAND at HEAD=$QPP from the run-3 qual workspace"
    echo "fitzroy src=$FH_SRC files=131, per-file sha256 = run2/fixtures/fh-expected.sha256 (131/131 OK at source and at copy)"
    echo "sample.json src=$SJ_SRC sha256=$SJ_SHA (source and copy)"; } > "$E/fixtures-provenance.txt"
}

phase_fixtures_stagea() {
  local man=$CAND/docs/rebuild-manifests/draftguru/annual-html-20260826.json exp=$E/stagea-expected.sha256
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const u of m.source_urls)console.log(u.sha256+"  "+u.raw_filename)' "$man" > "$exp" || return 1
  [ "$(wc -l < "$exp")" = 42 ] || { echo "manifest does not list 42 raw files"; return 1; }
  local ri_pin; ri_pin=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.residual_input.sha256))' "$SJ_DST") || return 1
  [ "$ri_pin" = df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841 ] || { echo "sample.json residual_input.sha256 unexpected: $ri_pin"; return 1; }
  {
    echo "# Stage A and residual-input provenance $(date -u +%FT%TZ), HEAD=$QPP; sources are the RUN-3 qual workspace copies (read-only), never DEV"
    echo "## 1. raw files against the committed manifest docs/rebuild-manifests/draftguru/annual-html-20260826.json (42 entries)"
    (cd "$SA_SRC" && sha256sum -c "$exp" | grep -c ': OK$' | sed 's/^/OK: /'; sha256sum -c --quiet "$exp" && echo "rc=0 (all 42 match)")
    echo "## 2. every file of the source against run 3's committed 90-file list run3/qualification-3/stagea-src.sha256"
    (cd "$SA_SRC" && find . -type f | sort | xargs sha256sum) > "$E/stagea-src.sha256"
    echo "files src=$(wc -l < "$E/stagea-src.sha256")"
    cmp -s "$E/stagea-src.sha256" "$EVD/run3/qualification-3/stagea-src.sha256" && echo "IDENTICAL (paths and sha256) to run3/qualification-3/stagea-src.sha256" || { echo "DIFFER from run 3's list"; diff "$E/stagea-src.sha256" "$EVD/run3/qualification-3/stagea-src.sha256" | head; }
    echo "tree sha256 (sha256 of the sorted list): $(sha256sum < "$E/stagea-src.sha256" | cut -d' ' -f1)"
    echo "## 3. residual input: source sha256 $(sha "$RI_SRC") ; sample.json residual_input.sha256 $ri_pin"
  } | tee "$E/stagea-provenance.txt"
  grep 'rc=0 (all 42 match)' "$E/stagea-provenance.txt" > /dev/null && grep IDENTICAL "$E/stagea-provenance.txt" > /dev/null || { echo "provenance check failed: not copied"; return 1; }
  [ "$(sha "$RI_SRC")" = "$ri_pin" ] || { echo "residual input source hash differs from sample.json residual_input.sha256: not copied"; return 1; }
  [ ! -e "$SA_DST" ] && [ ! -e "$RI_DST" ] || { echo "destination exists"; return 1; }
  cp -a "$SA_SRC" "$SA_DST" || return 1
  mkdir -p "$(dirname "$RI_DST")" && cp -p "$RI_SRC" "$RI_DST" || return 1
  chmod -R a-w "$SA_DST" "$RI_DST"
  (cd "$SA_DST" && find . -type f | sort | xargs sha256sum) | cmp -s - "$E/stagea-src.sha256" && echo "Stage A copy re-verified (90 files, paths and sha256)" | tee -a "$E/stagea-provenance.txt" || { echo "COPY MISMATCH"; return 1; }
  [ "$(sha "$RI_DST")" = "$ri_pin" ] && echo "residual input copy re-verified: sha256 $ri_pin = sample.json residual_input.sha256" | tee -a "$E/stagea-provenance.txt" || { echo "RESIDUAL COPY MISMATCH"; return 1; }
}

phase_unit_allfix() {
  cd "$CAND"
  [ -e "$STAGE" ] && [ -e "$RI_DST" ] && [ -e "$SJ_DST" ] && [ -e "$FH_DST" ] || { echo "fixtures missing"; return 1; }
  H timeout 2400 env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
    --reporter=default --reporter=json --outputFile.json="$E/unit-allfix.json" > "$E/unit-allfix.log" 2>&1
  echo "unit-allfix rc=$?" | tee -a "$E/unit-allfix.log"
  strip < "$E/unit-allfix.log" | grep -a -E "Test Files|Tests |Duration" | tail -3
  node "$VF" "$E/unit-allfix.json" "$CAND" > "$E/unit-allfix-failures.tsv"; echo "unit-allfix failing ids: $(wc -l < "$E/unit-allfix-failures.tsv")"
  cut -f1,2 "$E/unit-allfix-failures.tsv" | cut -c1-170
  return 0
}

phase_seal() {
  cd "$E" || return 1
  for f in s_pf r_pf r_sh s_sh unit-allfix; do [ -f "$f.json" ] && gzip -kf "$f.json"; [ -f "$f.log" ] && gzip -kf "$f.log"; done
  [ -f build-next.log ] && gzip -kf build-next.log
  echo sealed
}

run_phases "$CAND" "$@"
