/**
 * AFLDB-ISSUE-093 §20 — READ-ONLY catalog fingerprint of `afldb_test`.
 *
 *     npm run db:test:fingerprint
 *     npm run db:test:fingerprint -- --expect <sha256>
 *
 * This exists to answer one question after an unexpected reset-proof outcome: is the
 * database still exactly what it was before? It computes the SAME digest the rollback-only
 * proof computes — `tools/db/catalog-fingerprint.ts`, one implementation, no copy — and
 * compares it with a digest recorded earlier.
 *
 * It cannot change anything, and that is enforced three ways rather than promised:
 *
 *   1. the only SQL it can reach is tools/db/catalog-fingerprint.ts — SELECTs and pure
 *      functions. It never calls runPsql, never references RESET_SQL, and spawns nothing.
 *      (It does import `assertRebuildTargetName`/`databaseOf` from the orchestrator: two
 *      pure string functions, so this tool points at exactly one database like every other
 *      entry point, rather than carrying a weaker copy of that contract.)
 *   2. the session is put into `default_transaction_read_only = on` before any query, so
 *      the SERVER rejects a write even if one were somehow issued;
 *   3. a DB-free test asserts (1) and (2) and that this module names no reset path.
 *
 * A match proves no reset committed: RESET_SQL drops schemas, tables, views, sequences,
 * routines and types, every one of which the fingerprint covers. RESET_SQL performs no
 * DML at all, so row contents are not part of what needs proving here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  collectSections, fingerprintOf, type Row,
} from './catalog-fingerprint';
import { assertRebuildTargetName, databaseOf } from './rebuild-test';

const REPO_ROOT = process.cwd();

/** Enforced by the server, not merely by intent. */
export const READ_ONLY_SQL = 'SET default_transaction_read_only = on';

export const IDENTITY_SQL = `
SELECT current_database() AS database, current_user AS role_name`;

export class FingerprintRefused extends Error {}

export function parseArgs(argv: string[]): { expect?: string } {
  const out: { expect?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--expect') {
      const value = argv[++i];
      if (!value || !/^[0-9a-f]{64}$/.test(value)) {
        throw new FingerprintRefused(
          '--expect needs a 64-character lowercase sha256 digest.');
      }
      out.expect = value;
    } else {
      throw new FingerprintRefused(`Unknown argument: ${argv[i]}`);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  // .env without a dotenv dependency, matching tools/db/rebuild-test.ts and tests/setup.ts.
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* CI supplies the variables directly */ }

  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) {
    throw new FingerprintRefused('AFLDB_TEST_DATABASE_URL is not set.');
  }
  let database: string;
  try {
    database = databaseOf(dsn);
  } catch {
    throw new FingerprintRefused('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }
  // The rebuild's own target contract, imported. Read-only or not, this tool points at
  // exactly one database.
  assertRebuildTargetName(database);

  const postgres = (await import('postgres')).default;
  const sql = postgres(dsn, {
    max: 1,
    onnotice: () => {},
    connection: { application_name: 'afldb-fingerprint' },
  });

  console.log('AFLDB read-only catalog fingerprint (AFLDB-ISSUE-093 §20)');
  console.log('  mode          : READ-ONLY — no DDL, no DML, no reset path, no psql');

  try {
    const query = (text: string): Promise<Row[]> =>
      sql.unsafe(text).then((rows) => rows as unknown as Row[]);

    await query(READ_ONLY_SQL);
    const identity = (await query(IDENTITY_SQL))[0];
    if (identity?.database !== 'afldb_test') {
      throw new FingerprintRefused(
        `Connected to '${String(identity?.database)}', not 'afldb_test'.`);
    }
    console.log(`  database      : ${String(identity.database)}`);
    console.log(`  role          : ${String(identity.role_name)}`);

    const sections = await collectSections(query);
    const fingerprint = fingerprintOf(sections);

    console.log(`\n  fingerprint   : ${fingerprint.overall}`);
    console.log(`  schemas ${sections.schemas.length}   relations ${sections.relations.length}`
      + `   routines ${sections.routines.length}   types ${sections.types.length}`);
    console.log(`  extensions ${sections.extensions.length}`
      + `   extension-owned objects ${sections.extension_members.length}`);
    console.log(`  migrations    : ${sections.migrations[0]}`);

    if (!opts.expect) {
      console.log('\nNo --expect given, so nothing was compared. Record this digest.');
      return 0;
    }
    if (fingerprint.overall === opts.expect) {
      console.log(`\n  expected      : ${opts.expect}`);
      console.log('\nMATCH — the database is byte-identical, by catalog fingerprint, to the');
      console.log('state that digest was taken from. No reset committed.');
      return 0;
    }
    console.log(`\n  expected      : ${opts.expect}`);
    console.log('\nMISMATCH — this database is NOT in the state that digest was taken from.');
    console.log('Drifted sections (contents are never printed):');
    for (const [id, rows] of Object.entries(sections)) {
      console.log(`    ${id.padEnd(20)} ${String(rows.length).padStart(6)} rows now`);
    }
    console.log('\nDo NOT run the rebuild. Establish what changed before anything else.');
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && /fingerprint-test\.ts$/.test(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof FingerprintRefused
        ? `REFUSED: ${error.message}`
        : error);
      process.exit(1);
    });
}
