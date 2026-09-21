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
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  parseAflApiIdentities, type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
import {
  aflApiSnapshotRoot,
  aflApiUnitSourcesFrom,
  verifyAflApiSnapshotManifest,
} from '../../src/lib/acquisition/afl-api-snapshot';
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
import {
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '../../src/lib/acquisition/afl-api-ingestion-control';
import { SETTING_KEYS } from '../../src/lib/site-settings';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

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

function loadBundle(
  projectRoot: string, label: string,
): { bundle: AflApiSettleBundle; inProgressSeasons: number[] } {
  const snapshotDir = join(aflApiSnapshotRoot(projectRoot), label);
  const { manifest, files } = verifyAflApiSnapshotManifest(snapshotDir);
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

  const sources = aflApiUnitSourcesFrom(snapshotDir, files);
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
  /** Test-only escape hatch for the super-admin ingestion gate below; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
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

  // AFLDB-ISSUE-228 follow-up (§C, §E, §F) — the super-admin ingestion
  // switch, checked before the write-capable path (`--apply`/`--dry-run`)
  // but NOT for `--report`, which is read-only diagnostics (§F: a disabled
  // switch must not block status/reporting). Fail closed: a missing row or
  // an unreadable database reads as disabled.
  if (!args.report) {
    const ingestionControls = deps.ingestionControls ?? await readAflApiIngestionControls();
    if (!ingestionControls.currentSeasonEnabled) {
      throw new Error(
        `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}'). `
        + 'A super admin must enable it from /admin/current-season before this tool will write anything.',
      );
    }
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
