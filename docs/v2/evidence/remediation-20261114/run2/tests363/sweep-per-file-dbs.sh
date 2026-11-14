#!/usr/bin/env bash
# AFLDB-ISSUE-363: remove per-file test databases left by a crashed run (SIGKILL, host reboot, timeout before teardown).
#
#   export AFLDB_V2_PG_ROOT=<isolated cluster root> AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=<port>
#   CAND=<checkout> BASE=<the base database the crashed run used> [MAX_AGE_MINUTES=360] [DRY_RUN=1] bash sweep-per-file-dbs.sh
#
# Drops ONLY databases named <prefix><yyyymmddHHMMSS>_<pid>_<nonce>_test (prefix afldb_v2_pf_ unless
# AFLDB_TEST_PER_FILE_DB_PREFIX is set), older than the age bound (minimum 60 minutes; default 360) by the stamp in
# the name, carrying the base's marker comment, never BASE. Run it with DRY_RUN=1 first; it lists what it would drop
# and what it keeps with the reason. Never run it while a per-file run of a longer file than the bound is in progress.
set -u -o pipefail
: "${CAND:?}" "${BASE:?}" "${AFLDB_V2_PG_ROOT:?}" "${AFLDB_V2_PG_BIN:?}" "${AFLDB_V2_PG_PORT:?}"
cd "$CAND" || exit 1
ARGS=(--max-age-minutes "${MAX_AGE_MINUTES:-360}"); [ "${DRY_RUN:-0}" = 1 ] && ARGS+=(--dry-run)
exec env AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
  AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
  node --import tsx tools/v2/isolated-pg.ts run "$BASE" -- node --import tsx packages/testing/src/per-file-db-sweep.ts "${ARGS[@]}"
