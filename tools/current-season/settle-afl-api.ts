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
 *   --report-out <file>      with --dry-run / --apply: also write the machine-readable
 *                             `afldb.v2.afl-api-reconciliation-report` (V2-GAP-027). The file
 *                             is validated and created exclusively BEFORE any connection opens
 *                             and is never overwritten. A report that cannot be written never
 *                             undoes or hides the settle's outcome (exit 3 when that is the
 *                             only failure).
 */
import {
  closeSync, fsyncSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  buildAflApiReconciliationReport,
  serialiseAflApiReconciliationReport,
  validateAflApiReconciliationReport,
} from '@afldb/acquisition';

import { proveAflApiIngestionPreflight } from '../../src/lib/acquisition/afl-api-ingestion-safety';
import {
  parseAflApiIdentities, type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
import { AFL_API_MATCH_ABSENCE_ISSUE_TYPE } from '../../src/lib/acquisition/afl-api-match-absence';
import {
  assessAflApiSeasonEnumeration,
  describeAflApiSeasonEnumeration,
} from '../../src/lib/acquisition/afl-api-season-enumeration';
import {
  aflApiSeasonFeedTextFrom,
  aflApiSnapshotManifestSha256,
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
import { type AflApiIngestionControls } from '../../src/lib/acquisition/afl-api-ingestion-control';
import { SETTING_KEYS } from '../../src/lib/site-settings';
// I244-F029: the shared loader, which honours AFLDB_SKIP_DOTENV so a variable
// this unit's `UnsetEnvironment=` stripped is not read straight back in.
import { loadEnv } from './load-env';
// V2-GAP-006: the seal on historical seasons (docs/v2/historical-baseline.md §2).
import { refuseSealedSeasonForSettle } from './settle-season-seal';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export type AflApiSettleCliArgs = {
  label: string;
  apply: boolean;
  autoApply: boolean;
  report: boolean;
  validateOnly: boolean;
  requireCompleteSource: boolean;
  /** V2-GAP-027: where to write the reconciliation report, as given; null when not requested. */
  reportOut: string | null;
};

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

const KNOWN_FLAGS = new Set([
  '--label', '--apply', '--dry-run', '--auto-apply', '--report',
  '--validate-only', '--require-complete-source', '--report-out',
]);
const VALUE_FLAGS = new Set(['--label', '--report-out']);

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
    if (VALUE_FLAGS.has(arg)) i += 1;
  }
  let reportOut: string | null = null;
  if (argv.includes('--report-out')) {
    if (argv.indexOf('--report-out') !== argv.lastIndexOf('--report-out')) throw new Error('--report-out given twice.');
    reportOut = valueFor(argv, '--report-out');
    if (!reportOut || reportOut.startsWith('--')) throw new Error('--report-out needs a file path.');
    // The report records a settle RUN; --validate-only and --report open no transaction.
    if (argv.includes('--validate-only') || argv.includes('--report')) {
      throw new Error('--report-out applies only to --dry-run or --apply.');
    }
  }
  return {
    label,
    apply: argv.includes('--apply'),
    autoApply: argv.includes('--auto-apply'),
    report: argv.includes('--report'),
    validateOnly: argv.includes('--validate-only'),
    requireCompleteSource: argv.includes('--require-complete-source'),
    reportOut,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Also AFLDB-ISSUE-252's source for the provider census a player bridge must cover (D-252-13). */
export function loadAflApiSettleBundle(
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
  // AFLDB-ISSUE-231: the whole retained feed, assessed. A snapshot without one
  // gets the builder's incomplete default, which authorises nothing.
  const seasonFeedText = aflApiSeasonFeedTextFrom(snapshotDir, files);
  const seasonIdentity = identities.seasons.get(season);
  const seasonFeed = seasonFeedText === null || seasonIdentity === undefined
    ? undefined
    : assessAflApiSeasonEnumeration(seasonFeedText, {
      season, compSeasonProviderId: seasonIdentity.providerId,
    });
  const bundle = buildAflApiSettleBundle({
    season, snapshotLabel: label, sources, registry, identities, seasonFeed,
  });
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
  group('Season feed (AFLDB-ISSUE-231 — informational, never a failure)', [
    'seasonFeedMatches', 'seasonFeedComplete', 'seasonFeedStatusCounts',
  ]);
  group('Observation', [
    'observationsSeen', 'payloadsCreated', 'versionsAppended', 'observationsUnchanged',
  ]);
  group('Deferral (§7.3, T3 — informational, never a failure)', ['recordsDeferred']);
  group('Participation (AFLDB-ISSUE-255 — informational, never a failure)', ['nonParticipantPlayerRows']);
  group('Resolution / ownership', [
    'unresolvedIdentityMatch', 'unresolvedIdentityPlayer', 'foreignOwnedCollision',
    'corroboratedForeignOwned', 'sourceDisagreement', 'manualAuthorityRefusals',
    // I244-F003: kept as two counters, not one. `venueProviderUnmapped` is the
    // provider's own CD_V missing from afl-api-identities.json.venues;
    // `venueUnmapped` is a mapped legacy_name with no matching venues row.
    // Both now block auto-apply (see settle-afl-api.ts); a zero on both is
    // required before "every venue identity resolved" is a true statement.
    'venueProviderUnmapped', 'venueUnmapped',
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

/* ------------------------------------------------------------------ *
 * V2-GAP-027: the reconciliation report (packages/acquisition/src/reconciliation-report.ts)
 * ------------------------------------------------------------------ */

function manifestSha256(projectRoot: string, label: string): string {
  return aflApiSnapshotManifestSha256(join(aflApiSnapshotRoot(projectRoot), label));
}

/** An exclusively created, still empty report file; released by `write` or `abandon`. */
type ReportDestination = { path: string; fd: number };

/**
 * Validates `--report-out` and creates the file exclusively, BEFORE any connection opens: the
 * parent must be an existing directory, the path must lie outside the acquired snapshots (which
 * are evidence and never written by a settle) and must not exist. Throws on any refusal.
 */
function reserveReportDestination(projectRoot: string, reportOut: string): ReportDestination {
  const path = resolve(reportOut);
  const fromSnapshots = relative(resolve(aflApiSnapshotRoot(projectRoot)), path);
  if (fromSnapshots === '' || (!fromSnapshots.startsWith('..') && !isAbsolute(fromSnapshots))) {
    throw new Error(`--report-out '${reportOut}' lies inside the acquired AFL API snapshots; write the report elsewhere.`);
  }
  let parentIsDirectory = false;
  try {
    parentIsDirectory = statSync(dirname(path)).isDirectory();
  } catch {
    parentIsDirectory = false;
  }
  if (!parentIsDirectory) throw new Error(`--report-out '${reportOut}': the parent directory does not exist.`);
  try {
    return { path, fd: openSync(path, 'wx') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new Error(`--report-out '${reportOut}' already exists; reports are never overwritten.`);
    throw new Error(`--report-out '${reportOut}' cannot be created${typeof code === 'string' ? ` (${code})` : ''}.`);
  }
}

/** Closes and removes a reservation the run never filled. Best effort: it must not mask the run's own error. */
function abandonReportDestination(destination: ReportDestination): void {
  try { closeSync(destination.fd); } catch { /* already closed */ }
  try { unlinkSync(destination.path); } catch { /* left for the operator; it is empty or partial */ }
}

export type AflApiReconciliationReportOutcome = {
  path: string;
  written: boolean;
  /** Why the report was not written; null when it was. */
  error: string | null;
};

/**
 * Builds, validates and writes the report for a settle run that has already finished. Never
 * throws: by now the run's transaction outcome is known (committed, rolled back or HALTed) and a
 * file failure must neither undo nor hide it.
 */
function writeReconciliationReport(
  destination: ReportDestination,
  input: {
    bundle: AflApiSettleBundle;
    manifestSha256: string;
    args: AflApiSettleCliArgs;
    result: AflApiSettleRunResult;
    exceptions: SettleExceptionReport | null;
    now: () => string;
  },
  log: (line: string) => void,
): AflApiReconciliationReportOutcome {
  const { result } = input;
  const settled = result.applied
    ? `the settle committed import batch ${result.batchId} and that commit stands`
    : 'the settle retained nothing, exactly as reported above';
  try {
    const report = buildAflApiReconciliationReport({
      generatedAt: input.now(),
      mode: input.args.apply ? 'apply' : 'dry_run',
      bundle: input.bundle,
      manifestSha256: input.manifestSha256,
      run: result,
      exceptions: input.exceptions,
    });
    const text = serialiseAflApiReconciliationReport(report);
    const problems = validateAflApiReconciliationReport(JSON.parse(text));
    if (problems.length > 0) throw new Error(`the report failed its own validator (${problems[0]})`);
    writeFileSync(destination.fd, text, 'utf8');
    fsyncSync(destination.fd);
    closeSync(destination.fd);
    log(`Reconciliation report written: ${destination.path}`);
    return { path: destination.path, written: true, error: null };
  } catch (error) {
    abandonReportDestination(destination);
    const code = (error as NodeJS.ErrnoException | null)?.code;
    const reason = typeof code === 'string' ? code : error instanceof Error ? error.message : 'unknown failure';
    log(`RECONCILIATION REPORT NOT WRITTEN (${reason}): ${destination.path}. The run itself is unaffected: ${settled}.`);
    return { path: destination.path, written: false, error: reason };
  }
}

export type AflApiSettleCliDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
  /** Test-only escape hatch for the super-admin ingestion gate below; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
  /** The ISO-8601 UTC instant stamped into a `--report-out` report; defaults to the clock. */
  now?: () => string;
};

export type AflApiSettleCliOutcome = {
  args: AflApiSettleCliArgs;
  result: AflApiSettleRunResult | null;
  report: SettleExceptionReport | null;
  sourceCompleteness: SourceCompletenessVerdict | null;
  /** V2-GAP-027: present exactly when `--report-out` was given and the run finished. */
  reconciliationReport?: AflApiReconciliationReportOutcome;
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
  let loadedManifestSha256: string | null = null;
  if (args.reportOut !== null) {
    try {
      loadedManifestSha256 = manifestSha256(projectRoot, args.label);
    } catch {
      loadedManifestSha256 = null; // the verification below reports the missing or unreadable manifest
    }
  }
  const { bundle, inProgressSeasons } = loadAflApiSettleBundle(projectRoot, args.label);
  log(
    `Bundle v${bundle.bundleContractVersion} '${bundle.snapshotLabel}' (season ${bundle.season}): `
    + `${bundle.units.length} match unit(s) built, ${bundle.buildFailures.length} build failure(s).`,
  );
  for (const failure of bundle.buildFailures) {
    log(`  BUILD FAILURE ${failure.providerMatchId ?? '(unknown match)'}: ${failure.error}`);
  }
  log(describeAflApiSeasonEnumeration(bundle.seasonFeed));
  for (const gap of bundle.seasonFeed.gaps) log(`  SEASON FEED ${gap.reason}: ${gap.detail}`);

  if (args.validateOnly) {
    log('');
    log('--validate-only: manifest, registry and bundle contract verified. No connection opened.');
    return { args, result: null, report: null, sourceCompleteness: null };
  }

  // V2-GAP-006 (docs/v2/historical-baseline.md §1-§2): the seal on historical seasons. The season is
  // the snapshot manifest's; this runs AFTER the offline verification above and BEFORE any database
  // client is created. A settle is not an audited correction, so none is ever passed.
  // --report is read-only diagnostics and stays allowed for a sealed season.
  if (!args.report) refuseSealedSeasonForSettle(projectRoot, bundle.season);

  // Test-only gate overrides retain the pre-connection refusal contract. The
  // production path proves the live control/writer database identity below.
  if (!args.report && deps.ingestionControls && !deps.ingestionControls.currentSeasonEnabled) {
    throw new Error(
      `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}'). `
      + 'A super admin must enable it from /admin/current-season before this tool will write anything.',
    );
  }

  const registry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );

  // V2-GAP-027: the snapshot's identity and the report file are settled offline, before any
  // connection opens. The manifest is hashed again here, after its verification, and must not
  // have moved since the bundle was built from it.
  let reportDestination: ReportDestination | null = null;
  let reportManifestSha256 = '';
  if (args.reportOut !== null) {
    reportManifestSha256 = manifestSha256(projectRoot, args.label);
    if (reportManifestSha256 !== loadedManifestSha256) {
      throw new Error('manifest.json changed while the snapshot was being verified; refusing to settle it.');
    }
    reportDestination = reserveReportDestination(projectRoot, args.reportOut);
  }
  const now = deps.now ?? (() => new Date().toISOString());
  const finished = (outcome: AflApiSettleCliOutcome): AflApiSettleCliOutcome => {
    if (reportDestination === null || outcome.result === null) return outcome;
    const reconciliationReport = writeReconciliationReport(reportDestination, {
      bundle, manifestSha256: reportManifestSha256, args, result: outcome.result,
      exceptions: outcome.report, now,
    }, log);
    reportDestination = null;
    return { ...outcome, reconciliationReport };
  };

  const ownsClient = deps.sql === undefined;
  let sql: postgres.Sql;
  try {
    sql = deps.sql ?? createImportClient();
  } catch (error) {
    if (reportDestination !== null) abandonReportDestination(reportDestination);
    throw error;
  }
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

    const preflight = deps.ingestionControls
      ? null
      : await proveAflApiIngestionPreflight(sql);
    const ingestionControls = deps.ingestionControls ?? preflight!.controls;
    if (!ingestionControls.currentSeasonEnabled) {
      throw new Error(
        `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}'). `
        + 'A super admin must enable it from /admin/current-season before this tool will write anything.',
      );
    }
    if (preflight) {
      log(`AFL API ingestion preflight: control database = ${preflight.control.database}, `
        + `writer database = ${preflight.writer.database}.`);
    }

    const result = await runSettleAflApi(sql, {
      bundle, registry, apply: args.apply, autoApply: args.autoApply, inProgressSeasons,
      requireCompleteSource: args.requireCompleteSource,
    });

    if (result.halt) {
      log('');
      log(`HALT: ${result.halt.reason} — ${JSON.stringify(result.halt.detail)}`);
      log('The whole run was rolled back, including the import_batches row. Nothing was written.');
      if (result.absenceFindings !== null) {
        // AFLDB-ISSUE-231 D-231-3: the one write that outlives an absence HALT.
        const { opened, alreadyOpen, notRecorded } = result.absenceFindings;
        log(
          `Absence findings (${AFL_API_MATCH_ABSENCE_ISSUE_TYPE}, separate transaction): `
          + `${opened.length} opened, ${alreadyOpen.length} already open (first detection kept), `
          + `${notRecorded.length} not recorded (spine row moved).`,
        );
        for (const id of opened) log(`  OPENED ${id}`);
        for (const id of alreadyOpen) log(`  STILL OPEN ${id}`);
        for (const id of notRecorded) log(`  NOT RECORDED ${id}`);
        log(
          'The season stays halted until each disappearance is acknowledged with '
          + 'tools/current-season/acknowledge-afl-api-match-absence.ts, or the provider lists the id again.',
        );
      }
      return finished({ args, result, report: null, sourceCompleteness: null });
    }

    const sourceCompleteness = result.sourceCompleteness ?? assessSourceCompleteness({
      snapshotMatches: result.counters.snapshotMatches,
      snapshotPlayerMatchRows: result.counters.snapshotPlayerMatchRows,
      snapshotRejections: result.counters.unresolvedIdentityMatch + result.counters.unresolvedIdentityPlayer,
      snapshotUnkeyedRejections: result.counters.buildFailures,
      absenceSweepSkipped: 0,
      recordsDeferred: Object.values(result.counters.recordsDeferred).reduce((a, b) => a + b, 0),
    });

    if (result.rollbackReason === 'require_complete_source') {
      for (const line of renderSourceCompleteness(sourceCompleteness)) log(line);
      log('');
      log(
        `COMPLETENESS GATE REFUSED COMMIT: ${sourceCompleteness.headline} `
        + 'The entire transaction was rolled back: no canonical rows, source observations, projections, '
        + 'or import_batches row were retained.',
      );
      return finished({ args, result, report: null, sourceCompleteness });
    }

    for (const line of counterLines(result.counters)) log(line);
    for (const line of renderSourceCompleteness(sourceCompleteness)) log(line);

    log('');
    if (!result.applied) {
      log(
        'Dry-run rollback. The full write path executed against real constraints and privileges'
        + (args.autoApply ? ', the automatic canonical path included' : '')
        + ', then the whole transaction was rolled back. Nothing was retained — not even the '
        + `import_batches row. Re-run with --apply${args.autoApply ? ' --auto-apply' : ''} to keep it.`,
      );
      return finished({ args, result, report: null, sourceCompleteness });
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
    let report: SettleExceptionReport;
    try {
      report = await buildSettleExceptionReport(sql, {
        season: bundle.season,
        sourceKey: SETTLE_SOURCE_KEY,
        tool: SETTLE_BATCH_TOOL,
        disagreementIssueType: SETTLE_ISSUE_TYPE,
        disagreementIssueOwner: SETTLE_ISSUE_OWNER,
        deferredRecords: result.counters.recordsDeferred,
      });
    } catch (error) {
      // V2-GAP-027: the batch is already committed; record that known outcome (with no exception
      // section) before the read failure propagates exactly as it always has.
      finished({ args, result, report: null, sourceCompleteness });
      throw error;
    }
    for (const line of renderSettleExceptionReport(report)) log(line);
    return finished({ args, result, report, sourceCompleteness });
  } catch (error) {
    if (reportDestination !== null) abandonReportDestination(reportDestination);
    throw error;
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
  if (outcome.result?.rollbackReason === 'require_complete_source') {
    process.exitCode = 1;
    return;
  }
  // V2-GAP-027: the run finished as logged, but its requested report is missing.
  if (outcome.reconciliationReport?.written === false) process.exitCode = 3;
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
