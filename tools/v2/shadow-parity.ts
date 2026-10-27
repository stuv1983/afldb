/**
 * AFLDB V2 Stage 6 — shadow PARITY comparison CLI (docs/v2/shadow-rehearsal.md). OFFLINE ONLY.
 *
 *   compare:
 *     npx tsx tools/v2/shadow-parity.ts compare \
 *       --manifest-before F --manifest-after F --row-counts-before F --row-counts-after F \
 *       --coleman-before F --coleman-after F \
 *       --brownlow-before F [--brownlow-before F ...] --brownlow-after F [--brownlow-after F ...] \
 *       --coverage-before F --coverage-after F --out REPORT.json [--summary SUMMARY.txt]
 *       [--policy v2.parity.2 --afl-api-before F [...] --afl-api-after F [...]]
 *
 *   The default policy is v2.parity.1 (five checks, unchanged). `--policy v2.parity.2` adds the
 *   `afl_api_reconciliation` check over the AFL API settle's `--report-out` files (V2-GAP-027);
 *   AFL API reports are refused under v2.parity.1 rather than silently ignored.
 *
 *   coverage-export  (reads data/reference/seasons.json and the registry's evidence files,
 *                     relative to the repository root = the current directory):
 *     npx tsx tools/v2/shadow-parity.ts coverage-export --out F
 *
 * This tool reads FILES only. It opens no database and no network connection and reads no
 * environment variable (in particular no DSN). Output files are created exclusively (`wx`) and
 * are never overwritten.
 *
 * Exit status: 0 PASS; 1 FAIL; 2 INCOMPLETE (an input missing, unreadable or invalid);
 * 3 ERROR (usage error, unknown flag, an output file that already exists, or a write failure).
 * `compare` writes the report whenever it can, including for FAIL and INCOMPLETE, and prints the
 * human summary.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { validateAflApiReconciliationReport } from '@afldb/acquisition';
import { COVERAGE_REGISTRY, type SeasonRegistry } from '@afldb/domain';
import {
  SHADOW_PARITY_POLICY_VERSION,
  SHADOW_PARITY_POLICY_VERSIONS,
  buildCoverageRegistryExport,
  buildShadowParityReport,
  renderShadowParitySummary,
  serialiseCoverageRegistryExport,
  serialiseShadowParityReport,
  shadowParityExitCode,
  validateShadowParityReport,
  type ShadowParityInput,
  type ShadowParityInputFile,
  type ShadowParityPolicyVersion,
} from '@afldb/derived';

import { SEASONS_REGISTRY, readRepoFile } from './coverage-matrix';

export const USAGE = [
  'usage:',
  '  shadow-parity.ts compare --manifest-before F --manifest-after F --row-counts-before F --row-counts-after F',
  '      --coleman-before F --coleman-after F --brownlow-before F [--brownlow-before F ...]',
  '      --brownlow-after F [--brownlow-after F ...] --coverage-before F --coverage-after F',
  '      --out REPORT.json [--summary SUMMARY.txt]',
  '      [--policy v2.parity.2 --afl-api-before F [--afl-api-before F ...] --afl-api-after F [--afl-api-after F ...]]',
  '  shadow-parity.ts coverage-export --out F',
  'exit codes: 0 PASS, 1 FAIL, 2 INCOMPLETE, 3 ERROR (usage, existing output file, write failure)',
];

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const SINGLE_FLAGS = [
  'manifest-before', 'manifest-after', 'row-counts-before', 'row-counts-after',
  'coleman-before', 'coleman-after', 'coverage-before', 'coverage-after', 'out', 'summary', 'policy',
] as const;
const REPEATABLE_FLAGS = ['brownlow-before', 'brownlow-after', 'afl-api-before', 'afl-api-after'] as const;

export type CliArgs =
  | {
    mode: 'compare';
    single: ReadonlyMap<string, string>;
    brownlowBefore: string[];
    brownlowAfter: string[];
    policyVersion: ShadowParityPolicyVersion;
    aflApiBefore: string[];
    aflApiAfter: string[];
  }
  | { mode: 'coverage-export'; out: string };

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'compare' && mode !== 'coverage-export') throw new CliUsageError('the first argument must be compare or coverage-export');
  const allowedSingle = new Set<string>(mode === 'compare' ? SINGLE_FLAGS : ['out']);
  const allowedRepeatable = new Set<string>(mode === 'compare' ? REPEATABLE_FLAGS : []);
  const single = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new CliUsageError(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    if (!allowedSingle.has(name) && !allowedRepeatable.has(name)) throw new CliUsageError(`unknown option ${arg}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--') || value === '') throw new CliUsageError(`${arg} needs a value`);
    i += 1;
    if (allowedRepeatable.has(name)) {
      repeated.set(name, [...(repeated.get(name) ?? []), value]);
    } else {
      if (single.has(name)) throw new CliUsageError(`${arg} given twice`);
      single.set(name, value);
    }
  }
  const out = single.get('out');
  if (!out) throw new CliUsageError(`${mode} needs --out <file>`);
  if (mode === 'coverage-export') return { mode, out };
  const summary = single.get('summary');
  if (summary !== undefined && summary === out) throw new CliUsageError('--summary must differ from --out');
  const policy = single.get('policy') ?? SHADOW_PARITY_POLICY_VERSION;
  if (!(SHADOW_PARITY_POLICY_VERSIONS as readonly string[]).includes(policy)) {
    throw new CliUsageError(`--policy must be one of ${SHADOW_PARITY_POLICY_VERSIONS.join(', ')}`);
  }
  const policyVersion = policy as ShadowParityPolicyVersion;
  const aflApiBefore = repeated.get('afl-api-before') ?? [];
  const aflApiAfter = repeated.get('afl-api-after') ?? [];
  if (policyVersion === 'v2.parity.1' && (aflApiBefore.length > 0 || aflApiAfter.length > 0)) {
    throw new CliUsageError('--afl-api-before/--afl-api-after are compared only under --policy v2.parity.2');
  }
  return {
    mode,
    single,
    brownlowBefore: repeated.get('brownlow-before') ?? [],
    brownlowAfter: repeated.get('brownlow-after') ?? [],
    policyVersion,
    aflApiBefore,
    aflApiAfter,
  };
}

export interface CliDeps {
  /** Reads a file as UTF-8 text; throws when it cannot be read. */
  readonly readFile: (path: string) => string;
  readonly exists: (path: string) => boolean;
  /** Creates a file exclusively (`wx`); throws when it exists or cannot be written. */
  readonly writeExclusive: (path: string, text: string) => void;
  /** The ISO-8601 UTC instant stamped into outputs. */
  readonly now: () => string;
  /** The repository root `coverage-export` reads relative to. */
  readonly repoRoot: string;
}

