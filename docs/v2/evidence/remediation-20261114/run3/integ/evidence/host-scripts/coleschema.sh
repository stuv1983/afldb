#!/usr/bin/env bash
# v2-coleman-publication on its documented base: a fresh, schema-only database (create-db WITHOUT a template, the normal
# migration runner, then the privileges script), exactly as docs/v2/evidence/gap006-linux-qualification-20261101 ran it (28/28).
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem3-integ-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55673
CAND=$W/cand; EV=$W/evidence/a; S=afldb_v2_rem3integ_cs_test
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
IR create-db "$S" 2>&1 | strip | tail -1
IR run "$S" -- node --import tsx tools/db/migrate.ts --target test > "$EV/coleschema-migrate.log" 2>&1 || { echo "migrate failed"; exit 1; }
strip < "$EV/coleschema-migrate.log" | tail -3
IR run "$S" -- node --import tsx tools/db/privileges.ts --target test > "$EV/coleschema-privileges.log" 2>&1 || { echo "privileges failed"; exit 1; }
strip < "$EV/coleschema-privileges.log" | tail -2
bash "$W/in/phaseA.sh" vt "$S" coleman-schema-only 1800 tests/integration/v2-coleman-publication.test.ts
bash "$W/in/phaseA.sh" drop "$S"
