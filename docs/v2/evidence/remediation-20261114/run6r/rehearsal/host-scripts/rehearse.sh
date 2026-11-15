#!/usr/bin/env bash
# Packet 6R: rehearse the corrected B1a runner, the acceptance probe and the guarded reversal on fresh disposable copies of the
# 4 Nov snapshot template (2026 Brownlow state equal to production's as B0 read it), plus targeted static qualification of the runner.
# Uses the run-5 candidate checkout (f6af6da9; src/ identical to a2e6ea99) with the three artifacts as UNTRACKED copies, removed at the
# end; the run-4 coleman276 isolated cluster (port 55684), stopped at the end. Every copy is created from the template and dropped.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem6r-b1a-20261116
C=/mnt/ssd/afldb-rem5-t2-20261115/cand
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
TPL=afldb_v2_rem4coleman276_sntmpl_test
D=docs/v2/evidence/remediation-20261114/run6r/b1a
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
cd "$C" || exit 1
echo "=== packet 6R B1a rehearsal $(date -u +%FT%TZ) host=$(hostname) node=$(node -v) psql=$(psql --version | cut -d' ' -f3)"
echo "checkout HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
[ -e "$D" ] && { echo "artifact dir already present in the checkout: refusing"; exit 1; }
mkdir -p "$D" && cp "$W/in/b1a-repair-2026-r6r.mts" "$W/in/b1a-accept-r6r.sql" "$W/in/b1a-reverse-r6r.sql" "$D/"
echo "--- artifact sha256 (as executed)"; (cd "$D" && sha256sum b1a-repair-2026-r6r.mts b1a-accept-r6r.sql b1a-reverse-r6r.sql)
echo "--- src imported by the runner, identical to the published candidate?"; sha256sum src/db/queries/brownlow-readiness.ts
echo "=== static qualification of the runner (repo typecheck and lint exclude docs/**/evidence)"
cat > tsconfig.b1a-r6r.json <<'J'
{ "extends": "./tsconfig.json", "compilerOptions": { "incremental": false },
  "include": ["docs/v2/evidence/remediation-20261114/run6r/b1a/b1a-repair-2026-r6r.mts"], "exclude": ["node_modules"] }
J
npx tsc -p tsconfig.b1a-r6r.json --noEmit 2>&1 | tail -20; echo "tsc (strict, repo compilerOptions) rc=${PIPESTATUS[0]}"
npx eslint --no-ignore --max-warnings 0 "$D/b1a-repair-2026-r6r.mts" 2>&1 | tail -20; echo "eslint (repo config, ignores lifted) rc=${PIPESTATUS[0]}"
rm -f tsconfig.b1a-r6r.json
echo "=== cluster"
ss -ltn | grep -q ":55684 " || { IR start > "$W/ev/pg-start.out" 2>&1 < /dev/null; sleep 3; }
IR status 2>&1 | strip | tail -1
for c in exact identity mixed missing additional swap cov-partial cov-na medal conc-timeout conc-mixed conc-blocked conc-twin; do
  db="afldb_v2_rem6r_${c//-/_}_test"
  echo; echo "##### case $c $(date -u +%T)"
  IR create-db "$db" --template "$TPL" 2>&1 | strip | tail -1
  IR run "$db" -- bash "$W/case.sh" "$c" "$db" 2>&1 | strip | grep -v '^isolated-pg:'
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
done
rm -f "$D"/b1a-repair-2026-r6r.mts "$D"/b1a-accept-r6r.sql "$D"/b1a-reverse-r6r.sql; rmdir -p "$D" 2>/dev/null
echo; echo "checkout porcelain after cleanup: $(git status --porcelain | wc -l)"
IR stop 2>&1 | strip | tail -1
ss -ltn | grep ":55684 " || echo "port 55684 closed"
echo "=== DONE $(date -u +%FT%TZ)"
