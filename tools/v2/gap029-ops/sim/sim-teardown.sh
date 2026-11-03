#!/usr/bin/env bash
# SIMULATION ONLY. Stops the simulated production cluster. It deletes nothing: the simulation directory (which holds a restored copy of production data, hence
# mode 700) is removed only by the owner, deliberately, with the path printed below.
set -u -o pipefail
: "${SIM:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" AFLDB_V2_PG_ROOT="$SIM/pg-sim" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=${SIM_PORT:-55494}
(cd "$SIM/rw/cand" && node --import tsx tools/v2/isolated-pg.ts stop)
ss -ltn | awk '{print $4}' | grep -E ":${SIM_PORT:-55494}$" && echo "WARN still listening" || echo "simulated production cluster stopped"
echo "retained (contains restored production data, mode 700): $SIM"