export const defaultDeps = (): CliDeps => ({
  readFile: (path) => readFileSync(path, 'utf8'),
  exists: (path) => existsSync(path),
  writeExclusive: (path, text) => writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' }),
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  repoRoot: process.cwd(),
});

export interface CliResult {
  readonly code: 0 | 1 | 2 | 3;
  readonly lines: string[];
}

const errorResult = (message: string, usage = false): CliResult => ({
  code: 3,
  lines: [`ERROR: ${message}`, ...(usage ? USAGE : [])],
});

/** Fixed message by error class: a write failure never echoes a path from the operating system. */
function writeFailure(path: string, error: unknown): CliResult {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EEXIST') return errorResult(`${basename(path)} already exists; outputs are never overwritten`);
  return errorResult(`could not write ${basename(path)}${typeof code === 'string' ? ` (${code})` : ''}`);
}

function readOne(deps: CliDeps, path: string): ShadowParityInputFile {
  try {
    return { label: basename(path), text: deps.readFile(path) };
  } catch {
    return { label: basename(path), text: null };
  }
}

const readInput = (deps: CliDeps, path: string | undefined): ShadowParityInput => (path === undefined ? null : readOne(deps, path));
const readInputs = (deps: CliDeps, paths: readonly string[]): ShadowParityInputFile[] => paths.map((path) => readOne(deps, path));

