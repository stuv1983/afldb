/**
 * AFLDB V2 Stage 2 — historical baseline manifest CLI (docs/v2/historical-manifest-spec.md).
 *
 *   compare  (offline, no database):
 *     npx tsx tools/v2/historical-manifest.ts compare <before.json> <after.json> [--out <report.json>]
 *
 *   produce  (reads a database read-only; NEVER RUN IN LAUNCH A, plan §7 R-007):
 *     npx tsx tools/v2/historical-manifest.ts produce --dsn-env <VARIABLE> --out <manifest.json>
 *         [--pin-columns <earlier-manifest.json>]
 *         [--read-only-source --i-understand-this-reads-a-non-test-database]   (non-_test only)
 *
 * Exit status: 0 sealed scope identical / manifest written; 1 reconciliation required;
 * 2 refused or invalid input. Output files are created exclusively and never overwritten.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  ManifestProducerRefusal,
  NON_TEST_CONFIRMATION_FLAG,
  READ_ONLY_SOURCE_FLAG,
  produceManifest,
  resolveProducerTarget,
  type ManifestRow,
} from '@afldb/db';
import {
  ManifestFormatError,
  compareManifests,
  comparisonExitCode,
  parseManifest,
  renderComparison,
  sealedSeasonsFrom,
  type ManifestComparison,
  type SeasonRegistry,
} from '@afldb/domain';

/** Read relative to the repository root, like tools/db/rollover-season.ts. */
export const SEASONS_REGISTRY = 'data/reference/seasons.json';

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export type CliArgs =
  | { mode: 'compare'; before: string; after: string; out: string | null }
  | {
    mode: 'produce'; dsnEnv: string | null; out: string; pinColumns: string | null;
    readOnlySource: boolean; confirmNonTest: boolean;
  };

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [mode, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const valued = new Set(['--out', '--dsn-env', '--pin-columns']);
  const bare = new Set([READ_ONLY_SOURCE_FLAG, NON_TEST_CONFIRMATION_FLAG]);
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (valued.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new CliUsageError(`${arg} needs a value`);
      if (flags.has(arg)) throw new CliUsageError(`${arg} given twice`);
      flags.set(arg, value);
      i += 1;
    } else if (bare.has(arg)) {
      flags.set(arg, true);
    } else if (arg.startsWith('--')) {
      throw new CliUsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const str = (name: string): string | null => {
    const v = flags.get(name);
    return typeof v === 'string' ? v : null;
  };
  if (mode === 'compare') {
    if (positional.length !== 2) throw new CliUsageError('compare needs exactly two manifest files');
    if (flags.has('--dsn-env') || flags.has('--pin-columns') || flags.has(READ_ONLY_SOURCE_FLAG) || flags.has(NON_TEST_CONFIRMATION_FLAG)) {
      throw new CliUsageError('compare takes no database options; it never connects');
    }
    return { mode, before: positional[0], after: positional[1], out: str('--out') };
  }
  if (mode === 'produce') {
    if (positional.length) throw new CliUsageError('produce takes no positional arguments');
    const out = str('--out');
    if (!out) throw new CliUsageError('produce needs --out <manifest.json>');
    return {
      mode,
      dsnEnv: str('--dsn-env'),
      out,
      pinColumns: str('--pin-columns'),
      readOnlySource: flags.get(READ_ONLY_SOURCE_FLAG) === true,
      confirmNonTest: flags.get(NON_TEST_CONFIRMATION_FLAG) === true,
    };
  }
  throw new CliUsageError('usage: historical-manifest.ts compare <before> <after> [--out f] | produce --dsn-env VAR --out f');
}

function writeExclusive(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

/** Offline comparison of two manifest files. No database, no network. */
export function runCompare(beforePath: string, afterPath: string, outPath: string | null): { code: 0 | 1; comparison: ManifestComparison; lines: string[] } {
  if (outPath && existsSync(outPath)) throw new CliUsageError('the --out file already exists; reports are never overwritten');
  const before = parseManifest(readFileSync(beforePath, 'utf8'), 'the before manifest');
  const after = parseManifest(readFileSync(afterPath, 'utf8'), 'the after manifest');
  const comparison = compareManifests(before, after);
  if (outPath) writeExclusive(outPath, comparison);
  return { code: comparisonExitCode(comparison), comparison, lines: renderComparison(comparison) };
}

async function runProduce(args: Extract<CliArgs, { mode: 'produce' }>): Promise<number> {
  const target = resolveProducerTarget(args, process.env);
  if (existsSync(args.out)) throw new CliUsageError('the --out file already exists; manifests are never overwritten');
  const pinned = args.pinColumns ? parseManifest(readFileSync(args.pinColumns, 'utf8'), 'the --pin-columns manifest') : undefined;
  const registry = JSON.parse(readFileSync(SEASONS_REGISTRY, 'utf8')) as SeasonRegistry;
  const sealed = sealedSeasonsFrom(registry);

  console.log('AFLDB V2 historical baseline manifest — READ ONLY (session + transaction), rolled back');
  console.log(`  target   : database '${target.database}' from ${target.variable}${target.nonTestSource ? ' (NON-TEST source, read-only flags given)' : ''}`);
  console.log(`  sealed   : ${sealed.from}-${sealed.through}${sealed.open.length ? `, open ${sealed.open.join(', ')}` : ''}`);

  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env[target.variable] as string, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 15,
    connection: { application_name: 'afldb-v2-historical-manifest', default_transaction_read_only: true },
  });
  try {
    const manifest = await produceManifest(
      (statement) => sql.unsafe(statement).then((rows) => rows as unknown as ManifestRow[]),
      { sealed, readOnlySource: target.nonTestSource, pinned },
    );
    writeExclusive(args.out, manifest);
    const buckets = manifest.tables.reduce((n, t) => n + t.buckets.length, 0);
    console.log(`  written  : ${args.out} (${manifest.tables.length} tables, ${buckets} buckets; counts and digests only)`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.mode === 'compare') {
    console.log('AFLDB V2 historical baseline comparison — offline, no database contact');
    const { code, lines } = runCompare(args.before, args.after, args.out);
    for (const line of lines) console.log(line);
    return code;
  }
  return runProduce(args);
}

if (process.argv[1] && /historical-manifest\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      const known = error instanceof CliUsageError || error instanceof ManifestProducerRefusal || error instanceof ManifestFormatError;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${known ? 'REFUSED' : 'FAILED'}: ${message}`);
      console.error('Nothing was written to any database.');
      process.exit(2);
    });
}
