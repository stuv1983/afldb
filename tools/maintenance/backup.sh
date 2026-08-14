#!/usr/bin/env bash
#
# AFLDB database backup.
#
#   tools/maintenance/backup.sh              back up AFLDB_BACKUP_DATABASE_URL
#   tools/maintenance/backup.sh --keep 14    change retention (default 7)
#
# The database name in the DSN decides the filename and what retention
# prunes, so pointing this at a different database keeps its own series.
#
# Uses pg_dump custom format (-Fc): compressed, and restorable
# selectively with pg_restore. Backups are written to a directory only
# the owning user can read, because a dump is a full copy of the data.
#
# A backup is not considered proven until it has been restored. Run
# tools/maintenance/restore-test.sh to verify.
#
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a

BACKUP_DIR="${AFLDB_BACKUP_DIR:-$HOME/backups/afldb}"
KEEP=7
SOURCE_DSN="${AFLDB_BACKUP_DATABASE_URL:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --dir)  BACKUP_DIR="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# No silent fall back to the owner DSN. The backup role is read-only by
# design; quietly dumping as the owner instead would mean the nightly job
# runs with write privileges nobody intended it to have.
if [[ -z "$SOURCE_DSN" ]]; then
  echo "ERROR: AFLDB_BACKUP_DATABASE_URL is not set." >&2
  echo "       Set it to the afldb_backup role's DSN; the owner DSN is not a" >&2
  echo "       substitute, because a backup must not hold write privileges." >&2
  exit 1
fi

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || [[ "$KEEP" -lt 1 ]]; then
  echo "ERROR: --keep must be a positive integer (got '${KEEP}')." >&2
  exit 2
fi

# Name the file after the database actually being dumped. Hardcoding
# afldb_dev made every dump look like a development one, so a production
# backup would have been pruned and restored as if it were dev data.
DB_NAME="${SOURCE_DSN%%\?*}"
DB_NAME="${DB_NAME##*/}"
if [[ -z "$DB_NAME" ]]; then
  echo "ERROR: could not read a database name from AFLDB_BACKUP_DATABASE_URL." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/${DB_NAME}-${STAMP}.dump"
# Written under a partial name and renamed only once pg_dump succeeds and
# the archive has been read back. An interrupted dump therefore cannot
# become the newest restore candidate.
PARTIAL="${TARGET}.partial"

cleanup_partial() { [[ -f "$PARTIAL" ]] && rm -f "$PARTIAL"; }
trap cleanup_partial EXIT

echo "==> Backing up ${DB_NAME} to ${TARGET}"
START=$(date +%s)

# --no-owner keeps the dump restorable under a different role name.
pg_dump "$SOURCE_DSN" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --file="$PARTIAL"

chmod 600 "$PARTIAL"

# Verify the archive's table of contents is readable before trusting it.
if pg_restore --list "$PARTIAL" > /dev/null 2>&1; then
  OBJECTS=$(pg_restore --list "$PARTIAL" | grep -c '^[0-9]' || true)
else
  echo "ERROR: archive is not readable by pg_restore; keeping nothing." >&2
  exit 1
fi

mv "$PARTIAL" "$TARGET"
trap - EXIT

SIZE=$(du -h "$TARGET" | cut -f1)
ELAPSED=$(( $(date +%s) - START ))
echo "    wrote ${SIZE} in ${ELAPSED}s"
echo "    archive readable, ${OBJECTS} objects"
echo "    a dump is not proven until restored: tools/maintenance/restore-test.sh"

echo "==> Pruning backups older than the newest ${KEEP}"
ls -1t "${BACKUP_DIR}"/"${DB_NAME}"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "    removing $(basename "$old")"
  rm -f "$old"
done

REMAINING=$(ls -1 "${BACKUP_DIR}"/"${DB_NAME}"-*.dump 2>/dev/null | wc -l)
echo "==> Done. ${REMAINING} backup(s) of ${DB_NAME} retained in ${BACKUP_DIR}"
