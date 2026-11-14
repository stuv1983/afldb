#!/usr/bin/env bash
# Sourced helper for the admin scope (host). Usage: . host-env.sh ; IR status ; RUNDB <db> <cmd...>
W=/mnt/ssd/afldb-rem-admin-20261114
PORT=55613
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="${CAND:-$W/cand}"
EV="$W/evidence"
TMPL=afldb_v2_remadmin_tmpl_test
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }
# fresh disposable copy of the snapshot template; drops a same-named database first only if it exists in our cluster
FRESH() { local db="$1"; IR create-db "$db" --template "$TMPL"; }
