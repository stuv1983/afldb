#!/usr/bin/env bash
# remediation run 4, scope `qual`, P4: dedicated clones and tools at Q'' in $W/cand.
#   bash $W/in/clones.sh <phase...>
#   phases: bl_fetch bl_tmpl bl_b2 bl_b1 od5 cole ct mnew
# bl_*  : the two name-pinned Brownlow suites on their dedicated clones (recipe of run3/integ/brownlow-clones.sh; the retained artefacts are copied from the run-3
#         integb workspace's hash-verified copy, never from /home/arm; database names exactly afldb_v2_brownlow_tristate_twelve_test / afldb_v2_brownlow_policy_final_test)
# od5   : settle-afl-api on afldb_v2_rb_*_test-named clones (rebuild base and snapshot base)
# cole  : v2-coleman-publication on its schema-only base (create-db WITHOUT a template, normal migration runner, privileges)
# ct    : the ISSUE-238 rehearsal tool end to end, every implemented case/variant, a fresh code_test_db per case (this cluster only, port 55687)
# mnew  : the fixup F-FX-1 mutation (2026 Brownlow loaded) with club-comparison at Q''
set -u -o pipefail
export LC_ALL=C
umask 077
. "$(dirname "$0")/common.sh"
umask 077
EVD=$CAND/$REPO_EVD
B=$W/brownlow; X=$B/in; FR=$B/fixture/fixture-root; PGBIN=$AFLDB_V2_PG_BIN
BSRC=/mnt/ssd/afldb-rem3-integb-20261114/brownlow/in         # run-3 integb workspace: READ ONLY (copy only)
TPL=afldb_v2_rem4qual_bl2025_tmpl_test
CL=$W/evidence/clones; mkdir -p "$CL"
B2=afldb_v2_brownlow_tristate_twelve_test
B1=afldb_v2_brownlow_policy_final_test
vt_json() { echo "$1"; }

