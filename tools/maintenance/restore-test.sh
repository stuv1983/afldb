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

BACKUP_DIR="${AFLDB_BACKUP_DIR:-$HOME/backups/afldb}"
OWNER_DSN="${AFLDB_OWNER_DATABASE_URL:-}"

if [[ -z "$OWNER_DSN" ]]; then
  echo "ERROR: AFLDB_OWNER_DATABASE_URL is not set." >&2
  exit 1
fi

RESTORE_DSN="${OWNER_DSN/\/afldb_dev/\/afldb_restore_test}"

BACKUP="${1:-}"
if [[ -z "$BACKUP" ]]; then
  BACKUP=$(ls -1t "${BACKUP_DIR}"/afldb_dev-*.dump 2>/dev/null | head -1 || true)
fi
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "ERROR: no backup found in ${BACKUP_DIR}" >&2
  exit 1
fi

echo "==> Restoring $(basename "$BACKUP") into afldb_restore_test"

if ! psql "$RESTORE_DSN" -c 'SELECT 1' > /dev/null 2>&1; then
  echo "ERROR: cannot connect to afldb_restore_test." >&2
  echo "       Create it first: sudo bash tools/maintenance/01_setup_service.sh" >&2
  exit 1
fi

START=$(date +%s)

# --clean --if-exists makes the restore repeatable.
#
# The restoring role does not own pg_trgm or unaccent, so --clean's
# DROP EXTENSION and the COMMENT ON EXTENSION statements always fail with
# "must be owner of extension". Both are harmless: the extensions already
# exist in the target and must stay. They are filtered by exact message
# rather than by suppressing errors wholesale, because red lines in a
# verification tool make a REAL failure easy to miss.
#
# Nothing here decides whether the restore worked — the parity checks
# below do that, and they exit non-zero on any difference.
pg_restore \
  --dbname="$RESTORE_DSN" \
  --clean --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --jobs=4 \
  "$BACKUP" 2>&1 \
  | grep -v '^pg_restore: warning' \
  | grep -v 'must be owner of extension' \
  | grep -v 'Command was: DROP EXTENSION' \
  || true

ELAPSED=$(( $(date +%s) - START ))
echo "    restored in ${ELAPSED}s"

echo "==> Parity checks against the restored database"

FAILED=0
check() {
  local label="$1" query="$2"
  local source_value restored_value
  source_value=$(psql "$OWNER_DSN"   -tAc "$query")
  restored_value=$(psql "$RESTORE_DSN" -tAc "$query")
  if [[ "$source_value" == "$restored_value" ]]; then
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
