// The ledger as name<TAB>checksum<LF>, ORDER BY name COLLATE "C" (the host session's digest form). stdin module.
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE "C"`;
  if (!rows.length) process.exitCode = 1;
  process.stdout.write(rows.map((r) => `${r.name}\t${r.checksum}\n`).join(''));
} finally { await sql.end(); }
