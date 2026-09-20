#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S6 — the afl_api settle CLI.
 *
 * Mirrors `tools/current-season/settle-afltables.ts`'s contract exactly
 * (§17): review-first by default, `--auto-apply` is the explicit switch for
 * the automatic canonical path, and every offline verification (manifest
 * re-hash, registry/identities parse, bundle build) happens BEFORE any
 * database connection opens.
 *
 * This tool never makes a live AFL API request — acquisition
 * (`acquire-afl-api.ts`) and settle are separate stages (§16 S2/S6); it only
 * ever reads the already-acquired snapshot named by `--label` from
 * `data/sources/afl_api/matches/<label>/` (§5.4).
 *
 *   --validate-only          manifest re-hash + registry + bundle contract;
 *                             no connection opened at all.
 *   --dry-run [--auto-apply] the full write path, rolled back.
 *   --apply [--auto-apply]   the operational path.
 *   --report                 the exception report, read-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  parseAflApiIdentities, type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  SETTLE_BATCH_TOOL,
  SETTLE_ISSUE_OWNER,
  SETTLE_ISSUE_TYPE,
  SETTLE_SOURCE_KEY,
  type AflApiSettleBundle,
  type AflApiSettleCounters,
  type AflApiSettleRunResult,
  type AflApiSettleUnitSource,
} from '../../src/lib/acquisition/settle-afl-api';
import {
  buildSettleExceptionReport,
  renderSettleExceptionReport,
  type SettleExceptionReport,
} from '../../src/lib/acquisition/settle-report';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import {
  assessSourceCompleteness,
  renderSourceCompleteness,
  type SourceCompletenessVerdict,
} from '../../src/lib/acquisition/source-completeness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function snapshotRootOf(projectRoot: string): string {
  return join(projectRoot, 'data', 'sources', 'afl_api', 'matches');
}

export type AflApiSettleCliArgs = {
  label: string;
  apply: boolean;
  autoApply: boolean;
  report: boolean;
  validateOnly: boolean;
  requireCompleteSource: boolean;
};

