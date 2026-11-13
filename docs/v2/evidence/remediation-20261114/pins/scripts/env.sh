#!/usr/bin/env bash
# pins workspace environment (sourced)
export W=/mnt/ssd/afldb-rem-pins-20261114
export PORT=55611
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
VENVPY=/home/arm/i250/afldb/.venv/bin/python
export CAND=$W/cand
export EV=$W/evidence
mkdir -p "$EV"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
TMPL=afldb_v2_rempins_tmpl_test
export AFLDB_V2_PG_ROOT=$W/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }
