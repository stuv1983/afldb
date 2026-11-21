#!/usr/bin/env bash
# ISSUE-363 tier P (22 Nov 2026) host setup on the DEV host: run-owned workspace, own isolated cluster (port 61530), the tier S template
# (accepted source-only rebuild dump + the documented DraftGuru bridge import, exactly as 21 Nov setup.sh phase_rb + phase_bridge).
#   bash setup.sh <phase>...   phases: checkout cluster s0 bridge
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-363; C=$W/cand; EV=$W/ev; mkdir -p "$W" "$EV"
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61530 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python
RB_DUMP=/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
RB_RESTORE=/mnt/ssd/afldb-rem3-base/rebuilt/restore-dump.mjs
S0=afldb_v2_rb_s0_test      # the restored dump, never touched again
ST=afldb_v2_rb_s_test       # tier S template = s0 + bridge; every tier P copy is made from this
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }

phase_checkout() {
  [ -d "$C" ] && { echo "cand exists"; return 1; }
  git clone -q "$W/tierp.bundle" "$C" -b claude/backlog-20261122 || return 1
  cd "$C" || return 1
  echo "HEAD=$(git rev-parse HEAD)"
  npm ci --no-audit --no-fund > "$EV/npm-ci.log" 2>&1; echo "npm ci rc=$?"
  [ -e .env ] && { echo ".env present"; return 1; }
  /home/arm/projects/afldb/.venv/bin/python -c 'import psycopg,sys;print(sys.version.split()[0],"psycopg",psycopg.__version__)'
  echo "porcelain=$(git status --porcelain | wc -l)"
}
phase_cluster() {
  ss -ltnH "sport = :61530" | grep -q . && { echo "STOP port 61530 held"; return 1; }
  IR init || return 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null; sleep 3
  IR roles > /dev/null || return 1
  IR status 2>&1 | strip | tail -2
}
phase_s0() {
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "rb sha mismatch"; return 1; }
  echo "rb dump bytes=$(stat -c %s "$RB_DUMP") sha256=$RB_SHA"
  IR create-db "$S0" 2>&1 | strip | tail -1
  IR run "$S0" -- node "$RB_RESTORE" "$RB_DUMP" "$RB_SHA" 2>&1 | strip
  IR verify "$S0" 2>&1 | strip | tail -3
}
STAGEA_SRC=/mnt/ssd/afldb-rem3-rebuild-20261114/cand/data/sources/draftguru/annual-html-20260826
STAGE=$C/data/sources/draftguru/annual-html-20260826
BRIDGE=/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
BRIDGE_SHA=1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d
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
  IR create-db "$ST" --template "$S0" 2>&1 | tail -1
  IR run "$ST" -- "$AFLDB_PYTHON" tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge "$BRIDGE" > "$EV/bridge-import.log" 2>&1
  local rc=$?; echo "bridge import rc=$rc"
  IR run "$ST" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -c ANALYZE" 2>&1 | grep -v '^isolated-pg:'
  IR run "$ST" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT 'draft_picks=' || (SELECT count(*) FROM draft_picks) || ' draft_persons=' || (SELECT count(*) FROM draft_persons) || ' bridge_identities=' || (SELECT count(*) FROM external_identities WHERE match_method = 'draftguru_person_page_afltables_bridge') || ' import_batches=' || (SELECT count(*) FROM import_batches) || ' ledger=' || (SELECT count(*) FROM afldb_meta.schema_migrations) || ' data_overrides=' || (SELECT count(*) FROM data_overrides) || ' auth_users=' || (SELECT count(*) FROM auth_users)\"" 2>&1 | grep -v '^isolated-pg:'
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
