// READ-ONLY probe (C5 window, 2026-11-02). Reads the AFL API ingestion switch through the REAL reader
// the acquire/settle tools use, and reports the stored jsonb type. Writes nothing. Prints no DSN.
import { createRequire } from 'node:module';
const CHK = '/home/arm/projects/afldb';
const require = createRequire(`${CHK}/package.json`);
const postgres = require('postgres');
const KEY = 'acquisition.afl_api_current_season_enabled';

const mod = await import(`${CHK}/src/lib/acquisition/afl-api-ingestion-control.ts`);
const controls = await mod.readAflApiIngestionControls();
console.log('REAL READER readAflApiIngestionControls() =', JSON.stringify(controls));

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, onnotice: () => {}, transform: { undefined: null } });
try {
  const rows = await sql`SELECT jsonb_typeof(value) AS t, value::text AS txt FROM site_settings WHERE key = ${KEY}`;
  console.log('stored jsonb_typeof / text =', JSON.stringify(rows.map((r: any) => [r.t, r.txt])));
  const raw = await sql`SELECT value FROM site_settings WHERE key = ${KEY}`;
  console.log('driver hands the reader: typeof =', typeof raw[0]?.value, ' value =', JSON.stringify(raw[0]?.value));
} finally {
  await sql.end({ timeout: 5 });
}
