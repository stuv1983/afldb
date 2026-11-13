set -euo pipefail
cd /home/arm/projects/afldb
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
export RV_EXPECT_DB=afldb_dev RV_EXPECT_OID= RV_EXPECT_SYSID=
$HOME/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
