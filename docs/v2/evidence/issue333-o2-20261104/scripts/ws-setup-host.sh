#!/usr/bin/env bash
# ISSUE-333 / O2: prepare a FRESH disposable workspace on streamanator (no sudo; nothing outside $W is written; DEV services only read).
#   W=/mnt/ssd/afldb-issue333-o2-<stamp> R=<40-hex> CAND_SHA=<sha256 of in/cand.tar.gz> bash ws-setup-host.sh
# Inputs already in $W/in: cand.tar.gz (a git clone of the workstation repository at R), core.tar, restore.mjs, probe-dbs.mjs,
# rehearsal_helper.py, coach-figures.mts, scn.sh. node_modules is linked READ-ONLY from the retained GAP-029 workspace only when the
# package lock is byte-identical; python is the DEV checkout's venv (psycopg), linked, never modified.
set -u -o pipefail
: "${W:?}" "${R:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
OLD=/mnt/ssd/afldb-v2-gap029-prod-20261103
CORE_SHA=9a989fdcf7177cff24bbedcd0ee4559b772ebc452c05dab331e128859e4db080
PORT=55493
stop() { echo "STOP: $1"; exit "${2:-1}"; }
echo "UTC=$(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"; df -h /mnt/ssd | tail -1
[ -d "$W/in" ] || stop "no $W/in"
[ ! -e "$W/cand" ] || stop "$W/cand already exists (fresh workspace required)"
cd "$W/in" || exit 1
[ "$(sha256sum cand.tar.gz | cut -d' ' -f1)" = "$CAND_SHA" ] || stop "cand.tar.gz sha256 mismatch"
[ "$(sha256sum core.tar | cut -d' ' -f1)" = "$CORE_SHA" ] || stop "core.tar sha256 mismatch"
sha256sum * | tee "$W/in.SHA256SUMS"
tar xzf cand.tar.gz -C "$W" || stop "extract failed"
cd "$W/cand" || exit 1
[ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD is not $R"
[ "$(git status --porcelain | wc -l)" = 0 ] || stop "candidate tree is dirty"
[ "$(sha256sum package-lock.json | cut -d' ' -f1)" = "$(sha256sum "$OLD/cand/package-lock.json" | cut -d' ' -f1)" ] || stop "package-lock differs from the retained workspace (node_modules not reusable)"
ln -s "$OLD/cand/node_modules" node_modules
echo node_modules >> .git/info/exclude
[ "$(git status --porcelain | wc -l)" = 0 ] || stop "node_modules link dirtied the tree"
ln -s /home/arm/projects/afldb/.venv "$W/venv"
"$W/venv/bin/python" -c 'import psycopg, sys; print("python", sys.version.split()[0], "psycopg", psycopg.__version__)' || stop "venv python lacks psycopg"
echo "HEAD=$(git rev-parse HEAD) tracked=$(git ls-files | wc -l) dirty=0 node=$(node -v)"
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && stop "port $PORT already listening"
for u in afldb.service postgresql@16-main.service; do echo "DEV $u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done | tee "$W/dev-setup.txt"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
IR() { (cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
IR init || stop "cluster init failed"
( IR start > "$W/pg-start-setup.out" 2>&1 < /dev/null & ); sleep 4
IR status || stop "cluster did not start"
IR roles || { IR stop; stop "roles failed"; }
IR list
IR stop; sleep 2
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && echo "WARN port still listening"
echo "== setup done"
