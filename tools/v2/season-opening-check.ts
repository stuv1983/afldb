/**
 * AFLDB-ISSUE-350 / ISSUE-332 gate — READ-ONLY check that the in-progress season row and the current clubs'
 * identities for that season exist in a database, judged against the tracked contract
 * (`data/reference/seasons.json`, `data/reference/clubs.json`).
 *
 *   node --import tsx tools/v2/season-opening-check.ts [--season 2027] [--dsn-env AFLDB_BACKUP_DATABASE_URL] [--json]
 *        [--expect-database N --expect-oid N --expect-sysid N]
 *
 * Reads the DSN from the named environment variable and never prints it. Opens ONE `read only` transaction
 * (REPEATABLE READ, session TimeZone pinned to Etc/UTC), issues SELECTs only and rolls it back. With
 * --expect-* the database identity is asserted before any other read.
 *
 * Exit codes: 0 OPEN (season row present as contracted; every open identity resolves for the season),
 *             10 NOT_OPEN (parts missing, nothing contradicted: the opening operation applies),
 *             11 REFUSED (the database holds something the contract does not allow: do not proceed),
 *             2 usage or helper error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

import {
  changesOf, classifyOpening, expectedOpening, readOpeningFacts, surfaceDigest,
} from '../../src/lib/rollover/season-opening';

const USAGE = 'usage: season-opening-check.ts [--season <yyyy>] [--dsn-env NAME] [--json] [--expect-database N --expect-oid N --expect-sysid N]';
export const CHECK_EXIT = { OPEN: 0, NOT_OPEN: 10, REFUSED: 11 } as const;

export function parseArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { json = true; continue; }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}\n${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value\n${USAGE}`);
    values.set(arg.slice(2), value);
    i += 1;
  }
  const known = new Set(['season', 'dsn-env', 'expect-database', 'expect-oid', 'expect-sysid']);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`unknown option --${key}\n${USAGE}`);
  const season = values.has('season') ? Number(values.get('season')) : undefined;
  if (season !== undefined && (!Number.isInteger(season) || season < 1897 || season > 2100)) throw new Error(`--season must be a year\n${USAGE}`);
  return {
    season, json, dsnEnv: values.get('dsn-env') ?? 'AFLDB_BACKUP_DATABASE_URL',
    expect: { database: values.get('expect-database'), oid: values.get('expect-oid'), sysid: values.get('expect-sysid') },
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const dsn = process.env[args.dsnEnv];
  if (!dsn) throw new Error(`environment variable ${args.dsnEnv} is not set`);
  const root = process.cwd();
  const exp = expectedOpening(
    JSON.parse(readFileSync(join(root, 'data/reference/seasons.json'), 'utf8')),
    JSON.parse(readFileSync(join(root, 'data/reference/clubs.json'), 'utf8')),
    args.season,
  );
  const sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC' } });
  try {
    const out = await sql.begin('isolation level repeatable read read only', async (tx) => {
      const [id] = await tx<Record<string, string>[]>`
        SELECT current_database() AS database, d.oid::text AS oid, c.system_identifier::text AS sysid,
               current_setting('transaction_read_only') AS ro, current_setting('TimeZone') AS tz, current_user AS "user",
               (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger
          FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
      if (id.ro !== 'on') throw new Error('transaction is not read only; refusing');
      if (id.tz !== 'Etc/UTC' && id.tz !== 'UTC') throw new Error(`session TimeZone is ${id.tz}, not Etc/UTC; refusing`);
      const { database, oid, sysid } = args.expect;
      if ((database !== undefined && id.database !== database) || (oid !== undefined && id.oid !== oid) || (sysid !== undefined && id.sysid !== sysid)) {
        throw new Error('database identity differs from the asserted identity; no further read');
      }
      const facts = await readOpeningFacts(tx, exp.year);
      return { id, facts };
    });
    const verdict = classifyOpening(exp, out.facts);
    const changes = changesOf(verdict);
    const report = {
      verdict: verdict.state, exitCode: CHECK_EXIT[verdict.state], season: exp.year,
      identity: { database: out.id.database, oid: out.id.oid, sysid: out.id.sysid, user: out.id.user, ledger: out.id.ledger },
      seasonRow: verdict.season, openIdentities: exp.open.length, clubsToChange: changes.clubIds.length, orgsToChange: changes.orgIds.length,
      problems: verdict.problems, maxYear: out.facts.maxYear,
      identityResolvedForYear: out.facts.identityForYear.filter((r) => r.club !== null).length,
      listPrevious: out.facts.listPrevious.length, listYear: out.facts.listYear.length,
      surfaceDigest: surfaceDigest(out.facts), importBatches: out.facts.batches,
    };
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`SEASON OPENING CHECK (read-only) ${exp.year}: ${report.verdict}`);
      console.log(`  database ${report.identity.database} ledger ${report.identity.ledger}; season row ${report.seasonRow}; `
        + `${report.openIdentities} open identities in the register, ${report.clubsToChange} to change, ${report.orgsToChange} organisations to change`);
      console.log(`  identity resolves for ${exp.year}: ${report.identityResolvedForYear} organisations; season lists ${exp.previousYear}: ${report.listPrevious}, ${exp.year}: ${report.listYear}`);
      for (const p of report.problems) console.log(`  problem: ${p}`);
      console.log(`  surface digest ${report.surfaceDigest}`);
    }
    return report.exitCode;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && /season-opening-check\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>') : 'check failed');
    process.exitCode = 2;
  });
}
