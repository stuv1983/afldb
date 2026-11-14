// Aggregates only: does the template hold the existing canonical match the ISSUE-276 suite refuses on?
import { createRequire } from 'node:module';
const require = createRequire('/mnt/ssd/afldb-rem3-stateb-20261114/cand/package.json');
const postgres = require('postgres');
const sql = postgres(new URL(process.env.AFLDB_TEST_DATABASE_URL).toString(), { max: 1, onnotice: () => {}, connect_timeout: 10 });
try {
  const [r] = await sql`SELECT current_database() AS db,
    (SELECT count(*) FROM matches WHERE match_key LIKE '2026|PF|2026-09-19|Hawthorn|Brisbane Lions')::int AS pf_rows,
    (SELECT id FROM matches WHERE match_key LIKE '2026|PF|2026-09-19|Hawthorn|Brisbane Lions' LIMIT 1)::int AS pf_id`;
  console.log(JSON.stringify(r));
} finally { await sql.end({ timeout: 2 }); }
