#!/usr/bin/env bash
# remediation run 3, scope qual: final integrated qualification of Q' in $W/cand (adapted from run2/qualification-2/qual.sh.txt,
# stagea.sh.txt and unit-all.sh.txt).
#
#   Q=<Q' sha> bash qual.sh <phase...>
#   phases, in the order run:
#     checkout static unit_nofix fixtures_base unit_fix integ fixtures_stagea unit_all shell build failures seal stop
#   (integ runs BEFORE the Stage A fixtures are added, exactly as run 2's integration run did, so the failing-id comparison
#    with run 2 compares like with like; unit_all then runs with every fixture present.)
#
# Ports: PostgreSQL 55674 (cluster started by setup.sh). The app and Caddy ports (55676, 55677) are NOT used: the AFLW %27
# metadata check is not required (no build-affecting or Caddy file changed since Q; see README).
# Every phase is wrapped by the driver below: the checkout's `git status --porcelain` line count is recorded before and after
# and the run STOPS on a non-zero count. Heavy phases hold the shared lock. Nothing here relabels a failure: a phase prints
# the raw rc and counts and returns 0 unless its own guard failed.
set -u -o pipefail
export W=/mnt/ssd/afldb-rem3-qual-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55674
export NEXT_TELEMETRY_DISABLED=1
: "${Q:?set Q to the full qualification commit sha}"
CAND=$W/cand; E=$W/evidence/q-${Q:0:8}; mkdir -p "$E"
LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
TMPL=afldb_v2_rem3qual_tmpl_test
PORT=55674
EVD=$CAND/docs/v2/evidence/remediation-20261114
QDIR=$EVD/run3/qualification-3
BASE_PKG_REV=6d5388ea5305e73b0420fbccfa7b0cea4fe75927
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
H() { flock "$LOCK" nice -n 10 "$@"; }
pc() { git -C "$CAND" status --porcelain | wc -l; }
porcelain() { echo "porcelain lines: $(pc)"; git -C "$CAND" status --porcelain | head -5; }

# vitest JSON -> TSV of failing ids: <file>\t<full test name | <file-level>>\t<first message line, 200 chars>
IFS= read -r -d '' VFAIL_JS <<'JS'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const root = process.argv[2].replace(/\/$/, '') + '/';
const one = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((x) => x.trim()).find((x) => x) || '';
const cut = (s) => one(s).replace(/\s+/g, ' ').slice(0, 200);
const rows = [];
for (const f of j.testResults) {
  const rel = f.name.startsWith(root) ? f.name.slice(root.length) : f.name;
  const failed = (f.assertionResults || []).filter((a) => a.status === 'failed');
  for (const a of failed) rows.push([rel, a.fullName, cut((a.failureMessages || [])[0])]);
  if (f.status === 'failed' && (failed.length === 0 || one(f.message))) rows.push([rel, '<file-level>', cut(f.message)]);
}
rows.sort((a, b) => (a[0] + '\t' + a[1] < b[0] + '\t' + b[1] ? -1 : a[0] + '\t' + a[1] > b[0] + '\t' + b[1] ? 1 : 0));
for (const r of rows) console.log(r.join('\t'));
JS
vfail() { node -e "$VFAIL_JS" "$1" "$CAND"; }

# failing-id comparison: gone / common / new, keyed on <file>\t<id>
IFS= read -r -d '' CMP_JS <<'JS'
const fs = require('fs');
const key = (l) => l.split('\t').slice(0, 2).join('\t');
const load = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
const old = load(process.argv[1]), cur = load(process.argv[2]);
const oldK = new Set(old.map(key)), curK = new Set(cur.map(key));
const gone = old.filter((l) => !curK.has(key(l))), common = cur.filter((l) => oldK.has(key(l))), neu = cur.filter((l) => !oldK.has(key(l)));
const fmt = (t, a) => '## ' + t + ' (' + a.length + ')\n' + a.map((l) => l.split('\t').slice(0, 2).join('  |  ')).join('\n');
console.log('run2 ids=' + old.length + ' this run ids=' + cur.length);
console.log(fmt('GONE (in run 2, not in this run)', gone));
console.log(fmt('COMMON', common));
console.log(fmt('NEW (not in run 2)', neu));
JS

