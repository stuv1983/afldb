import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
try { const [r] = await sql`SELECT current_database() AS db, pg_database_size(current_database())::bigint AS bytes, current_setting('transaction_read_only') AS ro`;
  console.log(JSON.stringify(r)); } finally { await sql.end(); }
