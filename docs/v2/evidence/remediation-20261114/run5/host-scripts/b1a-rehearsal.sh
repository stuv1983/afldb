#!/usr/bin/env bash
# Run 5: rehearse the B1a runner, unmodified, on fresh disposable copies of the run-4 templates (sn = 4 Nov snapshot, rb = accepted rebuild)
# at the new executable revision. Starts the run-4 coleman276 cluster (port 55684) and stops it again. Nothing else is touched.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem5-t2-20261115
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
R=docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
cd "$W/cand" || exit 1
mkdir -p "$W/ev/b1a" "$(dirname "$R")"
[ -e "$R" ] && { echo "runner already present in the checkout: refusing"; exit 1; }
cp "$W/b1a-repair-2026.mts" "$R"   # untracked copy of the uploaded runner (byte-identical; removed at the end)
echo "HEAD=$(git rev-parse HEAD) runner sha256=$(sha256sum "$R" | cut -d' ' -f1) uploaded=$(sha256sum "$W/b1a-repair-2026.mts" | cut -d' ' -f1)"
ss -ltn | grep -q ":55684 " || { IR start > "$W/ev/b1a/pg-start.out" 2>&1 < /dev/null; sleep 3; }; IR status 2>&1 | strip | tail -1
run() { # <db> <args...>
  local db=$1; shift
  node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'env | grep -o "^AFLDB_TEST[A-Z_]*DATABASE_URL" | sort | tr "\n" " "; echo; node --import tsx '"$R"' "$@"; echo "exit=$?"' _ "$@" 2>&1 | strip | grep -v "^isolated-pg:"
}
for base in sn rb; do
  db="afldb_v2_rem5t2_b1a_${base}_test"
  IR create-db "$db" --template "afldb_v2_rem4coleman276_${base}tmpl_test" 2>&1 | strip | tail -1
  echo "--- $base: dry run"
  run "$db" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$db" --expect-rows 669
  echo "--- $base: wrong expected row count (must roll back, exit 1)"
  run "$db" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$db" --expect-rows 668
  echo "--- $base: wrong database name (must refuse, exit 1)"
  run "$db" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-rows 669
  echo "--- $base: --commit on the disposable copy"
  run "$db" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$db" --expect-rows 669 --commit
  echo "--- $base: re-run after commit (expect NOTHING-TO-REPAIR)"
  run "$db" --dsn-env AFLDB_TEST_IMPORT_DATABASE_URL --expect-db "$db" --expect-rows 669
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
done
rm -f "$R"; rmdir -p "$(dirname "$R")" 2>/dev/null; echo "porcelain after cleanup: $(git status --porcelain | wc -l)"
IR stop 2>&1 | strip | tail -1
ss -ltn | grep ":55684 " || echo "port 55684 closed"
