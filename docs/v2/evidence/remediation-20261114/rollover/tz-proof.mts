// AFLDB-ISSUE-350 (review O-3 / ISSUE-349): why the opening tools pin TimeZone=Etc/UTC on every connection.
// Reads the same surface three ways and prints the digests: pinned to Etc/UTC (what every tool here does), unpinned (the database/role default,
// Australia/Melbourne in production), and explicitly pinned to Australia/Melbourne. The pinned digest must be identical on a UTC cluster and on a
// Melbourne-default cluster; an unpinned session moves the digest whenever a timestamptz is on the surface. READ ONLY; no DSN is printed.
//   node --import tsx <this> <dsn-env>
import postgres from 'postgres';

import { readOpeningFacts, surfaceDigest } from '../../../../../src/lib/rollover/season-opening';

const dsn = process.env[process.argv[2] ?? 'AFLDB_BACKUP_DATABASE_URL'];
if (!dsn) { console.error('no DSN'); process.exit(2); }
async function digestWith(connection: Record<string, string>): Promise<{ tz: string; digest: string }> {
  const sql = postgres(dsn as string, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: 'true', ...connection } });
  try {
    return await sql.begin('isolation level repeatable read read only', async (tx) => {
      const [{ tz }] = await tx<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
      return { tz, digest: surfaceDigest(await readOpeningFacts(tx, 2027)) };
    });
  } finally { await sql.end({ timeout: 5 }); }
}
const pinned = await digestWith({ TimeZone: 'Etc/UTC' });
const unpinned = await digestWith({});
const melbourne = await digestWith({ TimeZone: 'Australia/Melbourne' });
console.log(JSON.stringify({ pinned, unpinned, melbourne, pinnedEqualsUnpinned: pinned.digest === unpinned.digest, pinnedEqualsMelbourne: pinned.digest === melbourne.digest }));
