#!/usr/bin/env bash
# remediation run 4, scope `fixloop`: requalification of what changed between Q'' and Q''' in $W/cand at the integration tip.
# Adapted from run4/qualification-4/scripts/{qual.sh,clones_c.sh}: vitest invocation, guards, vfail/counts extraction, the LOADED (`mnew`) and REAL (`mreal`)
# mutations and the fixture copy/verification are qual's; paths, port, database names and the fixture source (the QUAL workspace's hash-verified copies) are the fix-loop's.
#   bash $W/in/fix.sh <phase...>
#   phases: static f3 f4 fixtures_base fixtures_stagea unit_focus unit_all seal
# F3/F4 run with Stage A ABSENT (as qual's cells); the unit fixtures are installed AFTER them.
set -u -o pipefail
. "$(dirname "$0")/common.sh"
EVD=$CAND/$REPO_EVD
VF=$EVD/run4/baseline/scripts/vfail.js
CT=$EVD/run4/baseline/scripts/counts.js
RUNNER=$EVD/run2/tests363/run-integration-per-file.sh
CC=tests/integration/club-comparison.test.ts
STAGE=$CAND/data/sources/draftguru/annual-html-20260826
QUALD=/mnt/ssd/afldb-rem4-qual-20261115/cand/data      # the qual workspace's fixture copies: READ ONLY (copy only)

phase_static() {
  cd "$CAND"
  H timeout 1200 npm run -s typecheck > "$E/typecheck.log" 2>&1; echo "typecheck rc=$?" | tee -a "$E/typecheck.log"
  strip < "$E/typecheck.log" | grep -a -E "error TS" | head -10
  H timeout 1200 npm run -s lint:gate > "$E/lint-gate.log" 2>&1; echo "lint:gate rc=$?" | tee -a "$E/lint-gate.log"
  strip < "$E/lint-gate.log" | tail -8
  return 0
}

