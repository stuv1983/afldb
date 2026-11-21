#!/usr/bin/env bash
# ISSUE-363 (2026-11-21) host setup on the DEV host: run-owned workspace, own isolated cluster (port 61490), two read-only
# templates: rb = the ACCEPTED source-only rebuild dump, sn = the populated 4 Nov snapshot dump (production-shaped data,
# already on this host; nothing is fetched). Every test run later uses a FRESH --template copy, dropped afterwards.
#   bash setup.sh <phase>...   phases: checkout cluster rb sn templates fetch
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-i363-20261121; C=$W/cand; EV=$W/ev; mkdir -p "$W" "$EV"
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61490 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python
RB_DUMP=/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
RB_RESTORE=/mnt/ssd/afldb-rem3-base/rebuilt/restore-dump.mjs
SN_DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SN_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SN_BYTES=30141895
SN_RESTORE=/mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs
RBT=afldb_v2_i363_rbtpl_test; SNT=afldb_v2_i363_sntpl_test
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }

phase_checkout() {
  [ -d "$C" ] && { echo "cand exists"; return 1; }
  git clone -q "$W/i363.bundle" "$C" -b claude/issue-363-20261121 || return 1
  cd "$C" || return 1
  echo "HEAD=$(git rev-parse HEAD)"
  npm ci --no-audit --no-fund > "$EV/npm-ci.log" 2>&1; echo "npm ci rc=$?"
  [ -e .env ] && { echo ".env present"; return 1; }
  /home/arm/projects/afldb/.venv/bin/python -c 'import psycopg,sys;print(sys.version.split()[0],"psycopg",psycopg.__version__)'
  echo "porcelain=$(git status --porcelain | wc -l)"
}
phase_fetch() {  # bring the checkout to the newest bundle tip
  cd "$C" || return 1
  git fetch -q "$W/i363.bundle" "claude/issue-363-20261121:refs/remotes/b/tip" || return 1
  git checkout -q --detach refs/remotes/b/tip || return 1
  echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
}
phase_cluster() {
  ss -ltnH "sport = :61490" | grep -q . && { echo "STOP port 61490 held"; return 1; }
  IR init || return 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null; sleep 3
  IR roles > /dev/null || return 1
  IR status 2>&1 | strip | tail -2
}
phase_rb() {
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "rb sha mismatch"; return 1; }
  echo "rb dump $RB_DUMP bytes=$(stat -c %s "$RB_DUMP") sha256=$RB_SHA"
  IR create-db "$RBT" 2>&1 | strip | tail -1
  IR run "$RBT" -- node "$RB_RESTORE" "$RB_DUMP" "$RB_SHA" 2>&1 | strip
  IR verify "$RBT" 2>&1 | strip | tail -3
}
phase_sn() {
  [ "$(stat -c %s "$SN_DUMP")" = "$SN_BYTES" ] || { echo "sn size mismatch"; return 1; }
  [ "$(sha256sum "$SN_DUMP" | cut -d' ' -f1)" = "$SN_SHA" ] || { echo "sn sha mismatch"; return 1; }
  echo "sn dump $SN_DUMP bytes=$SN_BYTES sha256=$SN_SHA"
  IR create-db "$SNT" 2>&1 | strip | tail -1
  IR run "$SNT" -- node "$SN_RESTORE" "$SN_DUMP" "$SN_SHA" 2>&1 | strip
  IR run "$SNT" -- node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -5
  IR verify "$SNT" 2>&1 | strip | tail -3
}
phase_templates() {
  for t in "$RBT" "$SNT"; do
    IR run "$t" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT '$t ledger=' || count(*) FROM afldb_meta.schema_migrations\" -c \"SELECT 'data_overrides=' || count(*) FROM data_overrides\" -c \"SELECT 'match_event=' || count(*) FROM matches WHERE match_event IS NOT NULL\"" 2>&1 | strip | grep -v '^isolated-pg:'
  done
  IR list 2>&1 | strip
}
# rbb = accepted rebuild + DraftGuru bridge child + ANALYZE: the run-4 rebuild qualification base (run4/baseline C1/C2) and the
# documented RESTORE.md step that draft-linked suites need. Stage A raw pages are verified against the committed manifest, copied
# READ-ONLY from the run-3 rebuild workspace (copy only), and removed from the checkout again after the import.
STAGEA_SRC=/mnt/ssd/afldb-rem3-rebuild-20261114/cand/data/sources/draftguru/annual-html-20260826
STAGE=$C/data/sources/draftguru/annual-html-20260826
BRIDGE=/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
BRIDGE_SHA=1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d
RBBT=afldb_v2_i363_rbbtpl_test
phase_bridge() {
  [ "$(sha256sum "$BRIDGE" | cut -d' ' -f1)" = "$BRIDGE_SHA" ] || { echo "bridge child sha mismatch"; return 1; }
  local bad; bad=$(cd "$C" && node -e '
const fs=require("fs"),c=require("crypto");
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); let bad=0;
for(const e of m.source_urls){ const p=process.argv[2]+"/"+e.raw_filename; let ok=false; try{ ok=c.createHash("sha256").update(fs.readFileSync(p)).digest("hex")===e.sha256; }catch(_){} if(!ok) bad++; }
console.log(bad);' docs/rebuild-manifests/draftguru/annual-html-20260826.json "$STAGEA_SRC")
  [ "$bad" = 0 ] || { echo "Stage A raw pages do not match the manifest ($bad)"; return 1; }
  [ ! -e "$STAGE" ] || { echo "Stage A destination exists"; return 1; }
  mkdir -p "$STAGE/raw" && cp -a "$STAGEA_SRC/raw/years" "$STAGE/raw/years" && chmod -R a-w "$STAGE/raw/years" || return 1
  echo "stage A: 42 raw pages match the manifest; copied"
  IR create-db "$RBBT" --template "$RBT" 2>&1 | tail -1
  IR run "$RBBT" -- "$AFLDB_PYTHON" tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge "$BRIDGE" > "$EV/bridge-import.log" 2>&1
  local rc=$?; echo "bridge import rc=$rc"
  IR run "$RBBT" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -c ANALYZE" 2>&1 | grep -v '^isolated-pg:'
  IR run "$RBBT" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT 'draft_picks=' || (SELECT count(*) FROM draft_picks) || ' draft_persons=' || (SELECT count(*) FROM draft_persons) || ' bridge_identities=' || (SELECT count(*) FROM external_identities WHERE match_method = 'draftguru_person_page_afltables_bridge') || ' import_batches=' || (SELECT count(*) FROM import_batches)\"" 2>&1 | grep -v '^isolated-pg:'
  chmod -R u+w "$STAGE" && rm -rf "$STAGE"; [ ! -e "$STAGE" ] && echo "stage A removed from the checkout"
  echo "porcelain=$(git -C "$C" status --porcelain | wc -l)"
  return $rc
}
for ph in "$@"; do
  echo "=== $ph $(date -u +%T)"
  "phase_$ph" 2>&1 | strip | tee -a "$EV/setup-$ph.log"
  rc=${PIPESTATUS[0]}
  echo "=== $ph rc=$rc $(date -u +%T)"
  [ "$rc" = 0 ] || exit "$rc"
done
