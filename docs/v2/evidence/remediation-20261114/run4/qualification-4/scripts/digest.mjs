// remediation run 4, scope `qual`, P1 (informational, beyond the brief's counts): per public base table, "<table> <TAB> <count> <TAB> <md5>" where the md5 is over the
// sorted text of every row's jsonb with every timestamp/timestamptz column removed (so a different load time is not a difference). Read-only.
//   node --import tsx tools/v2/isolated-pg.ts run <db> -- node $IN/digest.mjs <outfile>      (cwd = a checkout with node_modules)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2];
const req = createRequire(resolve(process.cwd(), 'package.json'));
const postgres = req('postgres');
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 10 });
const lines = [];
try {
  await sql`SET default_transaction_read_only = on`;
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`;
  for (const { table_name: t } of tables) {
    const q = `SELECT count(*)::text AS n, md5(coalesce(string_agg(x, E'\\n' ORDER BY x), '')) AS h FROM (
      SELECT (to_jsonb(r) - coalesce((SELECT array_agg(a.attname::text) FROM pg_attribute a WHERE a.attrelid = 'public."${t}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid IN ('timestamptz'::regtype, 'timestamp'::regtype)), ARRAY[]::text[]))::text AS x FROM public."${t}" r) s`;
    const [row] = await sql.unsafe(q);
    lines.push(`${t}\t${row.n}\t${row.h}`);
  }
} finally { await sql.end({ timeout: 2 }); }
writeFileSync(out, lines.join('\n') + '\n');
console.log(`digest: ${lines.length} tables -> ${out}`);
