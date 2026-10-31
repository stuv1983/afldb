// Distinct staged Brownlow seasons (shadow-restore.sh S5). stdin module.
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT DISTINCT season FROM staging.afl_api_brownlow_vote ORDER BY season`;
  console.log(rows.map((r) => r.season).join(' '));
} finally { await sql.end(); }