phase_checkout() {
  cd "$CAND" || return 1
  echo "HEAD=$(git rev-parse HEAD) want=$Q"
  [ "$(git rev-parse HEAD)" = "$Q" ] || { echo "HEAD MISMATCH"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present"; return 1; }
  git diff --quiet "$BASE_PKG_REV" "$Q" -- package.json package-lock.json && echo "package.json / package-lock.json unchanged since $BASE_PKG_REV (npm ci ran at Q' in setup.sh)" \
    || { echo "package files differ from $BASE_PKG_REV"; git diff --stat "$BASE_PKG_REV" "$Q" -- package.json package-lock.json; }
  echo "node $(node --version) vitest $(node node_modules/vitest/vitest.mjs --version 2>/dev/null)"
  porcelain
}

phase_static() {
  cd "$CAND"
  H timeout 1200 npm run -s typecheck > "$E/typecheck.log" 2>&1; echo "typecheck rc=$?" | tee -a "$E/typecheck.log"
  strip < "$E/typecheck.log" | grep -a -E "error TS" | head -10
  H timeout 1200 npm run -s lint:gate > "$E/lint-gate.log" 2>&1; echo "lint:gate rc=$?" | tee -a "$E/lint-gate.log"
  strip < "$E/lint-gate.log" | tail -8
  return 0
}

unit_run() { # <tag>
  cd "$CAND"
  H timeout 2400 env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
    --reporter=default --reporter=json --outputFile.json="$E/unit-$1.json" > "$E/unit-$1.log" 2>&1
  echo "unit-$1 rc=$?" | tee -a "$E/unit-$1.log"
  strip < "$E/unit-$1.log" | grep -a -E "Test Files|Tests |Duration" | tail -3
  vfail "$E/unit-$1.json" > "$E/unit-$1-failures.tsv"; echo "unit-$1 failing ids: $(wc -l < "$E/unit-$1-failures.tsv")"
  cut -f1,2 "$E/unit-$1-failures.tsv" | cut -c1-170
  return 0
}
phase_unit_nofix() {
  [ -e "$CAND/data/sources/afltables/fitzroy_core/full-history-20260902" ] && { echo "fixtures already present: refusing the no-fixtures run"; return 1; }
  [ -e "$CAND/data/sources/draftguru" ] && { echo "draftguru data present: refusing the no-fixtures run"; return 1; }
  unit_run nofix
}
phase_fixtures_base() { bash "$QDIR/fixtures.sh" "$Q" base; }
phase_unit_fix() { [ -e "$CAND/data/sources/draftguru/person-html-20260826/sample.json" ] || { echo "fixtures missing"; return 1; }; unit_run fix; }
phase_fixtures_stagea() { bash "$QDIR/fixtures.sh" "$Q" stagea; }
phase_unit_all() {
  [ -e "$CAND/data/sources/draftguru/annual-html-20260826" ] && [ -e "$CAND/data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt" ] || { echo "Stage A / residual fixtures missing"; return 1; }
  unit_run allfix
}

phase_integ() {
  local BASE=afldb_v2_rem3qual_base_${Q:0:8}_test
  IR create-db "$BASE" --template "$TMPL" > "$E/integ-base-mk.log" 2>&1 || { cat "$E/integ-base-mk.log"; return 1; }
  echo "fresh base $BASE created from $TMPL"
  H timeout 10800 env CAND="$CAND" BASE="$BASE" MODE=all AUDIT="$E/integ-audit.jsonl" \
    bash "$EVD/run2/tests363/run-integration-per-file.sh" tests/integration \
    --reporter=default --reporter=json --outputFile.json="$E/integ.json" > "$E/integ.log" 2>&1
  echo "integ rc=$?" | tee -a "$E/integ.log"
  strip < "$E/integ.log" | grep -a -E "Test Files|Tests |Duration" | tail -4 | tee "$E/integ-summary.txt"
  echo "per-file DBs left: $(IR list 2>/dev/null | grep -c '_pf_' || true)" | tee -a "$E/integ-summary.txt"
  return 0
}

phase_shell() {
  cd "$CAND"
  for t in tests/restore-test.test.sh tests/sync-dev-remote.test.sh; do
    timeout 600 bash "$t" > "$E/$(basename "$t").log" 2>&1; echo "$t rc=$?" | tee -a "$E/$(basename "$t").log"
    grep -a -E "^(FAIL|passed|failed)|[0-9]+ passed|[0-9]+ failed" "$E/$(basename "$t").log" | tail -3
  done
  return 0
}

phase_build() {
  cd "$CAND"
  IR create-db afldb_v2_rem3qual_app_test --template "$TMPL" > "$E/build-mk.log" 2>&1 || { cat "$E/build-mk.log"; return 1; }
  H timeout 2400 node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rem3qual_app_test -- env NODE_ENV=production node node_modules/next/dist/bin/next build --webpack > "$E/build-next.log" 2>&1
  local b=$?; echo "build rc=$b" | tee -a "$E/build-next.log"; strip < "$E/build-next.log" | grep -a -v -E '^\s*$' | tail -6
  [ $b -eq 0 ] || return 0
  node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rem3qual_app_test -- node tools/build/prepare-standalone.mjs > "$E/build-standalone.log" 2>&1
  echo "standalone rc=$? BUILD_ID=$(cat .next/BUILD_ID)" | tee -a "$E/build-standalone.log"
  return 0
}

phase_failures() {
  vfail "$E/integ.json" > "$E/integ-failures.tsv"
  echo "integration failing ids: $(wc -l < "$E/integ-failures.tsv") ($(grep -c '<file-level>' "$E/integ-failures.tsv") file-level)"
  node -e "$CMP_JS" "$EVD/run2/qualification-2/integ-failures.tsv" "$E/integ-failures.tsv" | tee "$E/integ-compare.txt"
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=j.testResults;console.log("files: failed="+f.filter(x=>x.status==="failed").length+" passed="+f.filter(x=>x.status==="passed").length+" other="+f.filter(x=>x.status!=="failed"&&x.status!=="passed").length+" total="+f.length+"; tests: failed="+j.numFailedTests+" passed="+j.numPassedTests+" pending="+j.numPendingTests+" todo="+j.numTodoTests+" total="+j.numTotalTests)' "$E/integ.json" | tee -a "$E/integ-summary.txt"
  return 0
}

phase_seal() {
  cd "$E" || return 1
  for f in unit-nofix unit-fix unit-allfix integ; do [ -f "$f.json" ] && gzip -kf "$f.json"; done
  find . -maxdepth 1 -type f ! -name 'SHA256SUMS-host.txt' ! -name '*.json' ! -name 'qual-*.out' -printf '%f\n' | sort | xargs sha256sum | sed 's/  / */' > SHA256SUMS-host.txt
  wc -l SHA256SUMS-host.txt
  sha256sum "$QDIR/setup.sh" "$QDIR/qual.sh" "$QDIR/fixtures.sh" | tee "$E/scripts.sha256"
  return 0
}

phase_stop() {
  IR stop; sleep 2
  echo "listeners on 55674/55676/55677: $(ss -ltnH | awk '{print $4}' | grep -cE ':(55674|55676|55677)$')"
  echo "processes under $W: $(pgrep -u arm -af "$W" | grep -v pgrep | wc -l)"
  return 0
}

for ph in "$@"; do
  echo "##### $ph start $(date -u +%FT%TZ) HEAD=$(git -C "$CAND" rev-parse --short=8 HEAD) porcelain-before=$(pc)"
  [ "$(pc)" = 0 ] || { echo "##### PORCELAIN NOT CLEAN BEFORE $ph: stopping"; git -C "$CAND" status --porcelain | head; exit 3; }
  "phase_$ph"; rc=$?
  echo "##### $ph end $(date -u +%FT%TZ) rc=$rc porcelain-after=$(pc)"
  [ "$rc" = 0 ] || { echo "##### FAILED $ph"; exit 1; }
  [ "$(pc)" = 0 ] || { echo "##### PORCELAIN NOT CLEAN AFTER $ph: stopping"; git -C "$CAND" status --porcelain | head; exit 3; }
done
echo "##### done $(date -u +%FT%TZ)"
