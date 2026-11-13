#!/bin/bash
# ISSUE-352 read-only production backup-readiness probe. No sudo, no state change. DB part uses the host's backup DSN
# (read on the host, never printed), read-only transaction, identity asserted first; aggregates only.
set -u
echo "=== unit files (afldb*)"; systemctl list-unit-files --no-pager 'afldb*' 2>&1
echo "=== settle timer + service"; systemctl cat afldb-settle-afl-api.timer afldb-settle-afl-api.service --no-pager 2>&1 | grep -v '^\s*$' | head -80
echo "=== all timers"; systemctl list-timers --all --no-pager 2>&1
echo "=== arm crontab / cron.d / linger"; crontab -l 2>&1 | head -5; ls /etc/cron.d /etc/cron.daily 2>&1; loginctl show-user arm -p Linger 2>&1
echo "=== backups dir"; ls -la --time-style=long-iso /home/arm/backups/afldb 2>&1 | head -30; du -sh /home/arm/backups/afldb 2>&1
echo "=== disk"; df -h / /home 2>&1
echo "=== tools present"; for t in pg_dump pg_restore psql rsync scp sha256sum rclone age gpg flock nice ionice systemd-analyze; do printf '%s: ' "$t"; command -v $t || echo absent; done
systemctl --version | head -1; pg_dump --version 2>&1
echo "=== serving checkout backup scripts present"; ls -la /home/arm/projects/afldb/tools/maintenance/backup.sh /home/arm/projects/afldb/tools/maintenance/restore-test.sh 2>&1; git -C /home/arm/projects/afldb rev-parse --short HEAD 2>&1
echo "=== env var NAMES in serving .env (no values)"; sed -n 's/^\(AFLDB_[A-Z_]*\)=.*/\1/p' /home/arm/projects/afldb/.env 2>&1 | sort | tr '\n' ' '; echo
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
cd /home/arm/ops/gap029-stages/a25306f9/cand
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000 } });
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    const dbs = await tx`SELECT datname, pg_database_size(datname)::bigint::text AS bytes, pg_catalog.shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE NOT datistemplate ORDER BY datname`;
    const [ver] = await tx`SELECT current_setting('server_version') AS v`;
    const role = await tx`SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS su, pg_has_role(current_user,'pg_read_all_data','member') AS rad`;
    const [last] = await tx`SELECT max(name) AS ledger FROM afldb_meta.schema_migrations`;
    console.log(JSON.stringify({ identity, dbs, ver: ver.v, role, ledger: last.ledger }));
  });
} catch (e) { console.log('ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g,'<dsn>').slice(0,300)); }
finally { await sql.end(); }
JS
echo END
