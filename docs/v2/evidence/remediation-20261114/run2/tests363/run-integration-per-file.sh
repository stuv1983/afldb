#!/usr/bin/env bash
# AFLDB-ISSUE-363: run integration suites with a disposable database per file.
#
#   export AFLDB_V2_PG_ROOT=<isolated cluster root> AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=<port>
#   CAND=<checkout> BASE=<existing marked afldb_v2_*_test database: a fresh copy of the snapshot template> \
#     [MODE=all|1] [AUDIT=<jsonl path>] bash run-integration-per-file.sh [vitest arguments after `run`...]
#
# MODE=all (default) gives EVERY integration file its own database; MODE=1 only the suites listed in
# COMMITTING_SUITES (tests/integration/leaked-fixtures.ts). AUDIT, when set, appends one JSON line per file naming the
# tables where a committed transaction left rows (evidence of which suites commit fixtures).
#
# The cluster's superuser password stays in its file: this script passes only the file's PATH and the role name
# (AFLDB_TEST_PER_FILE_ADMIN_*), because `afldb_owner` (the test role) is NOCREATEDB by design. Per-file databases are
# created from BASE (nothing may be connected to BASE while a copy is made) and dropped when each file ends; BASE is
# never dropped or modified. Refuses (inside the harness) a base not ending _test and port 5432.
# Run heavy jobs under: flock /mnt/ssd/afldb-rem2-base/heavy.lock timeout <seconds> bash run-integration-per-file.sh ...
set -u -o pipefail
: "${CAND:?}" "${BASE:?}" "${AFLDB_V2_PG_ROOT:?}" "${AFLDB_V2_PG_BIN:?}" "${AFLDB_V2_PG_PORT:?}"
MODE="${MODE:-all}"
ENVS=(AFLDB_TEST_PER_FILE_DB="$MODE"
      AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super
      AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw")
[ -n "${AUDIT:-}" ] && ENVS+=(AFLDB_TEST_PER_FILE_DB_AUDIT="$AUDIT")
cd "$CAND" || exit 1
ARGS=("$@"); [ "${#ARGS[@]}" -eq 0 ] && ARGS=(tests/integration)
exec env "${ENVS[@]}" node --import tsx tools/v2/isolated-pg.ts run "$BASE" -- node node_modules/vitest/vitest.mjs run "${ARGS[@]}"
