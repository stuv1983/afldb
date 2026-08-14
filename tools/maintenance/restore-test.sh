#!/usr/bin/env bash
#
# AFLDB restore verification.
#
#   tools/maintenance/restore-test.sh                 restore the newest backup
#   tools/maintenance/restore-test.sh <file.dump>     restore a specific backup
#
# A backup is not proven until it has been restored and checked. This
# restores into afldb_restore_test (never afldb_dev) and runs core parity
# checks against the restored copy.
#
# Requires afldb_restore_test to exist. It is created once by
# tools/maintenance/01_setup_service.sh.
#
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a

# Move a postgres DSN's password out of argv and into PGPASSWORD.
#
# A DSN on a command line is visible in `ps` and world-readable through
# /proc/<pid>/cmdline; libpq instead reads PGPASSWORD from the environment
# (/proc/<pid>/environ, readable only by the owner). This exports PGPASSWORD
# and assigns a password-less DSN to the named variable.
dsn_scrub() {
  local __out_var="$1" dsn="$2"
  if [[ "$dsn" =~ ^([a-zA-Z][a-zA-Z0-9+.-]*://)([^:/@]+):([^@]*)@(.*)$ ]]; then
    export PGPASSWORD="${BASH_REMATCH[3]}"
    printf -v "$__out_var" '%s%s@%s' \
      "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[4]}"
  else
    printf -v "$__out_var" '%s' "$dsn"
  fi
}

BACKUP_DIR="${AFLDB_BACKUP_DIR:-$HOME/backups/afldb}"
OWNER_DSN="${AFLDB_OWNER_DATABASE_URL:-}"

if [[ -z "$OWNER_DSN" ]]; then
  echo "ERROR: AFLDB_OWNER_DATABASE_URL is not set." >&2
  exit 1
fi

RESTORE_DB="afldb_restore_test"

# Replace the database NAME, not a substring of the whole DSN. Substituting
# "/afldb_dev" left any other source database — production included —
# untouched, which pointed --clean at the database being backed up.
strip_query() { printf '%s' "${1%%\?*}"; }
BASE_DSN="$(strip_query "$OWNER_DSN")"
SOURCE_DB="${BASE_DSN##*/}"
RESTORE_DSN="${BASE_DSN%/*}/${RESTORE_DB}"
case "$OWNER_DSN" in
  *\?*) RESTORE_DSN="${RESTORE_DSN}?${OWNER_DSN#*\?}" ;;
esac

if [[ -z "$SOURCE_DB" || "$BASE_DSN" != */* ]]; then
  echo "ERROR: could not read a database name from AFLDB_OWNER_DATABASE_URL." >&2
  exit 1
fi

# A restore is destructive. Refuse outright unless the target really is the
# throwaway database, whatever the source happened to be named.
if [[ "${RESTORE_DSN%%\?*}" != */${RESTORE_DB} ]]; then
  echo "ERROR: refusing to restore into anything but ${RESTORE_DB}." >&2
  exit 1
fi
if [[ "$SOURCE_DB" == "$RESTORE_DB" ]]; then
  echo "ERROR: source and restore target are the same database (${RESTORE_DB})." >&2
  exit 1
fi

BACKUP="${1:-}"
if [[ -z "$BACKUP" ]]; then
  BACKUP=$(ls -1t "${BACKUP_DIR}"/"${SOURCE_DB}"-*.dump 2>/dev/null | head -1 || true)
fi
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "ERROR: no backup found in ${BACKUP_DIR}" >&2
  exit 1
fi

# The DSNs are only used to connect from here on, so move the password out of
# argv into PGPASSWORD. Both carry the same owner credentials, so either scrub
# sets the same PGPASSWORD.
dsn_scrub OWNER_DSN "$OWNER_DSN"
dsn_scrub RESTORE_DSN "$RESTORE_DSN"

echo "==> Restoring $(basename "$BACKUP") into afldb_restore_test"

if ! psql "$RESTORE_DSN" -c 'SELECT 1' > /dev/null 2>&1; then
  echo "ERROR: cannot connect to afldb_restore_test." >&2
  echo "       Create it first: sudo bash tools/maintenance/01_setup_service.sh" >&2
  exit 1
fi

START=$(date +%s)

# Empty the target BEFORE restoring. Without this a failed restore leaves
# the previous generation in place, and because a reload is deterministic
# the parity checks can pass against data the dump never produced —
# "verified" on a backup that is not restorable.
#
# Tables are dropped individually rather than by dropping the schema:
# pg_trgm and unaccent live in public and are owned by another role, so
# DROP SCHEMA public CASCADE would fail on extension ownership.
echo "    clearing ${RESTORE_DB}"
psql "$RESTORE_DSN" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
  END LOOP;
END $$;
SQL

# --clean --if-exists makes the restore repeatable.
#
# The restoring role does not own pg_trgm or unaccent, so --clean's
# DROP EXTENSION and the COMMENT ON EXTENSION statements always fail with
# "must be owner of extension". Both are harmless: the extensions already
# exist in the target and must stay.
#
# Those two messages are the ONLY tolerated failures. pg_restore's exit
# status is captured and every other error line is fatal, because a
# verification tool that swallows errors verifies nothing.
RESTORE_LOG=$(mktemp)
trap 'rm -f "$RESTORE_LOG"' EXIT

set +e
pg_restore \
  --dbname="$RESTORE_DSN" \
  --clean --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --jobs=4 \
  "$BACKUP" > "$RESTORE_LOG" 2>&1
RESTORE_STATUS=$?
set -e

UNEXPECTED=$(grep -v '^pg_restore: warning' "$RESTORE_LOG" \
  | grep -v 'must be owner of extension' \
  | grep -v 'Command was: DROP EXTENSION' \
  | grep -v 'Command was: COMMENT ON EXTENSION' \
  | grep -v '^ *$' || true)

if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: pg_restore reported errors beyond the known extension-owner ones:" >&2
  printf '%s\n' "$UNEXPECTED" >&2
  echo "       (pg_restore exit status ${RESTORE_STATUS})" >&2
  exit 1
fi

if [[ $RESTORE_STATUS -ne 0 ]]; then
  # Only the tolerated messages appeared, so a non-zero status here is
  # pg_restore counting those same errors. Say so rather than hiding it.
  echo "    pg_restore exited ${RESTORE_STATUS}; only extension-owner errors were reported"
fi

ELAPSED=$(( $(date +%s) - START ))
echo "    restored in ${ELAPSED}s"

echo "==> Parity checks against the restored database"

FAILED=0
check() {
  local label="$1" query="$2"
  local source_value restored_value
  # A missing table means the restore did not complete. That must read as
  # a failed check, not as an aborted script with no verdict.
  source_value=$(psql "$OWNER_DSN"   -tAc "$query" 2>/dev/null) || source_value='<query failed>'
  restored_value=$(psql "$RESTORE_DSN" -tAc "$query" 2>/dev/null) || restored_value='<query failed>'
  if [[ "$source_value" == "$restored_value" && "$restored_value" != '<query failed>' ]]; then
    printf '    PASS  %-38s %s\n' "$label" "$restored_value"
  else
    printf '    FAIL  %-38s source=%s restored=%s\n' "$label" "$source_value" "$restored_value"
    FAILED=$((FAILED + 1))
  fi
}

check "player_match_stats rows"  "SELECT count(*) FROM player_match_stats"
check "players rows"             "SELECT count(*) FROM players"
check "matches rows"             "SELECT count(*) FROM matches"
check "clubs rows"               "SELECT count(*) FROM clubs"
check "career games total"       "SELECT sum(games) FROM player_career_stats"
check "career goals total"       "SELECT sum(goals) FROM player_career_stats"
check "Brownlow votes total"     "SELECT sum(votes) FROM brownlow_season_votes"
check "unrecorded disposals"     "SELECT count(*) FROM player_match_stats WHERE disposals IS NULL"
check "stat_availability rows"   "SELECT count(*) FROM stat_availability"

if [[ $FAILED -eq 0 ]]; then
  echo "==> Restore verified: the backup is proven."
else
  echo "==> RESTORE VERIFICATION FAILED: ${FAILED} check(s) differ." >&2
  exit 1
fi
