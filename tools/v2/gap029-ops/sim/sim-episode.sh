#!/usr/bin/env bash
# SIMULATION ONLY. Resets the simulated production database to its baseline for a new episode: keeps ONE pristine template copy (afldb_simprod_base, created
# on first use while the database is still at baseline), drops afldb_simprod and recreates it from the template, then writes a fresh SIMULATION profile for the
# episode (new database OID, new ops/backups roots, so no accepted/lock state leaks between episodes).
# Usage: SIM=<sim dir> EPISODE=<suffix, e.g. e2> bash sim-episode.sh      (pass FIRST=1 on the first call to take the template from the current database)
set -u -o pipefail
: "${SIM:?}" "${EPISODE:?}"
[[ "$EPISODE" =~ ^[a-z0-9]+$ ]] || { echo "STOP bad episode"; exit 2; }
SIM_PORT=${SIM_PORT:-55494}; SIM_DB=${SIM_DB:-afldb_simprod}; PGBIN=/usr/lib/postgresql/16/bin
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
SUPERPW=$(cat "$SIM/pg-sim/secrets/superuser.pw")
SU() { PGPASSWORD="$SUPERPW" "$PGBIN/psql" -X -q -At -h 127.0.0.1 -p "$SIM_PORT" -U afldb_v2_super -v ON_ERROR_STOP=1 "$@"; }
[ ! -e "$SIM/profile.sim-$EPISODE.env" ] || { echo "STOP episode $EPISODE exists"; exit 2; }
if [ "${FIRST:-0}" = 1 ]; then
  [ "$(SU -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='${SIM_DB}_base'")" = 0 ] || { echo "STOP template exists"; exit 2; }
  SU -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$SIM_DB'" >/dev/null
  SU -d postgres -c "CREATE DATABASE ${SIM_DB}_base OWNER afldb_owner TEMPLATE $SIM_DB" || exit 3
else
  SU -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$SIM_DB'" >/dev/null
  SU -d postgres -c "DROP DATABASE $SIM_DB" || exit 3
  SU -d postgres -c "CREATE DATABASE $SIM_DB OWNER afldb_owner TEMPLATE ${SIM_DB}_base" || exit 3
fi
unset SUPERPW
( cd "$SIM/rw/cand" && SIM_ROLES="$SIM/pg-sim/secrets/roles.json" SIM_PORT=$SIM_PORT SIM_DB=$SIM_DB SIM_ENV_OUT="$SIM/prodco/.env" SIM_PROFILE_OUT="$SIM/profile.sim-$EPISODE.env" SIM_EPISODE="-$EPISODE" \
  SIM_ROOT="$SIM" SIM_PROD_CHECKOUT="$SIM/prodco" SIM_NODE="${SIM_NODE:-$HOME/.nvm/versions/node/v22.23.2/bin/node}" SIM_PYTHON=/home/arm/projects/afldb/.venv/bin/python SIM_PGBIN=$PGBIN SIM_SSH_HOST=dev \
  node "${SIM_ENV_SCRIPT:-tools/v2/gap029-ops/sim/sim-env.mjs}" ) || exit 4
echo "EPISODE_READY $EPISODE"
