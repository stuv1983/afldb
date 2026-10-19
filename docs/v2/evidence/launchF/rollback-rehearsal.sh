#!/usr/bin/env bash
# V2 Launch F: isolated rehearsal of the migration 111-114 forward / reversal / re-forward cycle.
# Runs only through tools/v2/isolated-pg.ts run (loopback cluster afldb_v2_isolated); no other target.
set -euo pipefail
cd /d/dev/afldbV2
export AFLDB_V2_PG_ROOT=/d/tmp/afldb-v2-pg16
BIN=D:/tmp/afldb-v2-pg16/dist/pgsql/bin
E=D:/tmp/afldb-v2-rollback-evidence
mkdir -p "$E"
ISO="npx tsx tools/v2/isolated-pg.ts run"
TSX="node node_modules/tsx/dist/cli.mjs"
in_db() { local db=$1; shift; $ISO "$db" -- "$@"; }
psqlq() { in_db "$1" node "D:/dev/afldbV2/docs/v2/evidence/launchF/pgtool.cjs" "$BIN/psql.exe" "${@:2}"; }
dump() { in_db "$1" node "D:/dev/afldbV2/docs/v2/evidence/launchF/pgtool.cjs" "$BIN/pg_dump.exe" -s --no-owner "${@:3}" -f "$2"; }

for d in afldb_v2_rbk_test afldb_v2_rbkbase_test; do npx tsx tools/v2/isolated-pg.ts drop-db $d --acknowledge-destroy $d | tail -1; npx tsx tools/v2/isolated-pg.ts create-db $d | tail -1; done
echo "== A: forward 001-114 from an EMPTY database with the runner, then privileges"
in_db afldb_v2_rbk_test $TSX tools/db/migrate.ts --target test | tail -3
in_db afldb_v2_rbk_test $TSX tools/db/privileges.ts --target test | tail -2
dump afldb_v2_rbk_test "$E/a114.sql"
dump afldb_v2_rbk_test "$E/a114.noacl.sql" --no-privileges --exclude-schema=afldb_meta

echo "== B: baseline 001-110 applied file by file (the pre-V2 schema)"
for f in $(ls src/db/migrations/*.sql | sort); do
  n=$(basename "$f" | cut -c1-3)
  [ "$((10#$n))" -le 110 ] || continue
  psqlq afldb_v2_rbkbase_test -1 -f "$f" >/dev/null
done
dump afldb_v2_rbkbase_test "$E/b110.noacl.sql" --no-privileges --exclude-schema=afldb_meta

echo "== A: exports, then the reversal (docs/v2/rollback-runbook.md section 5, 111-114)"
psqlq afldb_v2_rbk_test -c "\copy (SELECT * FROM award_proposals ORDER BY id) TO '$E/v2-award_proposals.csv' WITH (FORMAT csv, HEADER)" \
  -c "\copy (SELECT * FROM award_proposal_decisions ORDER BY id) TO '$E/v2-award_proposal_decisions.csv' WITH (FORMAT csv, HEADER)" \
  -c "\copy (SELECT * FROM derived_award_results ORDER BY id) TO '$E/v2-derived_award_results.csv' WITH (FORMAT csv, HEADER)" \
  -c "\copy (SELECT * FROM brownlow_eligibility_decisions ORDER BY id) TO '$E/v2-brownlow_eligibility_decisions.csv' WITH (FORMAT csv, HEADER)" \
  -c "\copy (SELECT * FROM derived_award_projections ORDER BY id) TO '$E/v2-derived_award_projections.csv' WITH (FORMAT csv, HEADER)"
psqlq afldb_v2_rbk_test -f docs/v2/rollback-111-114.sql
psqlq afldb_v2_rbk_test -At -c "SELECT 'R5 tables: ' || concat_ws(',', to_regclass('public.award_proposals'), to_regclass('public.award_proposal_decisions'), to_regclass('public.derived_award_results'), to_regclass('public.brownlow_eligibility_decisions'), to_regclass('public.derived_award_projections'))" \
  -c "SELECT 'R5 ledger rows: ' || count(*) FROM afldb_meta.schema_migrations WHERE name ~ '^11[1-4]_'"
dump afldb_v2_rbk_test "$E/a-rolled.noacl.sql" --no-privileges --exclude-schema=afldb_meta
norm() { grep -Ev '^.(un)?restrict ' "$1"; }
if diff -q <(norm "$E/b110.noacl.sql") <(norm "$E/a-rolled.noacl.sql") >/dev/null; then echo "ROLLED-BACK SCHEMA == PRE-V2 (001-110) SCHEMA: identical"; else echo "ROLLED-BACK SCHEMA DIFFERS"; diff <(norm "$E/b110.noacl.sql") <(norm "$E/a-rolled.noacl.sql") | head -40; fi

echo "== A: re-forward after the reversal (runner status, apply, privileges)"
in_db afldb_v2_rbk_test $TSX tools/db/migrate.ts --target test --status | grep -E "pending|PENDING" | head -6 || true
in_db afldb_v2_rbk_test $TSX tools/db/migrate.ts --target test | tail -3
in_db afldb_v2_rbk_test $TSX tools/db/privileges.ts --target test | tail -2
dump afldb_v2_rbk_test "$E/a-reforward.sql"
if diff -q <(norm "$E/a114.sql") <(norm "$E/a-reforward.sql") >/dev/null; then echo "RE-FORWARD SCHEMA+GRANTS == FIRST FORWARD: identical"; else echo "RE-FORWARD DIFFERS"; diff <(norm "$E/a114.sql") <(norm "$E/a-reforward.sql") | head -40; fi
sha256sum "$E"/*.sql