function loadEnv(projectRoot: string): void {
  let contents: string;
  try {
    contents = readFileSync(join(projectRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

const KNOWN_FLAGS = new Set([
  '--label', '--apply', '--dry-run', '--auto-apply', '--report',
  '--validate-only', '--require-complete-source',
]);

export function parseAflApiSettleArgs(argv: readonly string[]): AflApiSettleCliArgs {
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  const modeFlags = ['--apply', '--dry-run', '--report', '--validate-only']
    .filter((flag) => argv.includes(flag));
  if (modeFlags.length > 1) {
    throw new Error(`${modeFlags.join(' and ')} are mutually exclusive; choose one.`);
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) throw new Error(`Unknown flag '${arg}'.`);
    if (arg === '--label') i += 1;
  }
  return {
    label,
    apply: argv.includes('--apply'),
    autoApply: argv.includes('--auto-apply'),
    report: argv.includes('--report'),
    validateOnly: argv.includes('--validate-only'),
    requireCompleteSource: argv.includes('--require-complete-source'),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

type ManifestFile = { file: string; sha256: string; status?: string };

/**
 * Offline, fail-closed manifest verification (§5.4/§7.1 step 4): every file
 * the manifest names is re-hashed from disk, exactly as
 * `settle-afltables.ts`'s `loadBundle()` does for the AFL Tables snapshot. A
 * missing manifest or a hash mismatch refuses before any database connection
 * opens.
 */
function verifyManifest(snapshotDir: string): { manifest: Record<string, unknown>; files: readonly ManifestFile[] } {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json under ${snapshotDir} — the acquisition did not complete (§5.4/§7.1).`);
  }
  const manifest = readJson(manifestPath) as {
    source_key?: unknown; acquisition_kind?: unknown; season?: unknown; files?: unknown;
  };
  if (manifest.source_key !== 'afl_api') {
    throw new Error(`manifest.json names source_key '${String(manifest.source_key)}', expected 'afl_api'.`);
  }
  if (manifest.acquisition_kind === 'afl_api_fixture_snapshot') {
    throw new Error(
      `'${snapshotDir}' is a --fixtures-only acquisition (acquisition_kind `
      + "'afl_api_fixture_snapshot') and carries no player-stats.json/match-roster.json — this tool "
      + "cannot settle it. Use 'settle-afl-api-fixtures.ts --label <snapshot> --apply' instead "
      + '(AFLDB-ISSUE-228 S7 follow-up).',
    );
  }
  const files = Array.isArray(manifest.files) ? (manifest.files as ManifestFile[]) : [];
  for (const entry of files) {
    if (entry.status === 'fixture_absent') continue;
    const full = join(snapshotDir, entry.file);
    if (!existsSync(full)) throw new Error(`Manifest names '${entry.file}' but it is not on disk.`);
    const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(`'${entry.file}' has changed since acquisition (sha256 mismatch) — refusing to settle it.`);
    }
  }
  return { manifest: manifest as Record<string, unknown>, files };
}

/**
 * Discover every acquired match directory (one per `CD_M...` provider id)
 * from the manifest's own file list, rather than re-listing the directory —
 * the manifest is the one proof of what acquisition actually wrote (§5.4).
 */
function unitSourcesFrom(snapshotDir: string, files: readonly ManifestFile[]): AflApiSettleUnitSource[] {
  const matchDirs = new Set<string>();
  for (const entry of files) {
    const parts = entry.file.split('/');
    if (parts.length === 2 && parts[1] === 'fixture.json') matchDirs.add(parts[0]);
  }
  return [...matchDirs].sort().map((dir) => ({
    fixtureRaw: readJson(join(snapshotDir, dir, 'fixture.json')),
    rosterRaw: readJson(join(snapshotDir, dir, 'match-roster.json')),
    playerStatsRaw: readJson(join(snapshotDir, dir, 'player-stats.json')),
  }));
}

function loadBundle(
  projectRoot: string, label: string,
): { bundle: AflApiSettleBundle; inProgressSeasons: number[] } {
  const snapshotDir = join(snapshotRootOf(projectRoot), label);
  const { manifest, files } = verifyManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number') throw new Error('manifest.json carries no numeric season.');

  const registry: SourceFamilyRegistry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );
  const identities: AflApiIdentities = parseAflApiIdentities(
    readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
  );

  const seasons = readJson(join(projectRoot, 'data', 'reference', 'seasons.json')) as {
    in_progress_seasons?: unknown;
  };
  const inProgressSeasons = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];

  const sources = unitSourcesFrom(snapshotDir, files);
  const bundle = buildAflApiSettleBundle({ season, snapshotLabel: label, sources, registry, identities });
  return { bundle, inProgressSeasons };
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function counterLines(counters: AflApiSettleCounters): string[] {
  const lines: string[] = [];
  const group = (title: string, keys: readonly (keyof AflApiSettleCounters)[]): void => {
    lines.push('', title);
    for (const key of keys) {
      const value = counters[key];
      lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  };
  group('Snapshot', ['snapshotMatches', 'snapshotPlayerMatchRows', 'buildFailures']);
  group('Observation', [
    'observationsSeen', 'payloadsCreated', 'versionsAppended', 'observationsUnchanged',
  ]);
  group('Deferral (§7.3, T3 — informational, never a failure)', ['recordsDeferred']);
  group('Resolution / ownership', [
    'unresolvedIdentityMatch', 'unresolvedIdentityPlayer', 'foreignOwnedCollision',
    'corroboratedForeignOwned', 'sourceDisagreement', 'manualAuthorityRefusals', 'venueUnmapped',
  ]);
  group('Review', ['candidatesCreated', 'candidatesRefreshed', 'candidatesMootLeftPending']);
  group('Data issues', ['dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved']);
  group('Canonical', [
    'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
    'canonicalApplyRefusals', 'canonicalApplyFailures', 'attendanceEnrichmentsApplied',
  ]);
  group('Derived recompute', ['derivedRecomputeRuns', 'derivedRecomputePlayers']);
  return lines;
}

export type AflApiSettleCliDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
};

export type AflApiSettleCliOutcome = {
  args: AflApiSettleCliArgs;
  result: AflApiSettleRunResult | null;
  report: SettleExceptionReport | null;
  sourceCompleteness: SourceCompletenessVerdict | null;
};

/**
 * The CLI, as one callable — the same shape `settle-afltables.ts`'s
 * `runSettleCli()` uses — so the integration suite can drive it end to end
 * against `afldb_test`.
 */
export async function runAflApiSettleCli(
  argv: readonly string[], deps: AflApiSettleCliDeps = {},
): Promise<AflApiSettleCliOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseAflApiSettleArgs(argv);

  // Offline and fail-closed. No database has been opened yet.
  const { bundle, inProgressSeasons } = loadBundle(projectRoot, args.label);
  log(
    `Bundle v${bundle.bundleContractVersion} '${bundle.snapshotLabel}' (season ${bundle.season}): `
    + `${bundle.units.length} match unit(s) built, ${bundle.buildFailures.length} build failure(s).`,
  );
  for (const failure of bundle.buildFailures) {
    log(`  BUILD FAILURE ${failure.providerMatchId ?? '(unknown match)'}: ${failure.error}`);
  }

  if (args.validateOnly) {
    log('');
    log('--validate-only: manifest, registry and bundle contract verified. No connection opened.');
    return { args, result: null, report: null, sourceCompleteness: null };
  }

  const registry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );

  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createImportClient();
  try {
    if (args.report) {
      const report = await buildSettleExceptionReport(sql, {
        season: bundle.season,
        sourceKey: SETTLE_SOURCE_KEY,
        tool: SETTLE_BATCH_TOOL,
        disagreementIssueType: SETTLE_ISSUE_TYPE,
        disagreementIssueOwner: SETTLE_ISSUE_OWNER,
      });
      for (const line of renderSettleExceptionReport(report)) log(line);
      return { args, result: null, report, sourceCompleteness: null };
    }

    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: args.apply, autoApply: args.autoApply, inProgressSeasons,
    });

    if (result.halt) {
      log('');
      log(`HALT: ${result.halt.reason} — ${JSON.stringify(result.halt.detail)}`);
      log('The whole run was rolled back, including the import_batches row. Nothing was written.');
      return { args, result, report: null, sourceCompleteness: null };
    }

    for (const line of counterLines(result.counters)) log(line);

    const sourceCompleteness = assessSourceCompleteness({
      snapshotMatches: result.counters.snapshotMatches,
      snapshotPlayerMatchRows: result.counters.snapshotPlayerMatchRows,
      snapshotRejections: result.counters.unresolvedIdentityMatch + result.counters.unresolvedIdentityPlayer,
      snapshotUnkeyedRejections: result.counters.buildFailures,
      absenceSweepSkipped: 0,
      recordsDeferred: Object.values(result.counters.recordsDeferred).reduce((a, b) => a + b, 0),
    });
    for (const line of renderSourceCompleteness(sourceCompleteness)) log(line);

    log('');
    if (!result.applied) {
      log(
        'Dry run. The full write path executed against real constraints and privileges'
        + (args.autoApply ? ', the automatic canonical path included' : '')
        + ', then the whole transaction was rolled back. Nothing was retained — not even the '
        + `import_batches row. Re-run with --apply${args.autoApply ? ' --auto-apply' : ''} to keep it.`,
      );
      return { args, result, report: null, sourceCompleteness };
    }

    log(
      `Applied as import batch ${result.batchId}: ${result.counters.canonicalRowsInserted} canonical `
      + `row(s) inserted, ${result.counters.canonicalRowsUpdated} updated, `
      + `${result.counters.canonicalApplicationsLogged} ledger row(s), `
      + `${result.counters.attendanceEnrichmentsApplied} attendance enrichment(s), `
      + `${result.counters.canonicalApplyRefusals} refused at the write, `
      + `${result.counters.canonicalApplyFailures} unit(s) rolled back.`
      + (args.autoApply ? '' : ' No canonical row was written: the automatic path runs only with --auto-apply.'),
    );
    const report = await buildSettleExceptionReport(sql, {
      season: bundle.season,
      sourceKey: SETTLE_SOURCE_KEY,
      tool: SETTLE_BATCH_TOOL,
      disagreementIssueType: SETTLE_ISSUE_TYPE,
      disagreementIssueOwner: SETTLE_ISSUE_OWNER,
      deferredRecords: result.counters.recordsDeferred,
    });
    for (const line of renderSettleExceptionReport(report)) log(line);
    return { args, result, report, sourceCompleteness };
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const outcome = await runAflApiSettleCli(process.argv.slice(2));

  if (outcome.result?.halt) {
    process.exitCode = 1;
    return;
  }
  if (!outcome.args.requireCompleteSource || outcome.sourceCompleteness === null) return;
  if (outcome.sourceCompleteness.status === 'complete') return;
  console.error('');
  console.error(
    `--require-complete-source: ${outcome.sourceCompleteness.headline} `
    + 'Records that could be represented were still applied and the run remains idempotent; '
    + 'this exit code reports that the import was not complete.',
  );
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
