#!/usr/bin/env bash
# Run 5 / T-2 affected-scope qualification of awards-reload-links at the new executable revision.
# Workspace /mnt/ssd/afldb-rem5-t2-20261115 (new, run-owned). Reuses the run-4 coleman276 cluster (port 55684) and
# its two read-only templates (rb = accepted rebuild, sn = 4 Nov snapshot); every run is on a FRESH --template copy,
# dropped afterwards. The cluster is stopped at the end (it was stopped at the start). Nothing else is touched.
# Usage: bash t2-qual.sh <phase...>   phases: checkout static start red pf_rb pf_sn sh_rb sh_sn stop
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem5-t2-20261115
NEW=${NEW:-96573534dd6ef08c97d8ce1d0b8053dfc07d9a5b}
OLD=7088f2a19d3d0e7a75dd295aaed925c27e074613
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
RBT=afldb_v2_rem4coleman276_rbtmpl_test
SNT=afldb_v2_rem4coleman276_sntmpl_test
EV=$W/ev
mkdir -p "$EV"
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
FILE=tests/integration/awards-reload-links.test.ts

cat > "$W/state.sql" <<'SQL'
\pset pager off
\pset tuples_only on
\pset format unaligned
SELECT table_schema || '.' || table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables
 WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'staging')
 ORDER BY table_schema, table_name;
SELECT 'coleman.family=' || count(*) || ':' || coalesce(md5(string_agg(to_jsonb(w)::text, '|' ORDER BY w.id)), '-')
  FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman';
SELECT 'coleman.span=' || first_season || '-' || last_season FROM awards WHERE slug = 'coleman';
SELECT 'award_winners.all=' || count(*) || ':' || md5(string_agg(to_jsonb(w)::text, '|' ORDER BY w.id)) FROM award_winners w;
SELECT t || '=' || fp FROM (
  SELECT 'award_nominations.content' AS t, md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fp FROM award_nominations x
  UNION ALL SELECT 'hall_of_fame.content', md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM hall_of_fame x
  UNION ALL SELECT 'honour_team_members.content', md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM honour_team_members x
  UNION ALL SELECT 'captaincies.content', md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM captaincies x
  UNION ALL SELECT 'awards.content', md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM awards x) z;
SELECT 'awards.spans=' || md5(string_agg(id || ':' || coalesce(first_season::text, '-') || '-' || coalesce(last_season::text, '-'), ',' ORDER BY id)) FROM awards;
SQL

state() { # <db> <out>
  (cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts run "$1" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/state.sql") 2>&1 | strip | grep -v '^isolated-pg:' > "$2"
}

phase_checkout() {
  [ -d "$W/cand" ] && { echo "cand exists"; return 1; }
  git clone -q /mnt/ssd/afldb-rem4-coleman276-20261115/cand "$W/cand" || return 1
  cd "$W/cand" || return 1
  git fetch -q /mnt/ssd/afldb-rem4-base/base-Q3.bundle "claude/rem4-fixloop-20261115:refs/heads/q3base" || return 1
  git fetch -q "$W/t2.bundle" "claude/remediation-20261114:refs/heads/t2" || return 1
  git checkout -q t2 || return 1
  [ "$(git rev-parse HEAD)" = "$NEW" ] || { echo "HEAD != NEW"; return 1; }
  git diff --name-only "$OLD" HEAD
  npm ci --no-audit --no-fund 2>&1 | tail -3
  [ -e .env ] && { echo ".env present"; return 1; }
  echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
}
phase_fetch() {
  cd "$W/cand" || return 1
  git fetch -q "$W/t2b.bundle" "claude/remediation-20261114:refs/heads/t2b" || return 1
  git checkout -q t2b || return 1
  [ "$(git rev-parse HEAD)" = "$NEW" ] || { echo "HEAD != NEW"; return 1; }
  git diff --name-only 96573534dd6ef08c97d8ce1d0b8053dfc07d9a5b HEAD
  echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
}
phase_static() {
  cd "$W/cand" || return 1
  npm run typecheck > "$EV/typecheck.log" 2>&1; echo "typecheck rc=$?"
  npm run lint:gate > "$EV/lint-gate.log" 2>&1; echo "lint:gate rc=$?"; tail -5 "$EV/lint-gate.log" | strip
  node node_modules/eslint/bin/eslint.js "$FILE" > "$EV/eslint-file.log" 2>&1; echo "eslint(file) rc=$?"; tail -3 "$EV/eslint-file.log"
}
phase_start() {
  IR status 2>&1 | strip | tail -2
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null; sleep 3
  IR status 2>&1 | strip | tail -2
  ss -ltn | grep ":55684 "
}
phase_stop() {
  IR stop 2>&1 | strip | tail -2
  ss -ltn | grep ":55684 " || echo "port 55684 closed"
}
# one per-file run on a fresh copy: <label> <tmpl>
pf() {
  local label=$1 tmpl=$2 db="afldb_v2_rem5t2_$1_test" ev="$EV/$1"; mkdir -p "$ev"
  IR create-db "$db" --template "$tmpl" 2>&1 | strip | tail -1
  (cd "$W/cand" && env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
     AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
     timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$FILE") > "$ev/vitest-raw.log" 2>&1
  echo "vitest rc=$?"; strip < "$ev/vitest-raw.log" > "$ev/vitest.log"
  grep -E "Tests |Test Files|FAIL|Error:|×" "$ev/vitest.log" | head -20
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
}
# one shared run on a fresh copy, then full state diff against the untouched template: <label> <tmpl> [checkout]
sh_run() {
  local label=$1 tmpl=$2 rev=${3:-$NEW} db="afldb_v2_rem5t2_$1_test" ev="$EV/$1"; mkdir -p "$ev"
  (cd "$W/cand" && git checkout -q "$rev" && echo "checkout $(git rev-parse HEAD)")
  IR create-db "$db" --template "$tmpl" 2>&1 | strip | tail -1
  (cd "$W/cand" && timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$FILE") > "$ev/vitest-raw.log" 2>&1
  echo "vitest rc=$?"; strip < "$ev/vitest-raw.log" > "$ev/vitest.log"
  grep -E "Tests |Test Files|FAIL|Error:|×" "$ev/vitest.log" | head -20
  state "$db" "$ev/state-after.txt"; state "$tmpl" "$ev/state-template.txt"
  diff "$ev/state-template.txt" "$ev/state-after.txt" > "$ev/state.diff"
  echo "state diff lines: $(grep -c '^[<>]' "$ev/state.diff")"; cat "$ev/state.diff" | head -20
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
  (cd "$W/cand" && git checkout -q "$NEW" && echo "back at $(git rev-parse HEAD)")
}
phase_red()   { sh_run red_sn "$SNT" "$OLD"; }
phase_pf_rb() { pf pf_rb "$RBT"; }
phase_pf_sn() { pf pf_sn "$SNT"; }
phase_sh_rb() { sh_run sh_rb "$RBT"; }
phase_sh_sn() { sh_run sh_sn "$SNT"; }

for ph in "$@"; do
  echo "=== $ph $(date -u +%T)"
  "phase_$ph" 2>&1 | strip | tee -a "$EV/$ph.log"
  rc=${PIPESTATUS[0]}
  echo "=== $ph rc=$rc $(date -u +%T)"
done
echo "=== ALL-DONE $(date -u +%T)"
