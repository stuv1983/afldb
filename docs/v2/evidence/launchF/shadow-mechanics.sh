#!/usr/bin/env bash
# V2 Launch F: shadow-rehearsal MECHANICS on a synthetic shadow copy (the locally rebuilt history,
# reversed to the pre-V2 schema). Isolated cluster only. NOT production parity: no production backup.
set -euo pipefail
cd /d/dev/afldbV2
export AFLDB_V2_PG_ROOT=/d/tmp/afldb-v2-pg16
S=D:/dev/afldbV2/docs/v2/evidence/launchF
BIN=D:/tmp/afldb-v2-pg16/dist/pgsql/bin
E=D:/tmp/afldb-v2-shadow-evidence
mkdir -p "$E"
DB=afldb_v2_shadow_test
ISO="npx tsx tools/v2/isolated-pg.ts"
TSX="node node_modules/tsx/dist/cli.mjs"
in_db() { $ISO run $DB -- "$@"; }
psqlq() { in_db node "$S/pgtool.mjs" "$BIN/psql.exe" "$@"; }
SEASONS=$(psqlq -At -c "SELECT string_agg(DISTINCT season::text, ' ') FROM staging.afl_api_brownlow_vote WHERE family = 'brownlow_match_votes'" 2>/dev/null || true)

captures() { # $1 = before|after
  in_db $TSX tools/v2/shadow-guard.ts check --require AFLDB_TEST_DATABASE_URL | tail -1
  in_db $TSX tools/v2/historical-manifest.ts produce --dsn-env AFLDB_TEST_DATABASE_URL --out "$E/$1.manifest.json" | tail -1
  in_db $TSX tools/v2/shadow-capture.ts row-counts --dsn-env AFLDB_TEST_DATABASE_URL --out "$E/$1.row-counts.json" | tail -1
  in_db $TSX --conditions=react-server tools/v2/shadow-award-reports.ts coleman --dsn-env AFLDB_TEST_DATABASE_URL \
    --from 1980 --through 2025 --settled --out "$E/$1.coleman.json" | tail -1
  for s in $SEASONS; do
    in_db $TSX --conditions=react-server tools/v2/shadow-award-reports.ts brownlow --dsn-env AFLDB_TEST_DATABASE_URL \
      --season "$s" --out "$E/$1.brownlow-$s.json" | tail -1
  done
  $TSX tools/v2/shadow-parity.ts coverage-export --out "$E/$1.coverage.json" | tail -1
}

echo "== S-A1/A2: the copy (synthetic: afldb_v2_hist_test), reversed to the pre-V2 schema"
$ISO drop-db $DB --acknowledge-destroy $DB 2>/dev/null | tail -1 || true
$ISO create-db $DB --template afldb_v2_hist_test | tail -1
psqlq -f docs/v2/rollback-111-114.sql
echo "brownlow seasons staged: ${SEASONS:-<none>}"; 
SEASONS=$(psqlq -At -c "SELECT string_agg(DISTINCT season::text, ' ') FROM staging.afl_api_brownlow_vote WHERE family = 'brownlow_match_votes'")
echo "brownlow seasons staged: ${SEASONS:-<none>}"; SEASONS=${SEASONS:-2025}

echo "== BEFORE captures"
captures before

echo "== S-A3: V2 schema (111-114 pending, apply, privileges)"
in_db $TSX tools/db/migrate.ts --target test --status | grep -E "PENDING|pending\.$" || true
in_db $TSX tools/db/migrate.ts --target test | tail -1
in_db $TSX tools/db/privileges.ts --target test | tail -1

echo "== AFTER captures and the parity verdict"
captures after
B=(); A=()
for s in $SEASONS; do B+=(--brownlow-before "$E/before.brownlow-$s.json"); A+=(--brownlow-after "$E/after.brownlow-$s.json"); done
set +e
$TSX tools/v2/shadow-parity.ts compare --manifest-before "$E/before.manifest.json" --manifest-after "$E/after.manifest.json" \
  --row-counts-before "$E/before.row-counts.json" --row-counts-after "$E/after.row-counts.json" \
  --coleman-before "$E/before.coleman.json" --coleman-after "$E/after.coleman.json" "${B[@]}" "${A[@]}" \
  --coverage-before "$E/before.coverage.json" --coverage-after "$E/after.coverage.json" \
  --out "$E/parity.json" --summary "$E/parity.txt"
echo "parity exit $?"
cat "$E/parity.txt"
