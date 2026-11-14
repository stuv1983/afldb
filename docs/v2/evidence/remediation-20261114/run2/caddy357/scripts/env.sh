#!/usr/bin/env bash
# caddy357 scope environment (sourced). SCOPE-TAG: caddy357-afldb-rem2-20261114
export W=/mnt/ssd/afldb-rem2-caddy357-20261114
export CADDY_PORT=55653 UP_PORT=55663
export PG_PORT=55673   # isolated PostgreSQL for the real-app check only (not an allotted port: disclosed)
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=$W/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PG_PORT
export CAND=$W/cand
export EV=$W/evidence
mkdir -p "$EV"
export DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
export DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
export DUMP_BYTES=30141895
export TMPL=afldb_v2_rem2caddy357_tmpl_test
export HEAVY=/mnt/ssd/afldb-rem2-base/heavy.lock
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }
