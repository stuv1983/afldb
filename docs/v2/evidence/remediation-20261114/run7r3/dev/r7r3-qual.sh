#!/usr/bin/env bash
# Release 7R3 DEV qualification of the EXACT candidate checked out at $W/cand (git checkout, not an export).
# Database: the ACCEPTED source-only rebuild (afldb_v2_rb_rem3-6d5388ea.dump; 30 stages / 91 checks; ledger 118) restored as
# template afldb_v2_rb_r7r3tpl_test; every suite gets its own FRESH copy. No production data in this cluster.
#   bash r7r3-qual.sh <phase>...   phases: pins static integ build e2e
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-r7r3-20261121; C=$W/cand; E=${R7R3_QUAL_EVIDENCE:-$W/evidence/qual-c8d4202a}; mkdir -p "$E"
BASE=/mnt/ssd/afldb-rel7r2-20261121/cand          # the 7R2-qualified a3c8c67c tree, for classifying any failure
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61470 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python NEXT_TELEMETRY_DISABLED=1
TPL=afldb_v2_rb_r7r3tpl_test; S=$E/SUMMARY.txt; touch "$S"
rec() { echo "$*" | tee -a "$S"; }
strip() { sed -e 's/\x1b\[[0-9;]*m//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
cd "$C"; IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
fresh() { IR list 2>&1 | grep -q " $1 \| $1$\|^$1" && IR drop-db "$1" --acknowledge-destroy "$1" >/dev/null 2>&1; IR create-db "$1" --template "$TPL" 2>&1 | tail -1; }
vt() { node node_modules/vitest/vitest.mjs run "$@"; }
counts() { strip < "$1" | grep -E '^ +(Test Files|Tests) ' | tr -s ' ' | tr '\n' ';'; }

phase_pins() {
  rec "== pins $(date -u +%FT%TZ) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) entries=$(git ls-tree -r HEAD | wc -l)"
  rec "parent chain: $(git log --format=%h -4 | tr '\n' ' ')"
  rec "changed vs a3c8c67c: $(git diff --name-only a3c8c67cc98fc35e963795e331e7217a24ccf1e0 HEAD -- src tools tests deploy package.json package-lock.json | tr '\n' ' ')"
  rec "template: $(IR list 2>&1 | grep -c "$TPL") listed; python $($AFLDB_PYTHON -c 'import psycopg,sys;print(sys.version.split()[0],"psycopg",psycopg.__version__)' 2>&1)"
}

phase_static() {
  npm ci --no-audit --no-fund > "$E/npm-ci.log" 2>&1; rec "npm ci rc=$?"
  npm run -s typecheck > "$E/typecheck.log" 2>&1; rec "typecheck rc=$?"
  npm run -s lint:gate > "$E/lint-gate.log" 2>&1; rec "lint:gate rc=$? $(tail -n 3 "$E/lint-gate.log" | tr '\n' ' ' | cut -c1-200)"
  npx eslint src/lib/format.ts "src/app/players/[slug]/page.tsx" src/db/queries/brownlow-season-attachment.ts tools/v2/brownlow-season-attach.ts \
    tests/format.test.ts tests/e2e/journeys.spec.ts tests/integration/brownlow-season-attachment.test.ts tests/integration/brownlow-fixture.ts \
    tests/integration/leaked-fixtures.ts tests/v2-season-seal.test.ts > "$E/eslint-changed.log" 2>&1; rec "eslint (10 changed code/test files) rc=$?"
  vt --exclude 'tests/integration/**' > "$E/unit.log" 2>&1; rec "unit (full, venv python) rc=$? $(counts "$E/unit.log")"
  strip < "$E/unit.log" | grep -E '^ (❯|×) tests/' | sed 's/^/  unit-fail: /' | tee -a "$S"
  vt tests/format.test.ts tests/b1a-successor-lib.test.ts tests/deploy-release.test.ts tests/deploy-web-unit.test.ts tests/catalogue-lookups.test.ts \
    tests/brownlow-season-artefact.test.ts tests/v2-season-seal.test.ts > "$E/unit-focused.log" 2>&1; rec "unit focused rc=$? $(counts "$E/unit-focused.log")"
  for f in tools/v2/b1a-successor/sitting/*.sh deploy/post-install-check.sh; do bash -n "$f" || rec "bash -n FAIL $f"; done; rec "bash -n done"
}

# suite file | database name | extra env
SUITES=(
  "tests/integration/brownlow-season-attachment.test.ts|afldb_v2_rb_r7r3_attach_test|"
  "tests/integration/admin-brownlow.test.ts|afldb_v2_rb_r7r3_admin_test|"
  "tests/integration/brownlow-pending-coverage.test.ts|afldb_v2_rb_r7r3_pcov_test|"
  "tests/integration/brownlow-pending-projection.test.ts|afldb_v2_rb_r7r3_pproj_test|"
  "tests/integration/brownlow-pending-populated.test.ts|afldb_v2_rb_r7r3_ppop_test|AFLDB_POPULATED_REHEARSAL_STATE=1"
  "tests/integration/b1a-successor.test.ts|afldb_v2_rb_r7r3_b1a_test|"
  "tests/integration/v2-brownlow-eligibility.test.ts|afldb_v2_rb_r7r3_elig_test|"
  "tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts|afldb_v2_brownlow_tristate_twelve_test|"
  "tests/integration/v2-brownlow-production-correction.test.ts|afldb_v2_brownlow_policy_final_test|"
  "tests/integration/settle-afl-api-brownlow.test.ts|afldb_v2_rb_r7r3_settle_test|"
  "tests/integration/settle-afl-api-brownlow-backtest.test.ts|afldb_v2_rb_r7r3_sbt_test|"
  "tests/integration/settle-afl-api-brownlow-reschedule.test.ts|afldb_v2_rb_r7r3_srs_test|"
  "tests/integration/database.test.ts -t Brownlow|afldb_v2_rb_r7r3_dbb_test|"
  "tests/integration/database.test.ts -t AFLDB-ISSUE-36[79]|afldb_v2_rb_r7r3_db367_test|"
)
run_suite() {  # tree label file-args db env
  local tree=$1 lab=$2 args=$3 db=$4 env=$5 log
  log="$E/integ-$lab-$(echo "$args" | sed 's#tests/integration/##; s#[^A-Za-z0-9]#_#g' | cut -c1-60).log"
  fresh "$db" > /dev/null
  # shellcheck disable=SC2086
  IR run "$db" -- env $env bash -c "cd $tree && node node_modules/vitest/vitest.mjs run $args" > "$log" 2>&1; local rc=$?
  echo "$rc|$log"
}
phase_integ() {
  local failed=()
  for s in "${SUITES[@]}"; do
    IFS='|' read -r args db env <<< "$s"
    out=$(run_suite "$C" cand "$args" "$db" "$env"); rc=${out%%|*}; log=${out#*|}
    rec "integ cand rc=$rc [$args] db=$db $(counts "$log")"
    strip < "$log" | grep -E '^ +(×|↓) ' | head -12 | sed 's/^/    /' | tee -a "$S"
    [ "$rc" = 0 ] || failed+=("$s")
  done
  for s in "${failed[@]}"; do
    IFS='|' read -r args db env <<< "$s"; f=${args%% *}
    [ -f "$BASE/$f" ] || { rec "classify: $f absent at a3c8c67c (new suite)"; continue; }
    out=$(run_suite "$BASE" base "$args" "$db" "$env"); rc=${out%%|*}; log=${out#*|}
    rec "integ BASE a3c8c67c rc=$rc [$args] $(counts "$log")"
    strip < "$log" | grep -E '^ +× ' | head -12 | sed 's/^/    /' | tee -a "$S"
  done
}

APP=afldb_v2_rb_r7r3app_test; UNF=afldb_v2_rb_r7r3unf_test
phase_build() {
  fresh "$APP" > /dev/null
  rm -rf .next
  IR run "$APP" -- env AFLDB_ENV=production AFLDB_BASE_URL=http://127.0.0.1:${E2E_PORT:-3110} AFLDB_SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" \
    bash -c 'npm run build' > "$E/build.log" 2>&1; rec "build rc=$? BUILD_ID $(cat .next/standalone/.next/BUILD_ID 2>/dev/null)"
}
clear_rendered() {  # rendered output only, never route modules
  find .next/standalone/.next/server/app -type f -not -path '*/admin/*' \( -name '*.html' -o -name '*.rsc' -o -name '*.meta' -o -name '*.body' -o -path '*.segments/*' \) \
    \( -path '*/seasons/202[67]*' -o -path '*/players/*' \) -print -delete | wc -l
  [ -f .next/standalone/.next/server/app/players/\[slug\]/page.js ] || { rec "STOP route module missing"; return 1; }
}
# Repaired 2026-11-21 after the DEV incident (DEV-QUALIFICATION.md note 3). Port 3100 belongs to DEV's afldb.service and is never
# used or touched. Each run starts CAND's own server on the private loopback port E2E_PORT, in its OWN process group (setsid), and
# points Playwright at it through AFLDB_E2E_BASE_URL, so Playwright starts no webServer of its own. Teardown signals only that group.
# A port this harness did not take is a STOP: nothing is killed by port, and there is no fuser.
E2E_PORT=${E2E_PORT:-3110}
listening() { ss -ltnH "sport = :$1" | grep -q .; }
e2e_run() {  # db label grep
  listening "$E2E_PORT" && { rec "STOP port $E2E_PORT is held by a process this harness did not launch; nothing killed"; return 1; }
  rec "ISR cleared $(clear_rendered) file(s) before e2e $2"
  local secret sp rc i; secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
  setsid node --import tsx tools/v2/isolated-pg.ts run "$1" -- env AFLDB_ENV=production AFLDB_BASE_URL=http://127.0.0.1:$E2E_PORT \
    AFLDB_SESSION_SECRET="$secret" NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$E2E_PORT node .next/standalone/server.js \
    > "$E/e2e-$2-server.log" 2>&1 < /dev/null &
  sp=$!
  [ "$(ps -o pgid= -p "$sp" | tr -d ' ')" = "$sp" ] || { kill "$sp"; rec "STOP e2e server is not its own process group"; return 1; }
  for i in $(seq 1 60); do curl -sf -o /dev/null -m 5 "http://127.0.0.1:$E2E_PORT/api/health" && break; sleep 1; done
  rec "e2e $2: CAND server, own process group $sp, 127.0.0.1:$E2E_PORT health $(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$E2E_PORT/api/health)"
  IR run "$1" -- env AFLDB_ENV=production AFLDB_E2E_BASE_URL=http://127.0.0.1:$E2E_PORT AFLDB_BASE_URL=http://127.0.0.1:$E2E_PORT \
    AFLDB_SESSION_SECRET="$secret" node node_modules/@playwright/test/cli.js test tests/e2e/journeys.spec.ts ${3:+-g "$3"} --reporter=list \
    > "$E/e2e-$2.log" 2>&1
  rc=$?
  kill -TERM -- "-$sp" 2>/dev/null; for i in $(seq 1 20); do kill -0 -- "-$sp" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$sp" 2>/dev/null; wait "$sp" 2>/dev/null
  listening "$E2E_PORT" && rec "WARN port $E2E_PORT still held after stopping group $sp; left untouched" || rec "e2e $2: server group $sp stopped"
  rec "e2e $2 rc=$rc $(strip < "$E/e2e-$2.log" | grep -E '^ +[0-9]+ (passed|failed|skipped|flaky)' | tr -s ' ' | tr '\n' ';')"
  strip < "$E/e2e-$2.log" | grep -E '^ +(✓|✘|-) |^ +[0-9]+\) ' | head -40 | sed 's/^/    /' | tee -a "$S"
}
phase_e2e() {
  cat > "$W/season-state.sql" <<'SQL'
SELECT 'state', year, status FROM seasons WHERE year IN (2026, 2027) ORDER BY 2;
SELECT 'gawn2026', p.slug || '-' || p.id, s.brownlow_status FROM players p JOIN player_season_stats s ON s.player_id = p.id AND s.season = 2026 WHERE p.slug = 'max-gawn';
SQL
  IR run "$APP" -- bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -A -F "|" -t -f "$0"' "$W/season-state.sql" 2>&1 | grep -v '^isolated-pg' | sed 's/^/  complete-copy: /' | tee -a "$S"
  e2e_run "$APP" complete-pending "pending Brownlow"
  # Synthetic UNFINISHED season: the same rebuild with 2026 switched to in_progress (disposable copy only).
  fresh "$UNF" > /dev/null
  IR run "$UNF" -- bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -c "UPDATE seasons SET status = '"'"'in_progress'"'"', completed_at = NULL WHERE year = 2026"' 2>&1 | grep -v '^isolated-pg'
  IR run "$UNF" -- bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -A -F "|" -t -f "$0"' "$W/season-state.sql" 2>&1 | grep -v '^isolated-pg' | sed 's/^/  unfinished-copy: /' | tee -a "$S"
  e2e_run "$UNF" unfinished-synthetic "pending Brownlow"
  e2e_run "$APP" full-journeys-file ""
}

for p in "$@"; do "phase_$p"; done
rec "PHASES-DONE $*"
