#!/usr/bin/env bash
#
# AFLDB database backup.
#
#   tools/maintenance/backup.sh              back up afldb_dev
#   tools/maintenance/backup.sh --keep 14    change retention (default 7)
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
SOURCE_DSN="${AFLDB_BACKUP_DATABASE_URL:-${AFLDB_OWNER_DATABASE_URL:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --dir)  BACKUP_DIR="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$SOURCE_DSN" ]]; then
  echo "ERROR: no backup DSN configured (AFLDB_BACKUP_DATABASE_URL)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/afldb_dev-${STAMP}.dump"

echo "==> Backing up to ${TARGET}"
START=$(date +%s)

# --no-owner keeps the dump restorable under a different role name.
pg_dump "$SOURCE_DSN" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --file="$TARGET"

chmod 600 "$TARGET"
SIZE=$(du -h "$TARGET" | cut -f1)
ELAPSED=$(( $(date +%s) - START ))

echo "    wrote ${SIZE} in ${ELAPSED}s"

# Verify the archive's table of contents is readable before trusting it.
if pg_restore --list "$TARGET" > /dev/null 2>&1; then
  OBJECTS=$(pg_restore --list "$TARGET" | grep -c '^[0-9]' || true)
  echo "    archive readable, ${OBJECTS} objects"
else
  echo "ERROR: archive is not readable by pg_restore" >&2
  exit 1
fi

echo "==> Pruning backups older than the newest ${KEEP}"
ls -1t "${BACKUP_DIR}"/afldb_dev-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "    removing $(basename "$old")"
  rm -f "$old"
done

REMAINING=$(ls -1 "${BACKUP_DIR}"/afldb_dev-*.dump 2>/dev/null | wc -l)
echo "==> Done. ${REMAINING} backup(s) retained in ${BACKUP_DIR}"
