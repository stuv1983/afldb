#!/usr/bin/env bash
# SIMULATION ONLY (streamanator). Builds a SIMULATED production host so the real wrapper (prod-stage.sh, capture-prod-stage.sh, restore-assemble-host.sh and
# the workstation runner) can be exercised end to end, in PRODUCTION mode (no --rehearsal), without touching production, the DEV database or any DEV service:
#   * a second guarded isolated PostgreSQL cluster (own system identifier, port $SIM_PORT) holding a database named $SIM_DB restored from a retained
#     production dump. The name is deliberately NOT afldb_v2_*_test: the stage tools refuse production mode against an isolated-test name;
#   * a "production checkout" with the credential file the wrapper reads, and a generated SIMULATION profile (EVIDENCE_CLASS=SIMULATION), so everything it
#     produces is labelled simulated evidence and can never be mistaken for genuine production evidence;
#   * a restore workspace ($SIM/rw) for the restore host role: pinned checkout, its own isolated cluster root (restore port 55493), python.
# Usage: SIM=<new dir on /mnt/ssd> DUMP=<retained prod dump> DUMP_SHA=<its sha256> SRC_CAND=<existing checkout holding node_modules> TAR=<cand.tar.gz of the pinned revision> R=<40 hex> bash sim-setup.sh
set -u -o pipefail
: "${SIM:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${SRC_CAND:?}" "${TAR:?}" "${R:?}"
SIM_PORT=${SIM_PORT:-55494}; SIM_DB=${SIM_DB:-afldb_simprod}
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PGBIN=/usr/lib/postgresql/16/bin
say() { echo "$(date -u +%FT%TZ) $*"; }
[ ! -e "$SIM" ] || { echo "STOP $SIM exists"; exit 2; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha256 mismatch"; exit 3; }
mkdir -m 700 "$SIM" && mkdir -m 700 "$SIM/in" "$SIM/ops" "$SIM/backups" "$SIM/rw" "$SIM/private"
say "extract the pinned checkout twice: the simulated production checkout and the restore workspace"
tar xzf "$TAR" -C "$SIM/rw" || exit 3                                  # -> $SIM/rw/cand
mkdir -m 700 "$SIM/prodhome" && tar xzf "$TAR" -C "$SIM/prodhome" && mv "$SIM/prodhome/cand" "$SIM/prodco" && rmdir "$SIM/prodhome"
for c in "$SIM/rw/cand" "$SIM/prodco"; do
  [ "$(git -C "$c" rev-parse HEAD)" = "$R" ] || { echo "STOP $c is not at $R"; exit 3; }
  ln -s "$SRC_CAND/node_modules" "$c/node_modules"; echo node_modules >> "$c/.git/info/exclude"
done
ln -s /home/arm/projects/afldb/.venv "$SIM/rw/venv"
# the simulated production checkout needs a build marker only because the capture records it; make it obviously a simulation
mkdir -p "$SIM/prodco/.next" && echo "SIMULATION" > "$SIM/prodco/.next/BUILD_ID"

say "initialise and start the simulated production cluster on port $SIM_PORT"
export AFLDB_V2_PG_ROOT="$SIM/pg-sim" AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$SIM_PORT
IR() { (cd "$SIM/rw/cand" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
IR init || exit 4
( IR start > "$SIM/private/pg-start.out" 2>&1 < /dev/null & ); sleep 5
IR status || exit 4
IR roles || exit 4
ss -ltnp 2>/dev/null | grep ":$SIM_PORT " | sed 's/users:.*//'

say "create $SIM_DB (owner afldb_owner) as the cluster superuser and restore the retained dump with the production role names"
SUPERPW=$(cat "$AFLDB_V2_PG_ROOT/secrets/superuser.pw")
SU() { PGPASSWORD="$SUPERPW" "$PGBIN/psql" -X -q -At -h 127.0.0.1 -p "$SIM_PORT" -U afldb_v2_super -v ON_ERROR_STOP=1 "$@"; }
SU -d postgres -c "CREATE DATABASE $SIM_DB OWNER afldb_owner" || exit 5
SU -d "$SIM_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; ALTER SCHEMA public OWNER TO afldb_owner;" || exit 5
OWNPW=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).afldb_owner)' "$AFLDB_V2_PG_ROOT/secrets/roles.json")
PGPASSWORD="$OWNPW" "$PGBIN/pg_restore" --no-password --no-comments --no-owner -j 4 -h 127.0.0.1 -p "$SIM_PORT" -U afldb_owner -d "$SIM_DB" "$DUMP" > "$SIM/private/restore.out" 2>&1
echo "pg_restore exit=$? stderr_lines=$(grep -c . "$SIM/private/restore.out")"; unset OWNPW SUPERPW
head -5 "$SIM/private/restore.out" | sed 's/postgres\(ql\)\?:\/\/[^ ]*/<dsn>/g' | cut -c1-160
SU() { :; }

say "initialise the restore-host cluster root ($SIM/rw/pg-root, port 55493) with the five roles; the restore script starts and stops it"
( export AFLDB_V2_PG_ROOT="$SIM/rw/pg-root" AFLDB_V2_PG_PORT=55493; cd "$SIM/rw/cand" && node --import tsx tools/v2/isolated-pg.ts init > /dev/null \
  && { ( node --import tsx tools/v2/isolated-pg.ts start > "$SIM/private/pg-restore-start.out" 2>&1 < /dev/null & ); sleep 5; node --import tsx tools/v2/isolated-pg.ts roles; node --import tsx tools/v2/isolated-pg.ts stop; } ) || exit 4

say "generate the credential file and the SIMULATION profile from the live simulated cluster"
( cd "$SIM/rw/cand" && SIM_ROLES="$AFLDB_V2_PG_ROOT/secrets/roles.json" SIM_PORT=$SIM_PORT SIM_DB=$SIM_DB SIM_ENV_OUT="$SIM/prodco/.env" SIM_PROFILE_OUT="$SIM/profile.sim.env" \
  SIM_ROOT="$SIM" SIM_PROD_CHECKOUT="$SIM/prodco" SIM_NODE="$HOME/.nvm/versions/node/v22.23.2/bin/node" SIM_PYTHON=/home/arm/projects/afldb/.venv/bin/python SIM_PGBIN=$PGBIN SIM_SSH_HOST=dev \
  node tools/v2/gap029-ops/sim/sim-env.mjs ) || exit 6
chmod 600 "$SIM/prodco/.env" "$SIM/profile.sim.env"
echo "SIM_READY $SIM"
echo "OUTPUT profile.sim.env $(sha256sum "$SIM/profile.sim.env" | cut -d' ' -f1)"
