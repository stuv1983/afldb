
set -euo pipefail
echo "caddy: $(caddy version 2>&1 | head -1)"
stat -c '%U:%G %a %n' /var/log/caddy/*.log 2>&1 | head -6 || true
id -nG
if [ -r /etc/caddy/Caddyfile ]; then echo "installed Caddyfile readable; log-block lines:"; grep -n -A6 -E '^\s*log\b' /etc/caddy/Caddyfile | grep -v -i -E 'secret|token|password' | head -30; echo "sha256 installed=$(sha256sum /etc/caddy/Caddyfile | cut -c1-16)"; else echo "installed Caddyfile not readable"; fi
for f in /var/log/caddy/*access*.log; do [ -r "$f" ] && echo "$f readable by arm: magic=$(grep -c '/beta/verify?token=' "$f") invite=$(grep -c '/admin/invite/' "$f")" || echo "$f not readable by arm"; done
cd /home/arm/ops/gap029-stages/a25306f9/cand
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000 } });
const out = {};
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro, now()::text AS at FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    out.identity = identity;
    out.grid_audience = await tx`SELECT value FROM site_settings WHERE key = 'grid_solver.audience'`;
    out.nl = await tx`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE question ~* '(^|[^t] )least\M' AND question !~* '\mat least\M')::int AS bare_least,
        count(*) FILTER (WHERE question ~* '\ma quarter\M')::int AS a_quarter,
        count(*) FILTER (WHERE question ~* '(most|least|fewest|highest).*(showdown|anzac|derby)')::int AS ranked_marquee,
        min(at)::date::text AS since FROM nl_search_log`;
  });
  console.log(JSON.stringify(out));
} catch (e) { console.log('ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g,'<dsn>').slice(0,300)); }
finally { await sql.end(); }
JS
# end