phase_bl_fetch() {
  [ ! -e "$X/SHA256SUMS" ] || { echo "already fetched"; return 1; }
  mkdir -p "$X" "$B/fixture" "$B/acq"
  for f in afldb_v2_rb_brownlow2025_test.dump fixture-root.tar acquisition-014218.tar SHA256SUMS template-identity.txt identity.sql; do cp -p "$BSRC/$f" "$X/" || return 1; done
  ( cd "$X" && sha256sum -c SHA256SUMS ) 2>&1 | tee "$CL/brownlow-fetch.log"
  ( cd "$X" && sha256sum -c --quiet SHA256SUMS ) || { echo "export hashes"; return 3; }
  grep -F '5be45eab11549a206f3a8c444f0e4481c807e4f30f3145c851d9e7847623ba4b  afldb_v2_rb_brownlow2025_test.dump' "$X/SHA256SUMS" >/dev/null || { echo "dump hash is not the exported/documented one"; return 3; }
  grep -F '23cc8b76bbab21897aa9fcbd41573bd77166ad82ce53d3e36dbfc3130f37ce23  fixture-root.tar' "$X/SHA256SUMS" >/dev/null || { echo "fixture-root.tar hash is not the documented one"; return 3; }
  grep -F '3ed1b46b16673ea1dcff0fdfba253243fd10d1cf54029523a45b91de453aa3b1  acquisition-014218.tar' "$X/SHA256SUMS" >/dev/null || { echo "acquisition tar hash is not the documented one"; return 3; }
  [ "$(stat -c %s "$X/afldb_v2_rb_brownlow2025_test.dump")" = 29920966 ] || { echo "dump size is not 29,920,966"; return 3; }
  for t in fixture-root acquisition-014218; do
    if tar -tf "$X/$t.tar" | grep -E '^/|\.\.|\\' >/dev/null; then echo "unsafe member path in $t.tar"; return 3; fi
  done
  tar -xf "$X/fixture-root.tar" -C "$B/fixture"; tar -xf "$X/acquisition-014218.tar" -C "$B/acq"
  diff -r "$FR/data/sources/afl_api/brownlow/afl-api-brownlow-2025-2026-10-20-014218" "$B/acq/afl-api-brownlow-2025-2026-10-20-014218" >/dev/null \
    && echo "fixture acquisition == retained acquisition (byte-identical)" || { echo "acquisition differs"; return 3; }
  ( cd "$FR" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$CL/fixture-root.sha256"
  chmod -R a-w "$B/fixture" "$B/acq"
  echo "fetch: done (fixture files $(wc -l < "$CL/fixture-root.sha256"))"
}

phase_bl_tmpl() {
  ( cd "$X" && sha256sum -c --quiet SHA256SUMS ) || { echo "export hashes"; return 3; }
  IR create-db "$TPL" 2>&1 | strip | tail -1
  "$PGBIN/pg_restore" -l "$X/afldb_v2_rb_brownlow2025_test.dump" > "$CL/template.toc"
  grep -vE ' (EXTENSION|COMMENT) - (EXTENSION )?(pg_trgm|unaccent)( |$)' "$CL/template.toc" > "$CL/template.uselist"
  echo "toc entries $(grep -cv '^;' "$CL/template.toc"); excluded $(( $(grep -cv '^;' "$CL/template.toc") - $(grep -cv '^;' "$CL/template.uselist") ))"
  (
    export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=afldb_v2_super PGDATABASE=$TPL PGCONNECT_TIMEOUT=5
    PGPASSWORD=$(cat "$AFLDB_V2_PG_ROOT/secrets/superuser.pw"); export PGPASSWORD
    flock "$LOCK" "$PGBIN/pg_restore" --exit-on-error --use-list "$CL/template.uselist" -d "$TPL" "$X/afldb_v2_rb_brownlow2025_test.dump"; echo "pg_restore exit $?"
    "$PGBIN/vacuumdb" --analyze-only --quiet -d "$TPL"; echo "analyze exit $?"
    PGOPTIONS='-c default_transaction_read_only=on' "$PGBIN/psql" -X -A -t -v ON_ERROR_STOP=1 -f "$X/identity.sql" > "$CL/template-identity.restored.txt"
    echo "identity query exit $?"
  ) 2>&1 | tee -a "$CL/brownlow.log"
  diff "$X/template-identity.txt" "$CL/template-identity.restored.txt" && say "restored template identity == exported template identity" || { say "template identity differs"; return 5; }
  IR verify "$TPL" 2>&1 | strip | tail -2
}

bl_clone() { # <db>
  local db=$1
  IR create-db "$db" --template "$TPL" 2>&1 | strip | tail -1
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test --status > "$CL/$db-status-before.log" 2>&1; strip < "$CL/$db-status-before.log" | tail -4
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test > "$CL/$db-migrate.log" 2>&1 || { strip < "$CL/$db-migrate.log" | tail; return 6; }
  strip < "$CL/$db-migrate.log" | grep -E 'appl|Nothing' | tail -5
  IR run "$db" -- node --import tsx tools/db/privileges.ts --target test > "$CL/$db-privileges.log" 2>&1 || return 6
  say "clone $db ready (migrations via the normal runner, then privileges)"
}
bl_run() { # <db> <label> <timeout> <file> [ENV=...]
  local db=$1 label=$2 to=$3 file=$4; shift 4
  say "run $label db=$db file=$file"
  (cd "$CAND" && flock "$LOCK" timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$db" -- /usr/bin/env "$@" node node_modules/vitest/vitest.mjs run --no-cache "$file" \
     --reporter=default --reporter=json --outputFile.json="$CL/$label.json" > "$CL/$label.log" 2>&1); local rc=$?
  say "run $label rc=$rc: $(strip < "$CL/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  node "$VF" "$CL/$label.json" "$CAND" > "$CL/$label-failures.tsv" 2>/dev/null; echo "$label failing ids: $(wc -l < "$CL/$label-failures.tsv")"
}
VF=$EVD/run4/baseline/scripts/vfail.js

phase_bl_b2() { bl_clone "$B2" || return 1; bl_run "$B2" b2-eligibility-2025 3000 tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts; }
phase_bl_b1() { bl_clone "$B1" || return 1; bl_run "$B1" b1-production-correction 5400 tests/integration/v2-brownlow-production-correction.test.ts AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT="$FR"; }

phase_od5() {
  # settle-afl-api whole file, shared mode, on afldb_v2_rb_*_test-named clones (the OD-5 reinstatement case is name-pinned). Rebuild base and snapshot base.
  for pair in "rb:$TRBB" "snap:$TSNAP"; do
    local tag=${pair%%:*} tmpl=${pair#*:} db=afldb_v2_rb_rem4qod5${pair%%:*}_test
    mkcopy "$db" "$tmpl"
    tcounts "$db" "$CL/od5-$tag-before.table-counts.tsv" > /dev/null
    (cd "$CAND" && timeout 2400 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api.test.ts \
       --reporter=default --reporter=json --outputFile.json="$CL/od5-$tag.json" > "$CL/od5-$tag.log" 2>&1); local rc=$?
    say "od5 $tag db=$db rc=$rc: $(strip < "$CL/od5-$tag.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
    node "$VF" "$CL/od5-$tag.json" "$CAND" > "$CL/od5-$tag-failures.tsv"; echo "od5-$tag failing ids: $(wc -l < "$CL/od5-$tag-failures.tsv")"
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const f of j.testResults)for(const a of f.assertionResults||[])if(/OD-5/.test(a.fullName))console.log(a.status+"  "+a.fullName)' "$CL/od5-$tag.json"
    tcounts "$db" "$CL/od5-$tag-after.table-counts.tsv" > /dev/null
    diff "$CL/od5-$tag-before.table-counts.tsv" "$CL/od5-$tag-after.table-counts.tsv" > "$CL/od5-$tag.table-counts.diff" && echo "od5-$tag: table counts unchanged" || { echo "od5-$tag: table counts CHANGED"; cat "$CL/od5-$tag.table-counts.diff"; }
    dropdb "$db"
  done
}

phase_cole() {
  local S=afldb_v2_rem4qual_cs_test
  IR create-db "$S" 2>&1 | strip | tail -1
  IR run "$S" -- node --import tsx tools/db/migrate.ts --target test > "$CL/coleschema-migrate.log" 2>&1 || { echo "migrate failed"; return 1; }
  strip < "$CL/coleschema-migrate.log" | tail -3
  IR run "$S" -- node --import tsx tools/db/privileges.ts --target test > "$CL/coleschema-privileges.log" 2>&1 || { echo "privileges failed"; return 1; }
  (cd "$CAND" && timeout 1800 node --import tsx tools/v2/isolated-pg.ts run "$S" -- node node_modules/vitest/vitest.mjs run tests/integration/v2-coleman-publication.test.ts \
     --reporter=default --reporter=json --outputFile.json="$CL/coleman-schema-only.json" > "$CL/coleman-schema-only.log" 2>&1); local rc=$?
  say "coleman schema-only rc=$rc: $(strip < "$CL/coleman-schema-only.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  node "$VF" "$CL/coleman-schema-only.json" "$CAND" > "$CL/coleman-schema-only-failures.tsv"; echo "coleman failing ids: $(wc -l < "$CL/coleman-schema-only-failures.tsv")"
  dropdb "$S"
}

# ---- the ISSUE-238 rehearsal tool ----
CT=$CL/ct-rsc; CTDB=code_test_db; CTENV=afldb_v2_rem4qual_ctenv_test
SUPW_FILE=$AFLDB_V2_PG_ROOT/secrets/superuser.pw
ct_super() { # <sql...>  (cluster superuser, THIS cluster only: asserted)
  [ "$AFLDB_V2_PG_ROOT" = "$W-pg" ] && [ "$AFLDB_V2_PG_PORT" = 55687 ] || { echo "refusing: not my cluster"; return 9; }
  PGPASSWORD=$(cat "$SUPW_FILE") PGCONNECT_TIMEOUT=5 "$PGBIN/psql" -X -q -h 127.0.0.1 -p 55687 -U afldb_v2_super -d postgres -v ON_ERROR_STOP=1 "$@"
}
ct_case() { # <label> <react-server 0|1> <case> [variant]
  local label=$1 rsc=$2 cs=$3 var=${4:-}
  ct_super -c "DROP DATABASE IF EXISTS $CTDB WITH (FORCE)" -c "CREATE DATABASE $CTDB OWNER afldb_owner TEMPLATE $TRB" -c "COMMENT ON DATABASE $CTDB IS 'afldb-v2-isolated-test'" > "$CT/$label.mk" 2>&1 || { echo "$label: database creation failed"; cat "$CT/$label.mk"; return 9; }
  local args="run --case $cs"; [ -n "$var" ] && args="$args --variant $var"; args="$args --acknowledge $CTDB"
  local cond=""; [ "$rsc" = 1 ] && cond="--conditions=react-server"
  local t0; t0=$(date +%s)
  (cd "$CAND" && timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$CTENV" -- bash -c '
      for v in AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL AFLDB_TEST_AUTH_DATABASE_URL DATABASE_URL AFLDB_IMPORT_DATABASE_URL AFLDB_AUTH_DATABASE_URL AFLDB_OWNER_DATABASE_URL AFLDB_BACKUP_DATABASE_URL; do
        eval "val=\${$v}"; export "$v=${val%/*}/'"$CTDB"'"
      done
      export AFLDB_CODE_TEST_DATABASE_URL=$AFLDB_OWNER_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL=$AFLDB_IMPORT_DATABASE_URL
      exec node node_modules/tsx/dist/cli.mjs '"$cond"' tools/db/afl-api-identity-correction-rehearsal.ts '"$args"'
    ' 2>&1 | strip > "$CT/$label.log"); local rc=$?
  local el=$(( $(date +%s) - t0 ))
  local last; last=$(grep -a -E 'Slice 10 (rehearsal, )?case [0-9]+.*checks PASS' "$CT/$label.log" | tail -1 | sed 's/.*Slice 10 //')
  local verdict=FAIL; echo "$last" | grep -F -- '-> PASS' >/dev/null && verdict=PASS
  printf '%s	rc=%s	%ss	rsc=%s	%s
' "$label" "$rc" "$el" "$rsc" "${last:-no summary line}" | tee -a "$CT/summary.tsv"
  ct_super -c "DROP DATABASE IF EXISTS $CTDB WITH (FORCE)" > /dev/null 2>&1
  return 0
}

phase_ct() {
  mkdir -p "$CT"; : > "$CT/summary.tsv"
  IR create-db "$CTENV" 2>&1 | strip | tail -1          # only supplies the marked-environment DSNs (rewritten to code_test_db inside the child)
  # case list = the 84 implemented cases/variants of the brownlow scope's run (run4/brownlow/raw/ct-tip1/summary.tsv), react-server flag from its rsc column
  local LIST=$EVD/run4/brownlow/raw/ct-tip1/summary.tsv
  [ -f "$LIST" ] || { echo "case list missing"; return 1; }
  local n=0
  while IFS=$'\t' read -r name _rc _t rscf _rest; do
    case "$name" in c[0-9]*) ;; *) continue ;; esac
    local rsc=${rscf#rsc=}; local spec=${name#c}; local cs=${spec%%-*} var=""
    [ "$spec" != "$cs" ] && var=${spec#*-}
    [ "$rsc" = 1 ] || continue; n=$((n+1))
    ct_case "$name" "$rsc" "$cs" "$var" || return 1
  done < "$LIST"
  echo "cases attempted: $n"
  echo "summary: PASS=$(grep -c -- '-> PASS$' "$CT/summary.tsv") FAIL=$(grep -c -- '-> FAIL$' "$CT/summary.tsv")"
  dropdb "$CTENV"
}

# ---- F-FX-1 mutation ----
LOADED="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026"
mrun() { # <label> <tmpl> <preseed|-> <vitest -t pattern|->
  local label=$1 tmpl=$2 seed=$3 pat=$4 db=afldb_v2_rem4qual_${1}_test
  mkcopy "$db" "$tmpl"
  tcounts "$db" "$CL/$label-before.table-counts.tsv" > /dev/null
  [ "$seed" = - ] || { QW "$db" "$seed" | tee "$CL/$label-preseed.txt"; }
  Q "$db" "SELECT '$label 2026 brownlow_season_votes='||(SELECT count(*) FROM brownlow_season_votes WHERE season=2026)||' season_total='||(SELECT coverage::text FROM stat_availability WHERE stat_key='brownlow_season_total' AND season=2026)" | tee "$CL/$label-state.txt"
  local targs=(); [ "$pat" = - ] || targs=(-t "$pat")
  (cd "$CAND" && timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/club-comparison.test.ts "${targs[@]}" \
     --reporter=default --reporter=json --outputFile.json="$CL/$label.json" > "$CL/$label.log" 2>&1); local rc=$?
  say "$label rc=$rc: $(strip < "$CL/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  node "$VF" "$CL/$label.json" "$CAND" > "$CL/$label-failures.tsv"; echo "$label failing ids: $(wc -l < "$CL/$label-failures.tsv")"; cut -f1,2,3 "$CL/$label-failures.tsv" | cut -c1-260
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const f of j.testResults)for(const a of f.assertionResults||[])if(/selected-season Brownlow coverage/.test(a.fullName))console.log("SUMMARY-TEST "+a.status+"  "+a.fullName)' "$CL/$label.json"
  tcounts "$db" "$CL/$label-after.table-counts.tsv" > /dev/null
  diff "$CL/$label-before.table-counts.tsv" "$CL/$label-after.table-counts.tsv" > "$CL/$label.table-counts.diff" && echo "$label: table counts unchanged by the run" || echo "$label: table counts changed ($(grep -c '^>' "$CL/$label.table-counts.diff") rows)"
  dropdb "$db"   # scratch copy dropped
}
phase_mnew() {
  local T='exposes selected-season Brownlow coverage'
  mrun mctlrb "$TRB" - "$T"
  mrun mctlsnap "$TSNAP" - "$T"
  mrun mnew "$TRB" "$LOADED" "$T"
  mrun mnewsnap "$TSNAP" "$LOADED" "$T"
  mrun mnewfile "$TRB" "$LOADED" -
  mrun mnewfilesnap "$TSNAP" "$LOADED" -
}

phase_ct_rsc() { phase_ct; }
# F-FX-1 supplementary: 2026 Brownlow "loaded" REALISTICALLY, i.e. one 3-vote row per club that played in 2026, attributed to a real 2026 player of that club
# (the specified mutation's single club_id NULL row cannot give any club a vote total).
REAL="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, s.player_id, s.club_id, 3 FROM (SELECT DISTINCT ON (pms.club_id) pms.player_id, pms.club_id FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id WHERE m.season = 2026 ORDER BY pms.club_id, pms.player_id) s; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026"
phase_mreal() {
  local T='exposes selected-season Brownlow coverage'
  mrun mrealrb "$TRB" "$REAL" "$T"
  mrun mrealsnap "$TSNAP" "$REAL" "$T"
  mrun mrealfile "$TRB" "$REAL" -
  mrun mrealfilesnap "$TSNAP" "$REAL" -
}


phase_stop() {
  IR stop; sleep 2
  echo "listeners on $PORT: $(ss -ltnH | awk '{print $4}' | grep -cE ":$PORT$")"
  echo "processes under $W (excluding this check): $(pgrep -u arm -af "$W" | grep -v pgrep | grep -v "clones.sh" | wc -l)"
}

run_phases "$CAND" "$@"
