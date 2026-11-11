// W-346 database probe. Reads the DSN from AFLDB_OWNER_DATABASE_URL (set by isolated-pg run); never prints it.
// node fp.mjs <clone> facts|sentinel <token>|tamper
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const [clone, mode, arg] = process.argv.slice(2);
const postgres = createRequire(`${clone}/package.json`)('postgres');
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
try {
  const [f] = await sql`SELECT current_database() AS db, current_setting('port') AS port,
    current_setting('listen_addresses') AS listen, current_setting('cluster_name') AS cluster`;
  const writeOk = f.db.endsWith('_test') && f.listen === '127.0.0.1' && f.port === process.env.AFLDB_V2_ISOLATED_PORT;
  if (mode !== 'facts' && !writeOk) { console.error(`REFUSED write: ${JSON.stringify(f)}`); process.exit(3); }
  if (mode === 'sentinel') {
    await sql`CREATE TABLE i346_sentinel (token text NOT NULL)`;
    await sql`INSERT INTO i346_sentinel VALUES (${arg})`;
  } else if (mode === 'tamper') {
    await sql`UPDATE afldb_meta.schema_migrations SET checksum = repeat('0', 64)
               WHERE name = (SELECT min(name) FROM afldb_meta.schema_migrations)`;
  }
  const [{ has }] = await sql`SELECT to_regclass('afldb_meta.schema_migrations') IS NOT NULL AS has`;
  const ledger = has ? await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE "C"` : [];
  const tables = await sql`SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`;
  const sentinel = tables.some((r) => r.t === 'public.i346_sentinel')
    ? (await sql`SELECT string_agg(token, ',') AS s FROM i346_sentinel`)[0].s : null;
  const lines = ledger.map((r) => `${r.name} ${r.checksum}`);
  console.log(JSON.stringify({ ...f, writeGuard: writeOk, ledgerN: ledger.length, ledgerLast: ledger.at(-1)?.name ?? null,
    ledgerHash: h(lines.join('\n')), ledger117Hash: h(lines.slice(0, 117).join('\n')),
    lastChecksum: ledger.at(-1)?.checksum ?? null, tableCount: tables.length, tablesHash: h(tables.map((r) => r.t).join('\n')), sentinel }));
} finally {
  await sql.end({ timeout: 5 });
}
