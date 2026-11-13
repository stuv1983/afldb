#!/usr/bin/env bash
# P-1: prove the rebuild target BEFORE anything runs, then run the isolated rebuild's preflight (which precedes any destruction).
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
set -u -o pipefail
cd "$CAND" || exit 1
DBN=afldb_v2_rb_rempins_test
VP=/home/arm/i250/afldb/.venv/bin/python
unset DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_IMPORT_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL 2>/dev/null
[ -e "$CAND/.env" ] && { echo "REFUSE: .env present in checkout"; exit 1; }
echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
IR status | tail -3
IR create-db "$DBN" || exit 1
cat > "$CAND/.target-facts.mjs" <<'EOF'
const show = (name) => { const u = new URL(process.env[name]); return `${name}: host=${u.hostname} port=${u.port} database=${decodeURIComponent(u.pathname.slice(1))}`; };
const names = ['AFLDB_TEST_DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL'];
let ok = true;
for (const n of names) {
  if (!process.env[n]) { console.log(`${n}: NOT SET`); ok = false; continue; }
  console.log(show(n));
  const u = new URL(process.env[n]);
  if (u.hostname !== '127.0.0.1' || u.port !== '55611' || decodeURIComponent(u.pathname.slice(1)) !== process.env.EXPECT_DB) ok = false;
}
console.log(`AFLDB_V2_ISOLATED_PG=${process.env.AFLDB_V2_ISOLATED_PG} AFLDB_V2_ISOLATED_PORT=${process.env.AFLDB_V2_ISOLATED_PORT}`);
if (process.env.AFLDB_V2_ISOLATED_PORT !== '55611' || process.env.AFLDB_V2_ISOLATED_PG !== '1') ok = false;
console.log(ok ? 'TARGET PROVEN: 127.0.0.1:55611 ' + process.env.EXPECT_DB : 'TARGET NOT PROVEN');
process.exit(ok ? 0 : 3);
EOF
EXPECT_DB=$DBN RUNDB "$DBN" env EXPECT_DB=$DBN node .target-facts.mjs 2>&1 | strip
rc=${PIPESTATUS[0]}
rm -f "$CAND/.target-facts.mjs"
[ "$rc" = 0 ] || { echo "target not proven: stop"; exit 1; }
export AFLDB_PYTHON=$VP AFLDB_REBUILD_CAPTURE_ROOT=$W/capture
mkdir -p "$W/capture"
echo "=== --plan (prints the resolved target; nothing executed)"
RUNDB "$DBN" node --import tsx tools/db/rebuild-test.ts --target isolated --acknowledge-destroy "$DBN" --plan 2>&1 | strip | head -20
echo "=== preflight (runs before any destruction; a failure refuses with 'Nothing has been destroyed')"
flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 bash -c '. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh; cd $CAND; export AFLDB_PYTHON='"$VP"' AFLDB_REBUILD_CAPTURE_ROOT=$W/capture; RUNDB '"$DBN"' node --import tsx tools/db/rebuild-test.ts --target isolated --acknowledge-destroy '"$DBN"'' > "$EV/rebuild-run.log" 2>&1
echo "rebuild rc=$?"
strip < "$EV/rebuild-run.log" | head -60 | cut -c1-300
