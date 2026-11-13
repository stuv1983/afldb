
set -uo pipefail
R=/home/arm/afldb-releases/releases/c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x
for d in "$R/.next/server/app" "$R/.next/standalone/.next/server/app" "$R/standalone/.next/server/app"; do [ -d "$d" ] && { echo "dir $d"; du -sh "$d" | cut -f1; find "$d" -type f | wc -l; A="$d"; }; done
df -h /home/arm | tail -1
if [ -n "${A:-}" ]; then
  echo "seasons non-canonical: $(ls "$A/seasons" 2>/dev/null | grep -v -E '^[0-9]{4}(\.|$)' | grep -c . )"; ls "$A/seasons" 2>/dev/null | grep -v -E '^[0-9]{4}(\.|$)' | head -5
  echo "matches non-numeric/leading-zero meta: $(ls "$A/matches" 2>/dev/null | grep -E '\.meta$' | grep -v -E '^[1-9][0-9]*\.meta$' | grep -c .)"
  echo "players meta: $(ls "$A/players" 2>/dev/null | grep -c '\.meta$'); 404-status metas under app: $(grep -rl '"status":404' "$A" --include=*.meta 2>/dev/null | wc -l)"
fi
cd /home/arm/ops/gap029-stages/a25306f9/cand
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000 } });
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    const aflw = await tx`SELECT count(*)::int AS pct, (SELECT count(*)::int FROM aflw.players) AS total FROM aflw.players WHERE slug LIKE '%\%%'`;
    console.log(JSON.stringify({ identity, aflw }));
  });
} catch (e) { console.log('ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g,'<dsn>').slice(0,300)); }
finally { await sql.end(); }
JS
# end