guard() {
  [ "$(git -C "$CAND" rev-parse HEAD)" = "$TIP" ] || { echo "HEAD is not the tip"; return 1; }
  [ "$(pc)" = 0 ] || { echo "porcelain not clean"; git -C "$CAND" status --porcelain | head; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB_PREFIX:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB_PREFIX set: refused"; return 1; }
  [ -z "${AFLDB_TEST_DATABASE_URL:-}${DATABASE_URL:-}" ] || { echo "ambient DSN set: refused"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB set in the driver env: refused"; return 1; }
  rm -rf "$CAND/node_modules/.vite/vitest" "$CAND/node_modules/.vitest"
}

derive() { # <tag> : summary, failing ids, counts from the vitest JSON
  local t=$1
  strip < "$E/$t.log" | grep -a -E "Test Files|Tests |Duration" | tail -3 | tee "$E/$t-summary.txt"
  node "$VF" "$E/$t.json" "$CAND" > "$E/$t-failures.tsv"
  echo "$t failing ids: $(wc -l < "$E/$t-failures.tsv")" | tee -a "$E/$t-summary.txt"
  cut -f1,2,3 "$E/$t-failures.tsv" | cut -c1-300
  node "$CT" "$E/$t.json" "$CAND" > "$E/$t-counts.txt"; head -6 "$E/$t-counts.txt" | tee -a "$E/$t-summary.txt"
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let n=0;for(const f of j.testResults)for(const a of f.assertionResults||[])if(/selected-season Brownlow coverage/.test(a.fullName)){n++;console.log("SUMMARY-TEST "+a.status+"  "+a.fullName)};if(!n)console.log("SUMMARY-TEST (not in this run)")' "$E/$t.json" | tee -a "$E/$t-summary.txt"
}

# cc_run <label> <template> <pf|sh> <preseed SQL|-> <vitest -t pattern|->
cc_run() {
  local label=$1 tmpl=$2 mode=$3 seed=$4 pat=$5 db=afldb_v2_rem4fixloop_${1}_test
  guard || return 1
  mkcopy "$db" "$tmpl"
  tcounts "$db" "$E/$label-before.table-counts.tsv" > /dev/null
  [ "$seed" = - ] || { QW "$db" "$seed" | tee "$E/$label-preseed.txt"; }
  Q "$db" "SELECT '$label 2026 brownlow_season_votes='||(SELECT count(*) FROM brownlow_season_votes WHERE season=2026)||' season_total='||(SELECT coverage::text FROM stat_availability WHERE stat_key='brownlow_season_total' AND season=2026)" | tee "$E/$label-state.txt"
  local targs=""; [ "$pat" = - ] || targs="-t '$pat'"
  say "$label start: $mode template=$tmpl preseed=$([ "$seed" = - ] && echo none || echo yes) pattern=$pat"
  if [ "$mode" = pf ]; then
    H timeout 3000 env CAND="$CAND" BASE="$db" MODE=all AUDIT="$E/$label-audit.jsonl" \
      bash "$RUNNER" "$CC" $targs --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1
  else
    H timeout 3000 bash -c "cd '$CAND' && exec env -u AFLDB_TEST_PER_FILE_DB node --import tsx tools/v2/isolated-pg.ts run $db -- node node_modules/vitest/vitest.mjs run $CC $targs --reporter=default --reporter=json --outputFile.json=$E/$label.json" > "$E/$label.log" 2>&1
  fi
  local rc=$?
  echo "$label rc=$rc" | tee -a "$E/$label.log"; say "$label end rc=$rc"
  derive "$label"
  tcounts "$db" "$E/$label-after.table-counts.tsv" > /dev/null
  diff "$E/$label-before.table-counts.tsv" "$E/$label-after.table-counts.tsv" > "$E/$label.table-counts.diff" && echo "$label: table counts unchanged by the run" || echo "$label: table counts changed ($(grep -c '^>' "$E/$label.table-counts.diff") rows; see $label.table-counts.diff)"
  echo "$label per-file DBs (afldb_v2_pf_*) left: $(IR list 2>/dev/null | grep -c 'afldb_v2_pf_' || true)"
  dropdb "$db"   # scratch copy dropped
  return 0
}

# F3: the whole club-comparison file at Q''' on fresh copies of both bases, per-file (AFLDB_TEST_PER_FILE_DB=all) and shared
phase_f3() {
  cc_run f3_rb_pf   "$TRB"   pf - -
  cc_run f3_rb_sh   "$TRB"   sh - -
  cc_run f3_snap_pf "$TSNAP" pf - -
  cc_run f3_snap_sh "$TSNAP" sh - -
}

# F4: the F-FX-1 mutations (scratch copies only). LOADED is run4/fixup/scripts/batch2.sh's `mnew` mutation (club_id NULL vote row), byte for byte;
# REAL is run4/qualification-4/scripts/clones_c.sh's `mreal` (one 3-vote row per 2026 club, attached to a real 2026 player of that club).
LOADED="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026"
REAL="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, s.player_id, s.club_id, 3 FROM (SELECT DISTINCT ON (pms.club_id) pms.player_id, pms.club_id FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id WHERE m.season = 2026 ORDER BY pms.club_id, pms.player_id) s; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026"
phase_f4() {
  local T='exposes selected-season Brownlow coverage'
  # controls (unmutated, the targeted test as in qual's mctl*)
  cc_run mctlrb   "$TRB"   sh - "$T"
  cc_run mctlsnap "$TSNAP" sh - "$T"
  # mnew: targeted (qual's failing line) then the WHOLE file, on both bases
  cc_run mnew         "$TRB"   sh "$LOADED" "$T"
  cc_run mnewsnap     "$TSNAP" sh "$LOADED" "$T"
  cc_run mnewfile     "$TRB"   sh "$LOADED" -
  cc_run mnewfilesnap "$TSNAP" sh "$LOADED" -
  # mreal: targeted then WHOLE file, both bases
  cc_run mrealrb         "$TRB"   sh "$REAL" "$T"
  cc_run mrealsnap       "$TSNAP" sh "$REAL" "$T"
  cc_run mrealfile       "$TRB"   sh "$REAL" -
  cc_run mrealfilesnap   "$TSNAP" sh "$REAL" -
}

# ---- fixtures (read-only copies from the QUAL workspace, hash-verified against committed manifests before and after) ----
sha() { sha256sum "$1" | cut -d' ' -f1; }
FH_SRC=$QUALD/sources/afltables/fitzroy_core/full-history-20260902
FH_DST=$CAND/data/sources/afltables/fitzroy_core/full-history-20260902
SJ_SRC=$QUALD/sources/draftguru/person-html-20260826/sample.json
SJ_DST=$CAND/data/sources/draftguru/person-html-20260826/sample.json
SJ_SHA=d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28
RI_SRC=$QUALD/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
RI_DST=$CAND/data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
SA_SRC=$QUALD/sources/draftguru/annual-html-20260826
SA_DST=$STAGE

phase_fixtures_base() {
  local exp=$EVD/run2/fixtures/fh-expected.sha256
  [ -e "$FH_SRC" ] && [ -e "$SJ_SRC" ] || { echo "qual workspace fixtures missing"; return 1; }
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
  { echo "# fixtures (base) copied read-only $(date -u +%FT%TZ) into $CAND at HEAD=$TIP from the QUAL workspace copies"
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
    echo "# Stage A and residual-input provenance $(date -u +%FT%TZ), HEAD=$TIP; sources are the QUAL workspace copies (read-only), never DEV"
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

phase_unit_focus() { # the one unit file that failed at Q'' (qual F-001), alone, for a named verdict
  cd "$CAND"
  env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run tests/v2-acquisition-pipeline.test.ts \
    --reporter=default --reporter=json --outputFile.json="$E/unit-focus.json" > "$E/unit-focus.log" 2>&1
  echo "unit-focus rc=$?" | tee -a "$E/unit-focus.log"
  strip < "$E/unit-focus.log" | grep -a -E "Test Files|Tests |Duration|stage map|\(e\)" | tail -8
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const f of j.testResults)for(const a of f.assertionResults||[])if(/\(e\)|stage map|equals renderAflApiStageMap/.test(a.fullName))console.log("TEST "+a.status+"  "+a.fullName)' "$E/unit-focus.json" | tee "$E/unit-focus-e.txt"
  return 0
}

phase_unit_all() {
  cd "$CAND"
  [ -e "$STAGE" ] && [ -e "$RI_DST" ] && [ -e "$SJ_DST" ] && [ -e "$FH_DST" ] || { echo "fixtures missing"; return 1; }
  H timeout 2400 env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
    --reporter=default --reporter=json --outputFile.json="$E/unit-all.json" > "$E/unit-all.log" 2>&1
  echo "unit-all rc=$?" | tee -a "$E/unit-all.log"
  strip < "$E/unit-all.log" | grep -a -E "Test Files|Tests |Duration" | tail -3
  node "$VF" "$E/unit-all.json" "$CAND" > "$E/unit-all-failures.tsv"; echo "unit-all failing ids: $(wc -l < "$E/unit-all-failures.tsv")"
  cut -f1,2 "$E/unit-all-failures.tsv" | cut -c1-200
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const f of j.testResults)if(/v2-acquisition-pipeline/.test(f.name))for(const a of f.assertionResults||[])if(/\(e\)/.test(a.fullName))console.log("TEST "+a.status+"  "+a.fullName)' "$E/unit-all.json" | tee "$E/unit-all-e.txt"
  return 0
}

# added after the first unit_all run (one timing failure in tests/rate-limit.test.ts, a 1 ms window): the file alone x10, then a second full unit run
phase_unit_rl() {
  cd "$CAND"
  local i rc
  : > "$E/unit-rl.log"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run tests/rate-limit.test.ts > "$E/unit-rl-$i.log" 2>&1; rc=$?
    echo "rate-limit alone run $i rc=$rc: $(strip < "$E/unit-rl-$i.log" | grep -a -E 'Tests ' | tr -s ' ')" | tee -a "$E/unit-rl.log"
  done
  return 0
}

phase_unit_all2() {
  cd "$CAND"
  [ -e "$STAGE" ] && [ -e "$RI_DST" ] && [ -e "$SJ_DST" ] && [ -e "$FH_DST" ] || { echo "fixtures missing"; return 1; }
  H timeout 2400 env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
    --reporter=default --reporter=json --outputFile.json="$E/unit-all2.json" > "$E/unit-all2.log" 2>&1
  echo "unit-all2 rc=$?" | tee -a "$E/unit-all2.log"
  strip < "$E/unit-all2.log" | grep -a -E "Test Files|Tests |Duration" | tail -3
  node "$VF" "$E/unit-all2.json" "$CAND" > "$E/unit-all2-failures.tsv"; echo "unit-all2 failing ids: $(wc -l < "$E/unit-all2-failures.tsv")"
  cut -f1,2 "$E/unit-all2-failures.tsv" | cut -c1-200
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const f of j.testResults)if(/v2-acquisition-pipeline/.test(f.name))for(const a of f.assertionResults||[])if(/\(e\)/.test(a.fullName))console.log("TEST "+a.status+"  "+a.fullName)' "$E/unit-all2.json" | tee "$E/unit-all2-e.txt"
  return 0
}

phase_seal() {
  cd "$E" || return 1
  for f in unit-all unit-all2 unit-focus; do [ -f "$f.json" ] && gzip -kf "$f.json"; [ -f "$f.log" ] && gzip -kf "$f.log"; done
  for f in f3_*.json f3_*.log mnew*.json mnew*.log mreal*.json mreal*.log mctl*.json mctl*.log; do [ -f "$f" ] && gzip -kf "$f"; done
  echo sealed
}

run_phases "$CAND" "$@"
