#!/usr/bin/env bash
# rem3-integ phase A: the two dedicated-clone Brownlow suites, built ONLY from the documented recipe
# (retained /home/arm/afldb-v2-brownlowverify-20261028/xfer/brownlow.sh, docs/v2/gap006-release-readiness-2026-11-01.md section
# "Authentic Brownlow inputs") and the retained, hash-verified artefacts copied read-only into $W/brownlow/in.
# usage: brownlow.sh tmpl | clone <db> | run <db> <label> | stop-none
set -uo pipefail
export LC_ALL=C
umask 077
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem3-integ-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55673
CAND="$W/cand"; B="$W/brownlow"; X="$B/in"; E="$W/evidence/brownlow"; LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
PGBIN=$AFLDB_V2_PG_BIN
TPL=afldb_v2_rem3integ_bl2025_tmpl_test
FR=$B/fixture/fixture-root
mkdir -p "$E"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E/brownlow.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }

case "$1" in
tmpl)
  ( cd "$X" && sha256sum -c SHA256SUMS ) >> "$E/brownlow.log" 2>&1 || { say "export hashes"; exit 3; }
  grep '^5be45eab11549a206f3a8c444f0e4481c807e4f30f3145c851d9e7847623ba4b  afldb_v2_rb_brownlow2025_test.dump$' "$X/SHA256SUMS" >/dev/null || { say "dump hash"; exit 3; }
  IR create-db "$TPL" 2>&1 | strip | tail -1
  "$PGBIN/pg_restore" -l "$X/afldb_v2_rb_brownlow2025_test.dump" > "$E/template.toc"
  grep -vE ' (EXTENSION|COMMENT) - (EXTENSION )?(pg_trgm|unaccent)( |$)' "$E/template.toc" > "$E/template.uselist"
  say "toc entries $(grep -cv '^;' "$E/template.toc"); excluded $(( $(grep -cv '^;' "$E/template.toc") - $(grep -cv '^;' "$E/template.uselist") ))"
  (
    export PGHOST=127.0.0.1 PGPORT=55673 PGUSER=afldb_v2_super PGDATABASE=$TPL PGCONNECT_TIMEOUT=5
    PGPASSWORD=$(cat "$AFLDB_V2_PG_ROOT/secrets/superuser.pw"); export PGPASSWORD
    flock "$LOCK" "$PGBIN/pg_restore" --exit-on-error --use-list "$E/template.uselist" -d "$TPL" "$X/afldb_v2_rb_brownlow2025_test.dump"; echo "pg_restore exit $?"
    "$PGBIN/vacuumdb" --analyze-only --quiet -d "$TPL"; echo "analyze exit $?"
    PGOPTIONS='-c default_transaction_read_only=on' "$PGBIN/psql" -X -A -t -v ON_ERROR_STOP=1 -f "$X/identity.sql" > "$E/template-identity.restored.txt"
    echo "identity query exit $?"
  ) 2>&1 | tee -a "$E/brownlow.log"
  diff "$X/template-identity.txt" "$E/template-identity.restored.txt" && say "restored template identity == exported template identity" || { say "template identity differs"; exit 5; }
  IR verify "$TPL" 2>&1 | strip | tail -2
  ;;
clone)
  db=$2
  IR create-db "$db" --template "$TPL" 2>&1 | strip | tail -1 || exit 6
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test --status > "$E/$db-status-before.log" 2>&1; strip < "$E/$db-status-before.log" | tail -4
  IR run "$db" -- node --import tsx tools/db/migrate.ts --target test > "$E/$db-migrate.log" 2>&1 || { strip < "$E/$db-migrate.log" | tail; exit 6; }
  strip < "$E/$db-migrate.log" | grep -E 'appl|Nothing' | tail -5
  IR run "$db" -- node --import tsx tools/db/privileges.ts --target test > "$E/$db-privileges.log" 2>&1 || exit 6
  say "clone $db ready (migrations via the normal runner, then privileges)"
  ;;
run)
  db=$2; label=$3; to=${4:-4000}; extra=("${@:5}")
  file=tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts
  envs=()
  case "$db" in
    afldb_v2_brownlow_policy_final_test) file=tests/integration/v2-brownlow-production-correction.test.ts; envs=(AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT="$FR") ;;
  esac
  say "run $label db=$db file=$file"
  (cd "$CAND" && flock "$LOCK" timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$db" -- /usr/bin/env "${envs[@]}" node node_modules/vitest/vitest.mjs run --no-cache "$file" \
     --reporter=default --reporter=json --outputFile.json="$E/$label.json" > "$E/$label.log" 2>&1); rc=$?
  say "run $label rc=$rc: $(strip < "$E/$label.log" | grep -a -E 'Test Files|Tests ' | tr '\n' ' ')"
  ;;
esac