/** The testable entry point. Never throws for operational failures; returns exit code 3 instead. */
export function runCli(argv: readonly string[], deps: CliDeps = defaultDeps()): CliResult {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) return errorResult(error.message, true);
    throw error;
  }

  if (args.mode === 'coverage-export') {
    if (deps.exists(args.out)) return errorResult(`${basename(args.out)} already exists; outputs are never overwritten`);
    let seasons: SeasonRegistry;
    try {
      seasons = JSON.parse(readRepoFile(deps.repoRoot, SEASONS_REGISTRY) ?? '') as SeasonRegistry;
    } catch {
      return errorResult(`could not read ${SEASONS_REGISTRY} under the repository root`);
    }
    let exported;
    try {
      exported = buildCoverageRegistryExport({
        producedAt: deps.now(),
        registry: COVERAGE_REGISTRY,
        seasons,
        readFile: (path) => readRepoFile(deps.repoRoot, path),
      });
    } catch (error) {
      return errorResult(`the coverage registry could not be exported: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
    try {
      deps.writeExclusive(args.out, serialiseCoverageRegistryExport(exported));
    } catch (error) {
      return writeFailure(args.out, error);
    }
    const lines = [`coverage registry export written: ${basename(args.out)} (${exported.cells.length} cells)`];
    if (exported.registryProblems.length > 0) {
      lines.push(`WARNING: ${exported.registryProblems.length} registry problem(s) recorded in the export; a compare will FAIL on them`);
    }
    return { code: 0, lines };
  }

  const out = args.single.get('out') as string;
  const summaryPath = args.single.get('summary');
  for (const path of [out, summaryPath]) {
    if (path !== undefined && deps.exists(path)) return errorResult(`${basename(path)} already exists; outputs are never overwritten`);
  }
  const pick = (name: string): ShadowParityInput => readInput(deps, args.single.get(name));
  let report;
  try {
    report = buildShadowParityReport({
      manifest: { before: pick('manifest-before'), after: pick('manifest-after') },
      rowCounts: { before: pick('row-counts-before'), after: pick('row-counts-after') },
      coleman: { before: pick('coleman-before'), after: pick('coleman-after') },
      brownlow: { before: readInputs(deps, args.brownlowBefore), after: readInputs(deps, args.brownlowAfter) },
      coverage: { before: pick('coverage-before'), after: pick('coverage-after') },
      aflApi: { before: readInputs(deps, args.aflApiBefore), after: readInputs(deps, args.aflApiAfter) },
    }, deps.now(), args.policyVersion === 'v2.parity.2'
      ? { policyVersion: args.policyVersion, validateAflApiReport: validateAflApiReconciliationReport }
      : {});
  } catch (error) {
    return errorResult(`the parity report could not be built: ${error instanceof Error ? error.message : 'unknown failure'}`);
  }
  const problems = validateShadowParityReport(JSON.parse(serialiseShadowParityReport(report)));
  if (problems.length > 0) return errorResult(`internal error: the parity report failed its own validator (${problems[0]})`);

  const summaryLines = renderShadowParitySummary(report);
  try {
    deps.writeExclusive(out, serialiseShadowParityReport(report));
  } catch (error) {
    return writeFailure(out, error);
  }
  const lines = [...summaryLines, `report written: ${basename(out)}`];
  if (summaryPath !== undefined) {
    try {
      deps.writeExclusive(summaryPath, `${summaryLines.join('\n')}\n`);
      lines.push(`summary written: ${basename(summaryPath)}`);
    } catch (error) {
      return { code: 3, lines: [...lines, ...writeFailure(summaryPath, error).lines] };
    }
  }
  return { code: shadowParityExitCode(report.verdict), lines };
}

if (process.argv[1] && /shadow-parity\.ts$/.test(process.argv[1])) {
  const { code, lines } = runCli(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exit(code);
}
