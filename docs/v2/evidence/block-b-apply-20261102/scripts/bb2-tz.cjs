// prints only the session TimeZone and role for the backup and owner DSNs (values of the DSN never printed)
const fs = require('fs'); const { createRequire } = require('module');
const req = createRequire('/home/arm/projects/afldb/package.json'); const postgres = req('postgres');
(async () => {
  const env = fs.readFileSync('/home/arm/projects/afldb/.env', 'utf8').split('\n');
  for (const key of ['AFLDB_BACKUP_DATABASE_URL', 'AFLDB_OWNER_DATABASE_URL']) {
    const l = env.filter((x) => x.startsWith(key + '='));
    if (l.length !== 1) { console.log(key, 'not exactly once'); process.exit(2); }
    const sql = postgres(l[0].slice(key.length + 1).replace(/^"(.*)"$/, '$1'), { max: 1, connection: { default_transaction_read_only: 'on' } });
    const [r] = await sql`SELECT current_user AS u, current_database() AS d, current_setting('TimeZone') AS tz, (SELECT setconfig::text FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0) AS dbset`;
    console.log('prod session', JSON.stringify(r)); await sql.end({ timeout: 2 });
  }
})().catch((e) => { console.error('tz probe failed:', e.message); process.exit(1); });
