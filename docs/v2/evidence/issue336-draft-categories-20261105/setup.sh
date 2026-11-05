#!/usr/bin/env bash
# AFLDB-ISSUE-336 isolated workspace on streamanator. Reads the verified 2026-11-04 production dump only.
# Own loopback cluster on $PORT, databases afldb_v2_i336*_test only. No sudo, no DEV service touched.
set -u -o pipefail
: "${W:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/mnt/ssd/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
PORT=55498
EV="$W/evidence"; mkdir -p "$EV"
CAND="$W/i336c"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
step() { say "STEP $1"; shift; "$@" >> "$EV/setup.log" 2>&1 || { say "FAIL rc=$?"; exit 1; }; }

say "W=$W"
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" >/dev/null && { say "port $PORT in use"; exit 1; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { say "dump sha mismatch"; exit 1; }
say "dump sha verified"
step untar tar xzf "$W/in/base.tar.gz" -C "$W"
step npmci bash -c "cd '$CAND' && npm ci --no-audit --no-fund --include=dev"
step init bash -c "cd '$CAND' && node --import tsx tools/v2/isolated-pg.ts init"
(cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts start > "$EV/pg-start.out" 2>&1 < /dev/null) &
wait; sleep 3
step roles IR roles
step status IR status
step createtmpl IR create-db afldb_v2_i336tmpl_test
cp "$W/in/restore.mjs" "$CAND/.i336-restore.mjs"
step restore RUNDB afldb_v2_i336tmpl_test node .i336-restore.mjs "$DUMP" "$DUMP_SHA"
rm -f "$CAND/.i336-restore.mjs"
step migrate RUNDB afldb_v2_i336tmpl_test node --import tsx tools/db/migrate.ts --target test
say "SETUP DONE"
