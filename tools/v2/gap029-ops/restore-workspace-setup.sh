#!/usr/bin/env bash
# GAP-029: creates the RESTORE-HOST workspace for ONE pinned revision on the isolated restore host (streamanator): the pinned checkout (extracted from the same
# verified tarball that is uploaded to production), a link to an existing node_modules of an identical lockfile, the python venv link, and an isolated
# PostgreSQL cluster root (separate from production and from the DEV database) initialised with the five AFLDB roles. It starts and stops that cluster once to
# create the roles; the restore script starts and stops it per stage. Nothing here touches production, the DEV database or any DEV service.
# Usage: W=<new dir> TAR=<cand.tar.gz> TAR_SHA256=<hex> R=<40 hex> SRC_CAND=<checkout holding node_modules> [PORT=55493] bash restore-workspace-setup.sh
set -u -o pipefail
: "${W:?}" "${TAR:?}" "${TAR_SHA256:?}" "${R:?}" "${SRC_CAND:?}"
PORT=${PORT:-55493}
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
[ ! -e "$W" ] || { echo "STOP $W exists"; exit 2; }
[ "$(sha256sum "$TAR" | cut -d' ' -f1)" = "$TAR_SHA256" ] || { echo "STOP tarball sha256 mismatch"; exit 3; }
mkdir -m 700 "$W" && tar xzf "$TAR" -C "$W" || exit 3
C=$W/cand
[ "$(git -C "$C" rev-parse HEAD)" = "$R" ] && [ "$(git -C "$C" status --porcelain | wc -l)" = 0 ] || { echo "STOP workspace checkout is not clean at $R"; exit 3; }
cmp -s "$C/package-lock.json" "$SRC_CAND/package-lock.json" && cmp -s "$C/package.json" "$SRC_CAND/package.json" || { echo "STOP package files differ from the node_modules source"; exit 3; }
ln -s "$SRC_CAND/node_modules" "$C/node_modules"; echo node_modules >> "$C/.git/info/exclude"
ln -s /home/arm/projects/afldb/.venv "$W/venv"
[ "$(git -C "$C" status --porcelain | wc -l)" = 0 ] || { echo "STOP the node_modules link dirtied the checkout"; exit 3; }
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
mkdir -m 700 "$W/logs-setup"
IR init > "$W/logs-setup/init.out" || exit 4
( IR start > "$W/logs-setup/start.out" 2>&1 < /dev/null & ); sleep 5
IR roles || { IR stop; exit 4; }
IR stop; sleep 1
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP cluster still listening"; exit 4; }
echo "RESTORE_WORKSPACE_READY $W revision $R"
