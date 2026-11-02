/**
 * AFLDB-ISSUE-316 C7 — READ-ONLY observer for "acceptance of the first concluded round".
 *
 *   node --import tsx tools/v2/c7-observe.ts --season 2027 --since <ISO timestamp> [--round <code>]
 *        [--expected-concluded <n>] [--unit-result <success|...> --unit-exec-status <n>]
 *        [--dsn-env DATABASE_URL] [--json]
 *
 * Reads the DSN from the named environment variable (default DATABASE_URL); it never prints it.
 * Opens ONE `read only` transaction, issues SELECTs only and rolls it back. No provider request,
 * no write, no unit start. Output is the classifier's verdict, reasons, figures and what it could
 * not measure. It does NOT record an acceptance: the owner approves the C7 criteria beforehand and
 * accepts afterwards. Exit codes: 0 MEASURED_CRITERIA_MET, 10 NO_CONCLUDED_MATCHES,
 * 11 INCOMPLETE_ACQUISITION, 12 FAILED_PROCESSING, 13 NO_BATCH, 2 usage or helper error.
 */
import postgres from 'postgres';

import {
  C7_EXIT_CODES, classifyC7, readC7Facts, type C7Facts,
} from '../../src/lib/acquisition/afl-api-c7-observation';

const USAGE = 'usage: c7-observe.ts --season <yyyy> --since <ISO timestamp> [--round <code>] [--expected-concluded <n>] [--unit-result <s> --unit-exec-status <n>] [--dsn-env NAME] [--json]';

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
  const known = new Set(['season', 'since', 'round', 'expected-concluded', 'unit-result', 'unit-exec-status', 'dsn-env']);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`unknown option --${key}\n${USAGE}`);
  const season = Number(values.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error(`--season must be a year\n${USAGE}`);
  const since = values.get('since');
  if (!since || Number.isNaN(Date.parse(since))) throw new Error(`--since must be an ISO timestamp\n${USAGE}`);
  const expectedRaw = values.get('expected-concluded');
  const expectedConcluded = expectedRaw === undefined ? null : Number(expectedRaw);
  if (expectedConcluded !== null && (!Number.isInteger(expectedConcluded) || expectedConcluded < 0)) throw new Error(`--expected-concluded must be a non-negative integer\n${USAGE}`);
  const round = values.get('round') ?? null;
  if (round !== null && expectedConcluded === null) throw new Error(`--round needs --expected-concluded\n${USAGE}`);
  const unitResult = values.get('unit-result');
  const unitExec = values.get('unit-exec-status');
  if ((unitResult === undefined) !== (unitExec === undefined)) throw new Error(`--unit-result and --unit-exec-status go together\n${USAGE}`);
  return {
    season, since: new Date(since).toISOString(), round, expectedConcluded, json,
    unit: unitResult === undefined ? null : { result: unitResult, execMainStatus: unitExec as string },
    dsnEnv: values.get('dsn-env') ?? 'DATABASE_URL',
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const dsn = process.env[args.dsnEnv];
  if (!dsn) throw new Error(`environment variable ${args.dsnEnv} is not set`);
  const sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {}, transform: { undefined: null } });
  let facts: C7Facts;
  try {
    facts = await sql.begin('read only', async (tx) => {
      const [{ ro }] = await tx<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`;
      if (ro !== 'on') throw new Error('transaction is not read only; refusing');
      return readC7Facts(tx, { season: args.season, since: args.since, round: args.round, expectedConcluded: args.expectedConcluded, unit: args.unit });
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
  const report = classifyC7(facts);
  if (args.json) {
    console.log(JSON.stringify({ ...report, exitCode: C7_EXIT_CODES[report.verdict] }, null, 2));
  } else {
    console.log(`C7 OBSERVATION (read-only) ${report.verdict}`);
    for (const reason of report.reasons) console.log(`  reason: ${reason}`);
    for (const [key, value] of Object.entries(report.figures)) console.log(`  ${key}: ${value}`);
    for (const item of report.notMeasured) console.log(`  NOT MEASURED: ${item}`);
    console.log('  This is an observation, not an acceptance: the owner accepts against the approved C7 criteria.');
  }
  return C7_EXIT_CODES[report.verdict];
}

if (process.argv[1] && /c7-observe\.ts$/.test(process.argv[1].split('\\').join('/'))) {
  main().then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(`c7-observe: ${(error as Error).message}`);
    process.exitCode = 2;
  });
}
