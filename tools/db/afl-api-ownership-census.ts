/**
 * AFLDB-ISSUE-233 D-233-3 — the read-only `afl_api` ownership census, as an operator command.
 *
 *   # the scope the NEXT rebuild has today (tracked contract range, in-progress excluded)
 *   npx tsx tools/db/afl-api-ownership-census.ts --database afldb_test \
 *     --dsn-env AFLDB_TEST_DATABASE_URL --out <evidence.json>
 *
 *   # the scope the rebuild will have AFTER a rollover completes <Y> (rollover evidence)
 *   npx tsx tools/db/afl-api-ownership-census.ts --database afldb_test \
 *     --dsn-env AFLDB_TEST_DATABASE_URL --through-season <Y> --out <evidence.json>
 *
 * It runs the SAME census the rebuild's `afl-api-ownership-census` stage enforces
 * (src/lib/rollover/afl-api-ownership-census.ts), in its reporting form, inside one READ ONLY
 * transaction, and prints every affected season with its count. `--out` writes the evidence
 * record `tools/db/rollover-season.ts --afl-api-ownership-census` requires; it never
 * overwrites an existing file.
 *
 * It writes nothing to any database and needs no write privilege, so it may read any
 * database the operator names, live ones included. The database is named twice — `--database`
 * and the DSN variable — and must also be what `current_database()` reports; a DSN is never
 * printed.
 *
 * Exit codes: 0 pass, 1 refuse (an in-scope `afl_api`-owned match exists), 2 the census could
 * not be run or its arguments were refused.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AflApiOwnershipCensusError, buildAflApiOwnershipCensusSql, censusRecord, censusTotal,
  describeAffected, describeScope, parseCensusOutput, rebuildCensusScope, refusalMessage,
  rolloverCensusScope, type CensusScope,
} from '../../src/lib/rollover/afl-api-ownership-census';
import { redact, runPsql, type SpawnSyncLike } from './psql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CONTRACT = 'tools/rebuild/fitzroy/fitzroy-contract.json';
const SEASONS = 'data/reference/seasons.json';

class CensusRefused extends Error {}

export type CensusArgs = {
  database: string;
  dsnEnv: string;
  throughSeason?: number;
  out?: string;
};

export function parseCensusArgs(argv: string[]): CensusArgs {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index < 0) return undefined;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new CensusRefused(`${flag} needs a value.`);
    return next;
  };
  const known = new Set(['--database', '--dsn-env', '--through-season', '--out']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i])) {
      throw new CensusRefused(`Unknown argument: ${argv[i]}. This census has no override or skip flag.`);
    }
  }
  const database = value('--database');
  const dsnEnv = value('--dsn-env');
  if (!database) throw new CensusRefused('--database is required: name the database the census reads.');
  if (!dsnEnv) throw new CensusRefused('--dsn-env is required: the variable holding that database\'s DSN.');
  const through = value('--through-season');
  if (through !== undefined && !/^\d{4}$/.test(through)) {
    throw new CensusRefused(`--through-season must be a season year, not ${JSON.stringify(through)}.`);
  }
  return {
    database, dsnEnv,
    throughSeason: through === undefined ? undefined : Number(through),
    out: value('--out'),
  };
}

/** The scope this invocation judges, from the tracked documents. */
export function censusScopeFor(
  args: Pick<CensusArgs, 'throughSeason'>,
  contract: Record<string, unknown>,
  seasons: Record<string, unknown>,
): CensusScope {
  const rebuildScope = rebuildCensusScope(contract, seasons);
  if (args.throughSeason === undefined) return rebuildScope;
  const inProgress = (seasons.in_progress_seasons ?? []) as number[];
  if (!inProgress.includes(args.throughSeason)) {
    throw new CensusRefused(
      `--through-season ${args.throughSeason} is not an in-progress season `
      + `(seasons.json: ${inProgress.join(', ') || 'none'}). It names the season a rollover is `
      + 'about to complete; without it the census judges the current rebuild scope.');
  }
  return rolloverCensusScope(rebuildScope.firstSeason, args.throughSeason, inProgress);
}

function databaseOf(dsn: string): string {
  return new URL(dsn).pathname.replace(/^\//, '');
}

function main(argv: string[]): number {
  // .env without a dotenv dependency, matching tools/db/rebuild-test.ts.
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* the variables may be supplied directly */ }

  const args = parseCensusArgs(argv);
  if (args.out && existsSync(resolve(args.out))) {
    throw new CensusRefused(`${args.out} already exists; the census never overwrites evidence.`);
  }
  const dsn = process.env[args.dsnEnv];
  if (!dsn) throw new CensusRefused(`${args.dsnEnv} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn);
  } catch {
    throw new CensusRefused(`${args.dsnEnv} is not a valid connection URL.`);
  }
  if (named !== args.database) {
    throw new CensusRefused(`${args.dsnEnv} names database '${named}', not --database '${args.database}'.`);
  }

  const scope = censusScopeFor(
    args,
    JSON.parse(readFileSync(join(REPO_ROOT, CONTRACT), 'utf8')) as Record<string, unknown>,
    JSON.parse(readFileSync(join(REPO_ROOT, SEASONS), 'utf8')) as Record<string, unknown>,
  );
  const sql = buildAflApiOwnershipCensusSql(scope, 'report');
  const run = runPsql(dsn, sql, { spawn: spawnSync as SpawnSyncLike, cwd: REPO_ROOT });
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) {
    throw new CensusRefused(`psql exited ${run.status}; no census was taken.\n${redact(run.stderr.trim())}`);
  }
  const result = parseCensusOutput(output, scope);
  if (result.database !== args.database) {
    throw new CensusRefused(
      `current_database() is '${result.database}', not --database '${args.database}'. No evidence written.`);
  }

  console.log('AFLDB-ISSUE-233 D-233-3 — afl_api ownership census (read-only)');
  console.log(`  database       ${result.database}`);
  console.log(`  scope          ${describeScope(result.scope)}`
    + (args.throughSeason !== undefined ? ` (after a rollover completing ${args.throughSeason})` : ' (the current rebuild scope)'));
  console.log(`  schema         ${result.schemaPresent ? 'present' : 'ABSENT (no canonical matches to own)'}`);
  console.log(`  in scope       ${result.inScope.length ? describeAffected(result.inScope) : 'none'}`);
  console.log(`  outside scope  ${result.outsideScope.length ? describeAffected(result.outsideScope) : 'none'} (reported only)`);

  if (args.out) {
    const record = censusRecord(result, {
      capturedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sqlSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
    writeFileSync(resolve(args.out), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(`  evidence       ${args.out}`);
  }

  if (censusTotal(result) > 0) {
    console.error(`\n${refusalMessage(result)}`);
    return 1;
  }
  console.log('\nPASS: no completed season in scope holds an afl_api-owned canonical match.');
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof CensusRefused || error instanceof AflApiOwnershipCensusError) {
      console.error(`\nCENSUS NOT TAKEN\n  ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}

export { CensusRefused };

// The rebuild runner (tools/db/rebuild-test.ts) takes the shared census definition from HERE,
// its sibling, so it stays free of any parent-relative path (its interpreter-resolution guard
// forbids one) while running exactly the SQL this command runs.
export {
  AflApiOwnershipCensusError, CENSUS_MARKER, buildAflApiOwnershipCensusSql, describeScope,
  rebuildCensusScope, type CensusScope,
} from '../../src/lib/rollover/afl-api-ownership-census';
