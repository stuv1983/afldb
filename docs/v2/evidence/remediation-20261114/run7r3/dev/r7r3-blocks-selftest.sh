#!/usr/bin/env bash
# Release 7R3: DEV self-test of the 7R3 data and page blocks, run UNCHANGED (only their documented R7R3_* overrides) against a disposable
# copy of the 18 Nov production dump brought to production's current state (B1a: 2026 player seasons pending). streamanator only; no
# production contact. Sequence = the production sequence: A1 before -> P10 pending -> D1 dump (pg_dump of the copy) + D1v on a brand-new
# cluster -> D2 target/plan -> D3 dry -> D4 commit -> A1 attached -> P10 pending (fresh render) -> R1 reverse-dry -> publish with the
# REAL Super Admin writer and the proposed D-370-1 list -> A1 published -> P10 published (fresh render) -> A3 browser function in
# headless Chromium -> R1 reverse-dry after publication (must refuse already_published).
#   bash r7r3-blocks-selftest.sh            (workspace /mnt/ssd/afldb-r7r3-20261121; dump cluster /mnt/ssd/afldb-bv2026-20261121/pg-rst)
set -uo pipefail; export LC_ALL=C; umask 077
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH NEXT_TELEMETRY_DISABLED=1
BW=/mnt/ssd/afldb-r7r3-20261121; B=$BW/blk; BL=$BW/run7r3/sitting; DV=$BW/run7r3/dev; E=$BW/evidence/blocks; mkdir -p "$E"
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-bv2026-20261121/pg-rst AFLDB_V2_PG_PORT=61468 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
T=afldb_v2_r7r3blk_test; S=$E/SUMMARY.txt; : > "$S"; PORT=3371
INELIG_IDS=6841,5480,13246,6667,11041,3295,6746,12205,12869,4004,10282,940,1108,3292
INELIG_SLUGS=jason-horne-francis-6841,harley-reid-5480,zac-bailey-13246,jacob-van-rooyen-6667,riley-thilthorpe-11041,darcy-fogarty-3295,james-sicily-6746,taylor-walker-12205,tristan-xerri-12869,dylan-moore-4004,paul-curtis-10282,bailey-humphrey-940,ben-long-1108,darcy-byrne-jones-3292
rec() { echo "$*" | tee -a "$S"; }
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
cd "$B"; IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
R() { IR run "$T" -- "$@"; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ); DATA=$BW/blk-data-$STAMP; mkdir -m 700 "$DATA"
rec "== 7R3 block self-test $STAMP host=$(hostname) blk=$(git rev-parse HEAD) blocks: $(cd "$BW/run7r3" && sha256sum sitting/*.sh sitting/*.js dev/*.sh | cut -c1-12 | tr '\n' ' ')"
IR list 2>&1 | grep -q "$T" && IR drop-db "$T" --acknowledge-destroy "$T" > /dev/null 2>&1
IR create-db "$T" --template afldb_v2_bv2026_before_test 2>&1 | tail -1 | tee -a "$S"
# Block env file (0600): the copy's DSNs in the production variable names, a random session secret, the beta gate on.
SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
R bash -c 'printf "PORT=%s\nAFLDB_SESSION_SECRET=%s\nAFLDB_BETA_GATE=on\nAFLDB_BETA_EPOCH=1\nAFLDB_BACKUP_DATABASE_URL=%s\nAFLDB_IMPORT_DATABASE_URL=%s\n" "$1" "$2" "$AFLDB_TEST_DATABASE_URL" "$AFLDB_TEST_IMPORT_DATABASE_URL" > "$3"' _ "$PORT" "$SECRET" "$DATA/blk.env" 2>/dev/null
chmod 600 "$DATA/blk.env"
IDC=$(R bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -XAtq -c "SELECT current_database(), d.oid, c.system_identifier FROM pg_database d, pg_control_system() c WHERE d.datname = current_database()"' 2>/dev/null | grep -v '^isolated-pg')
ACT=$(R bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -XAtq -c "SELECT min(id) FROM auth_users WHERE role = '"'"'super_admin'"'"' AND disabled_at IS NULL"' 2>/dev/null | grep -v '^isolated-pg')
rec "copy identity $IDC; actor <first active super-admin id of the copy>"
cat > "$DATA/a3.mjs" <<'JS'
import { readFileSync } from 'node:fs'; import { createHmac } from 'node:crypto';
const pw = await import(process.env.BLK + '/node_modules/@playwright/test/index.js'); const chromium = pw.chromium ?? pw.default.chromium;
const [base, fnFile, mode, list] = process.argv.slice(2);
let src = readFileSync(fnFile, 'utf8').replace("const MODE = 'published';", `const MODE = '${mode}';`)
  .replace(/const INELIGIBLE = \[\];[^\n]*/, `const INELIGIBLE = ${JSON.stringify(list ? list.split(',') : [])};`);
const p = Buffer.from(JSON.stringify({ v: 1, kind: 'beta', sub: 'r7r3-a3', exp: Math.floor(Date.now() / 1000) + 900, epoch: 1 }));
const value = p.toString('base64url') + '.' + createHmac('sha256', process.env.AFLDB_SESSION_SECRET).update(p).digest().toString('base64url');
const browser = await chromium.launch(); const ctx = await browser.newContext();
await ctx.addCookies([{ name: 'afldb_beta', value, url: base }]);
const page = await ctx.newPage(); await page.goto(base + '/players/scott-pendlebury-11724');
const out = JSON.parse(await page.evaluate(`(${src})()`)); await browser.close();
for (const [k, v] of Object.entries(out.checks)) console.log(`A3 CHECK ${k} ${v.ok ? 'PASS' : 'FAIL ' + JSON.stringify(v.detail).slice(0, 200)}`);
console.log(`A3 RESULT ${out.mode} ${out.pass ? 'PASS' : 'FAIL'}`);
JS
OV="R7R3_CHECKOUT=$B R7R3_ENV_FILE=$DATA/blk.env R7R3_DATA=$DATA R7R3_IDENTITY=$IDC"
blk() { local f=$1; shift; env $OV bash "$BL/$f" "$@" 2>&1 | strip; }

export AFLDB_SESSION_SECRET=$SECRET AFLDB_BETA_GATE=on AFLDB_BETA_EPOCH=1 AFLDB_ENV=production AFLDB_BASE_URL=http://127.0.0.1:$PORT
if [ ! -f .next/standalone/server.js ] || [ "$(cat .next/r7r3-built-for 2>/dev/null)" != "$(git rev-parse HEAD)" ]; then
  rec "== build (blk clone, prerender from the pending copy)"; R npm run build > "$E/build.log" 2>&1; rec "build rc=$? BUILD_ID $(cat .next/standalone/.next/BUILD_ID)"
  git rev-parse HEAD > .next/r7r3-built-for
fi
clear_isr() { find .next/standalone/.next/server/app -type f -not -path '*/admin/*' \( -name '*.html' -o -name '*.rsc' -o -name '*.meta' -o -name '*.body' -o -path '*.segments/*' \) \
  \( -path '*/seasons/202[56]*' -o -path '*/brownlow*' -o -path '*/matches/*' -o -path '*/players/*' \) -delete
  [ -f '.next/standalone/.next/server/app/players/[slug]/page.js' ] || { rec "STOP route module missing"; exit 1; }; }
SP=
serve() { stop; clear_isr; R env NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$PORT node .next/standalone/server.js > "$E/server-$1.log" 2>&1 &
  SP=$!; for i in $(seq 1 60); do curl -s -o /dev/null -m 5 "http://127.0.0.1:$PORT/api/health" && break; sleep 2; done; }
stop() { [ -n "$SP" ] && { pkill -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null; }; fuser -k $PORT/tcp > /dev/null 2>&1; SP=; }
show() { tee -a "$E/$1.log" | grep -E "$2" | cut -c1-260 | tee -a "$S"; }

rec "== A1 before";             blk r7r3-a1-facts.sh "$STAMP" before | show a1-before '^(PASS|FAIL|A1 RESULT|STOP)'
serve pending1; rec "== P10 pending (unattached)"; R7R3_CHECKOUT=$B R7R3_ENV_FILE=$DATA/blk.env bash "$BL/r7r3-p10-brownlow.sh" pending 2>&1 | strip | show p10-pending1 '^P10 (CHECK|RESULT)|^STOP'

rec "== D1 stand-in: pg_dump of the copy + parity + facts-before -> D1v on a brand-new cluster"
DD=$BW/blk-d1v-$STAMP; mkdir -m 700 "$DD"
R bash -c 'u=$AFLDB_TEST_DATABASE_URL; PGPASSWORD=$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$u") "$AFLDB_V2_PG_BIN/pg_dump" -Fc --compress=6 --no-owner -h 127.0.0.1 -p "$AFLDB_V2_PG_PORT" -U "$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$u")" -f "$1" "$2"' _ "$DD/afldb_prod-selftest.dump" "$T" 2>&1 | grep -v '^isolated-pg'
R bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -At -c "SELECT '"'"'player_match_stats rows'"'"', count(*) FROM player_match_stats" -c "SELECT '"'"'players rows'"'"', count(*) FROM players" -c "SELECT '"'"'matches rows'"'"', count(*) FROM matches" -c "SELECT '"'"'clubs rows'"'"', count(*) FROM clubs" -c "SELECT '"'"'career games total'"'"', sum(games) FROM player_career_stats" -c "SELECT '"'"'career goals total'"'"', sum(goals) FROM player_career_stats" -c "SELECT '"'"'Brownlow votes total'"'"', sum(votes) FROM brownlow_season_votes" -c "SELECT '"'"'unrecorded disposals'"'"', count(*) FROM player_match_stats WHERE disposals IS NULL" -c "SELECT '"'"'stat_availability rows'"'"', count(*) FROM stat_availability"' 2>/dev/null | grep -v '^isolated-pg' > "$DD/parity-prod.txt"
cp "$DATA/facts-before.txt" "$DD/facts-before.txt"
R7R3_DUMP_DBNAME=$T PORT=61472 CAND=$B bash "$DV/r7r3-dv-restore-verify.sh" "$DD" "$(sha256sum "$DD/afldb_prod-selftest.dump" | cut -c1-64)" "$(stat -c %s "$DD/afldb_prod-selftest.dump")" \
  100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7 2>&1 | strip | show d1v '^(PASS|FAIL|STOP|VERDICT|  (copy|plan|dry))'

rec "== D2 target / plan";      blk r7r3-d2-attach.sh "$STAMP" target | show d-target '^(target|STOP|D RESULT)'
blk r7r3-d2-attach.sh "$STAMP" plan | show d-plan '^(PLAN|plan file|PASS|STOP|D RESULT|REFUSED)'
DIG=$(node -e 'console.log(require(process.argv[1]).digest)' "$DATA/plan-2026.json")
rec "== D3 dry";    blk r7r3-d2-attach.sh "$STAMP" dry "$DIG" "$ACT" | show d-dry '^(APPLY|REFUSED|exit|D RESULT|STOP)'
rec "== D3 wrong digest (the block must refuse before connecting)"; blk r7r3-d2-attach.sh "$STAMP" dry "$(printf '0%.0s' $(seq 64))" "$ACT" | show d-wrong '^(APPLY|REFUSED|exit|D RESULT|STOP)'
rec "== D4 commit"; blk r7r3-d2-attach.sh "$STAMP" commit "$DIG" "$ACT" | show d-commit '^(APPLY|REFUSED|exit|D RESULT|STOP)'
rec "== A1 attached"; blk r7r3-a1-facts.sh "$STAMP" attached | show a1-attached '^(PASS|FAIL|A1 RESULT|STOP)'
serve pending2; rec "== P10 pending (attached, unpublished; fresh render)"; R7R3_CHECKOUT=$B R7R3_ENV_FILE=$DATA/blk.env bash "$BL/r7r3-p10-brownlow.sh" pending 2>&1 | strip | show p10-pending2 '^P10 (CHECK|RESULT)|^STOP'
rec "== A3 browser function, pending"; BLK=$B node "$DATA/a3.mjs" "http://127.0.0.1:$PORT" "$BL/r7r3-a3-browser-checks.js" pending "" 2>&1 | strip | show a3-pending '^A3'
rec "== R1 reverse-dry before publication"; blk r7r3-d2-attach.sh "$STAMP" reverse-dry "$DIG" "$ACT" | show r1-dry '^(REVERSE|REFUSED|exit|D RESULT|STOP)'
rec "== R1 reverse-commit, A1 reversed, then D4 again (a later window re-attaching from the same reviewed plan)"
blk r7r3-d2-attach.sh "$STAMP" reverse-commit "$DIG" "$ACT" | show r1-commit '^(REVERSE|REFUSED|exit|D RESULT|STOP)'
blk r7r3-a1-facts.sh "$STAMP" reversed | show a1-reversed '^(FAIL|A1 RESULT|STOP)'
blk r7r3-d2-attach.sh "$STAMP" commit "$DIG" "$ACT" | show d-recommit '^(APPLY|REFUSED|exit|D RESULT|STOP)'

rec "== owner publication stand-in: the real publishBrownlowSeason with the proposed D-370-1 list ($(echo $INELIG_IDS | tr ',' '\n' | wc -l) ids)"
cat > "$DATA/publish.mts" <<'JS'
const { getBrownlowSeasonOverview, publishBrownlowSeason } = await import(process.env.BLK + '/src/db/queries/admin-brownlow.ts');
const o = await getBrownlowSeasonOverview(2026);
console.log(`OVERVIEW expected=${o.expected} accounted=${o.accounted} unresolved=${o.unresolved} revision=${o.revision} complete=${o.complete}`);
const r = await publishBrownlowSeason({ season: 2026, ineligiblePlayerIds: process.argv[3].split(',').map(Number), expectedRevision: o.revision,
  actorId: Number(process.argv[2]), note: 'DEV self-test publication of 2026 on a disposable copy (release 7R3 blocks)' });
console.log(`PUBLISH ${JSON.stringify(r)}`); process.exit(r.ok ? 0 : 1);
JS
R bash -c 'BLK=$0 DATABASE_URL=$AFLDB_TEST_DATABASE_URL node --import tsx --conditions=react-server "$1" "$2" "$3"' "$B" "$DATA/publish.mts" "$ACT" "$INELIG_IDS" 2>&1 | strip | show publish '^(OVERVIEW|PUBLISH)|rror'
rec "== A1 published"; blk r7r3-a1-facts.sh "$STAMP" published 14 | show a1-published '^(PASS|FAIL|A1 RESULT|STOP)|^bsv2026_ineligible'
serve published; rec "== P10 published (fresh render)"; R7R3_CHECKOUT=$B R7R3_ENV_FILE=$DATA/blk.env bash "$BL/r7r3-p10-brownlow.sh" published "$INELIG_SLUGS" 2>&1 | strip | show p10-published '^P10 (CHECK|RESULT)|^STOP'
rec "== A3 browser function, published (headless Chromium, admitted by a minted beta cookie)"
BLK=$B node "$DATA/a3.mjs" "http://127.0.0.1:$PORT" "$BL/r7r3-a3-browser-checks.js" published "$INELIG_SLUGS" 2>&1 | strip | show a3-published '^A3'
rec "== R1 reverse-dry AFTER publication (must refuse already_published)"; blk r7r3-d2-attach.sh "$STAMP" reverse-dry "$DIG" "$ACT" | show r1-after '^(REVERSE|REFUSED|exit|D RESULT|STOP)'
stop
grep -ciE 'error|unhandled' "$E"/server-*.log | sed 's/^/server log error|unhandled: /' | tee -a "$S"
rec "SELFTEST-COMPLETE (data dir $DATA and $DD hold production-derived data: 0700, removed after the record is written)"
