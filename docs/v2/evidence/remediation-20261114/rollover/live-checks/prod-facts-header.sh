set -euo pipefail
cd /home/arm/ops/gap029-stages/a25306f9/cand
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
export RV_EXPECT_DB=afldb_prod RV_EXPECT_OID=66668 RV_EXPECT_SYSID=7674454702926115004
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
