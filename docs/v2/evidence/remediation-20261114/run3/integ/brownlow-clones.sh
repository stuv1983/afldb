#!/usr/bin/env bash
# ISSUE-363 run 3, scope `integ`: the two name-pinned Brownlow suites on their dedicated clones, built ONLY from the documented
# recipe and the retained, hash-verified artefacts (no network, no hand edits):
#   recipe:    /home/arm/afldb-v2-brownlowverify-20261028/xfer/brownlow.sh and docs/v2/gap006-release-readiness-2026-11-01.md
#              ("Authentic Brownlow inputs"), docs/v2/linux-verification-2026-10-28.md section 2
#   artefacts: /home/arm/afldb-v2-brownlowverify-20261028/xfer/{afldb_v2_rb_brownlow2025_test.dump, fixture-root.tar,
#              acquisition-014218.tar, SHA256SUMS, template-identity.txt} (read-only copy into this scope's workspace)
# The suites are `v2-brownlow-eligibility-2025-rehearsal` (afldb_v2_brownlow_tristate_twelve_test) and
# `v2-brownlow-production-correction` (afldb_v2_brownlow_policy_final_test, AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT). They model the
# AUTHENTIC 2025 archive (ledger 115 template: 330,383 round votes, player 12446, 207 vote sets), so the recipe cannot use the
# rebuilt base. Each clone = template + the normal migration runner (116, 117 and, at this checkout, 118) + privileges.
#
#   brownlow-clones.sh fetch                      copy + verify + extract the artefacts into $WS/brownlow
#   brownlow-clones.sh tmpl                       restore the template (verified against the exported identity)
#   brownlow-clones.sh clone <db>                 fresh clone of the template, migrations, privileges
#   brownlow-clones.sh run <db> <label> [timeout] run the suite that pins <db> (shared mode, JSON to evidence)
#   brownlow-clones.sh all <evidence-dir>         fetch (if needed), tmpl (if needed), both clones, both suites
set -uo pipefail
export LC_ALL=C
umask 077
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
WS="${WS:-/mnt/ssd/afldb-rem3-integ-20261114}"
PORT="${AFLDB_V2_PG_PORT:-55673}"
case "$PORT" in 5432|55432|55651|55660) echo "forbidden port $PORT" >&2; exit 2 ;; esac
export AFLDB_V2_PG_ROOT="$WS-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT="$PORT"
CAND="$WS/cand"; B="$WS/brownlow"; X="$B/in"; LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
case "${1:-}" in all) E="${2:-$WS/evidence}/brownlow" ;; *) E="$WS/evidence/brownlow" ;; esac
PGBIN=$AFLDB_V2_PG_BIN
SRC=/home/arm/afldb-v2-brownlowverify-20261028
TPL=afldb_v2_rem3integ_bl2025_tmpl_test
FR=$B/fixture/fixture-root
mkdir -p "$E"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E/brownlow.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }

