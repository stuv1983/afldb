# sourced by host scripts of the run-3 rebuild scope
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export W=/mnt/ssd/afldb-rem3-rebuild-20261114
export C=$W/cand
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem3-rebuild-20261114-pg
export AFLDB_V2_PG_PORT=55672
export AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export PYTHON=$AFLDB_PYTHON
export AFLDB_REBUILD_CAPTURE_ROOT=$W/capture-root
export DB=afldb_v2_rb_rem3_test
IR() { ( cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@" ); }
