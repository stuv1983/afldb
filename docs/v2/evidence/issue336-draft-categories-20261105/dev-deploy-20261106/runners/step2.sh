# ISSUE-336 DEV deploy 2026-11-07, step 2: fresh dump of afldb_dev (read-only) + restore verification on the isolated cluster only.
set -u -o pipefail
W=/mnt/ssd/afldb/workspaces/i336-deploy-20261107
D=/mnt/ssd/afldb/backups/dev-pre-v2-$(date -u +%Y%m%dT%H%M%SZ)
echo "$D" > "$W/D"; echo "D=$D"; echo "start $(date '+%F %T %Z')"
bash "$W/scripts/dev-backup-verify.sh" dump "$D" 2>&1 | tee "$W/logs/step2-dump.log"
grep -q '^BACKUP-DUMPED$' "$W/logs/step2-dump.log" || { echo STOP-step2-dump; exit 1; }
grep -q '^ledger 110 110_' "$W/logs/step2-dump.log" || { echo "STOP-step2-ledger-not-110"; exit 1; }
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
AFLDB_V2_PG_ROOT=/mnt/ssd/afldb/workspaces/i336-preview-20261106/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499 \
  bash "$W/scripts/dev-backup-verify.sh" verify "$D" /mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout 2>&1 | tee "$W/logs/step2-verify.log"
grep -q '^BACKUP-VERIFIED$' "$W/logs/step2-verify.log" || { echo STOP-step2-verify; exit 1; }
ls -l "$D"; echo "end $(date '+%F %T %Z')"; echo STEP2-OK