do_fetch() {
  [ -f "$X/SHA256SUMS" ] && { say "fetch: already present"; return 0; }
  mkdir -p "$X" "$B/fixture" "$B/acq"
  for f in afldb_v2_rb_brownlow2025_test.dump fixture-root.tar acquisition-014218.tar SHA256SUMS template-identity.txt; do cp -p "$SRC/xfer/$f" "$X/"; done
  cp "$SRC/identity.sql" "$X/"
  ( cd "$X" && sha256sum -c SHA256SUMS ) >> "$E/brownlow.log" 2>&1 || { say "export hashes"; return 3; }
  for t in fixture-root acquisition-014218; do
    if tar -tf "$X/$t.tar" | grep -E '^/|\.\.|\\' >/dev/null; then say "unsafe member path in $t.tar"; return 3; fi
  done
  tar -xf "$X/fixture-root.tar" -C "$B/fixture"; tar -xf "$X/acquisition-014218.tar" -C "$B/acq"
  diff -r "$FR/data/sources/afl_api/brownlow/afl-api-brownlow-2025-2026-10-20-014218" "$B/acq/afl-api-brownlow-2025-2026-10-20-014218" >/dev/null \
    && say "fixture acquisition == retained acquisition (byte-identical)" || { say "acquisition differs"; return 3; }
  ( cd "$FR" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$B/fixture-root.sha256"
  chmod -R a-w "$B/fixture" "$B/acq"
  say "fetch: done (fixture files $(wc -l < "$B/fixture-root.sha256"))"
}
do_tmpl() {
  ( cd "$X" && sha256sum -c SHA256SUMS ) >> "$E/brownlow.log" 2>&1 || { say "export hashes"; return 3; }
  grep '^5be45eab11549a206f3a8c444f0e4481c807e4f30f3145c851d9e7847623ba4b  afldb_v2_rb_brownlow2025_test.dump$' "$X/SHA256SUMS" >/dev/null || { say "dump hash is not the exported one"; return 3; }
  IR create-db "$TPL" 2>&1 | strip | tail -1
  "$PGBIN/pg_restore" -l "$X/afldb_v2_rb_brownlow2025_test.dump" > "$E/template.toc"
  grep -vE ' (EXTENSION|COMMENT) - (EXTENSION )?(pg_trgm|unaccent)( |$)' "$E/template.toc" > "$E/template.uselist"
  say "toc entries $(grep -cv '^;' "$E/template.toc"); excluded $(( $(grep -cv '^;' "$E/template.toc") - $(grep -cv '^;' "$E/template.uselist") ))"
  (
    export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=afldb_v2_super PGDATABASE=$TPL PGCONNECT_TIMEOUT=5
    PGPASSWORD=$(cat "$AFLDB_V2_PG_ROOT/secrets/superuser.pw"); export PGPASSWORD
    flock "$LOCK" "$PGBIN/pg_restore" --exit-on-error --use-list "$E/template.uselist" -d "$TPL" "$X/afldb_v2_rb_brownlow2025_test.dump"; echo "pg_restore exit $?"
    "$PGBIN/vacuumdb" --analyze-only --quiet -d "$TPL"; echo "analyze exit $?"
    PGOPTIONS='-c default_transaction_read_only=on' "$PGBIN/psql" -X -A -t -v ON_ERROR_STOP=1 -f "$X/identity.sql" > "$E/template-identity.restored.txt"
    echo "identity query exit $?"
  ) 2>&1 | tee -a "$E/brownlow.log"
  diff "$X/template-identity.txt" "$E/template-identity.restored.txt" && say "restored template identity == exported template identity" || { say "template identity differs"; return 5; }
  IR verify "$TPL" 2>&1 | strip | tail -2
}
do_clone() {
  local db=$1
  IR create-db "$db" --template "$TPL" 2>&1 | strip | tail -1
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test --status > "$E/$db-status-before.log" 2>&1; strip < "$E/$db-status-before.log" | tail -4
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test > "$E/$db-migrate.log" 2>&1 || { strip < "$E/$db-migrate.log" | tail; return 6; }
  strip < "$E/$db-migrate.log" | grep -E 'appl|Nothing' | tail -5
  IR run "$db" -- node --import tsx tools/db/privileges.ts --target test > "$E/$db-privileges.log" 2>&1 || return 6
  say "clone $db ready (migrations via the normal runner, then privileges)"
}
do_run() {
  local db=$1 label=$2 to=${3:-5400} file=tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts
  local envs=()
  case "$db" in
    afldb_v2_brownlow_policy_final_test) file=tests/integration/v2-brownlow-production-correction.test.ts; envs=(AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT="$FR") ;;
  esac
  say "run $label db=$db file=$file"
  (cd "$CAND" && flock "$LOCK" timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$db" -- /usr/bin/env "${envs[@]}" node node_modules/vitest/vitest.mjs run --no-cache "$file" \
     --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1); local rc=$?
  say "run $label rc=$rc: $(strip < "$E/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
}

case "${1:-}" in
  fetch) do_fetch ;;
  tmpl) do_tmpl ;;
  clone) do_clone "$2" ;;
  run) do_run "$2" "$3" "${4:-5400}" ;;
  all)
    do_fetch || exit $?
    if IR list 2>/dev/null | grep -F "$TPL" >/dev/null; then say "template $TPL already restored on this cluster: reused"; else do_tmpl || exit $?; fi
    do_clone afldb_v2_brownlow_tristate_twelve_test || exit $?
    do_run afldb_v2_brownlow_tristate_twelve_test b2-eligibility-2025 3000
    do_clone afldb_v2_brownlow_policy_final_test || exit $?
    do_run afldb_v2_brownlow_policy_final_test b1-production-correction 5400
    # the named clones are kept (they are the evidence); drop them deliberately with isolated-pg drop-db when finished
    ;;
  *) echo "usage: brownlow-clones.sh fetch|tmpl|clone <db>|run <db> <label> [timeout]|all <evidence-dir>" >&2; exit 2 ;;
esac
