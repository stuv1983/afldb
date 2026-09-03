/**
 * AFLDB-ISSUE-099 / AFLDB-ISSUE-122 — the in-season AFL Tables settle CLI.
 *
 * Stage S-C then S-D of ISSUE-099 §21. Everything before the database is
 * offline and fail-closed: the bundle is read, the manifest it names is
 * re-hashed from disk, and the whole contract is validated. Only if all of
 * that passes is a connection opened at all, so an unverified snapshot cannot
 * reach PostgreSQL.
 *
 * REVIEW-FIRST IS THE DEFAULT. `--dry-run` needs no other flag; `--apply`
 * must be explicit.
 *
 * THE AUTOMATIC CANONICAL PATH IS EXPLICIT TOO (ISSUE-122 S6). Without
 * `--auto-apply` this tool behaves exactly as ISSUE-099 shipped it: it
 * produces observations, typed staging projections and promotion candidates
 * for a human to review, and writes no canonical row. With `--auto-apply` a
 * record whose gates E1-E6 all pass inside its own savepoint, against state
 * re-read there, becomes canonical without a human (§5.1); everything else
 * lands in the exception queue. There is no force flag and no bypass — the
 * switch decides whether the automatic path RUNS, never whether a gate may be
 * skipped.
 *
 *   --dry-run --auto-apply   runs the full automatic path — gates, canonical
 *                            writers, ledger, derived recompute — against real
 *                            constraints and role privileges, then rolls the
 *                            whole transaction back. It is the preview of
 *                            exactly what `--apply --auto-apply` would commit.
 *   --apply --auto-apply     the operational path (§19). Idempotent: a rerun
 *                            over identical source data performs no write.
 *   --report                 the §9.3 exception report, read-only.
 *
 * Nothing here is scheduled — no cron entry, no timer. Scheduling is a
 * separate authorisation (ISSUE-122 S8).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { loadManualAuthority } from '../../src/lib/acquisition/manual-authority';
import { UNAVAILABLE_MANUAL_AUTHORITY } from '../../src/lib/acquisition/observations';
import {
  resolveManifestPath,
  runSettleAfltables,
  validateSettleBundle,
  type SettleBundle,
  type SettleCounters,
  type SettleRunResult,
} from '../../src/lib/acquisition/settle-afltables';
import {
  buildSettleExceptionReport,
  renderSettleExceptionReport,
  type SettleExceptionReport,
} from '../../src/lib/acquisition/settle-report';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import {
  assessSourceCompleteness,
  renderSourceCompleteness,
  type SourceCompletenessVerdict,
} from '../../src/lib/acquisition/source-completeness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

/** Where `import_fitzroy_core.py --emit-observations` writes each snapshot. */
function bundleRootOf(projectRoot: string): string {
  return join(projectRoot, 'data', 'sources', 'afltables', 'fitzroy_core');
}

export type SettleCliArgs = {
  label: string;
  apply: boolean;
  /** ISSUE-122: run the automatic canonical path. Off unless asked for. */
  autoApply: boolean;
  report: boolean;
  /**
   * AFLDB-ISSUE-128. Make an incomplete source a FAILED run.
   *
   * The exit code is decided AFTER the transaction has committed, never
   * before: every record AFLDB could represent still lands, and the run stays
   * idempotent. What changes is only that the process — and therefore the
   * systemd unit, and therefore the admin panel — stops reporting success for
   * a pass that silently dropped rows the source supplied.
   */
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
  '--label', '--apply', '--dry-run', '--auto-apply', '--report', '--require-complete-source',
]);

export function parseSettleArgs(argv: readonly string[]): SettleCliArgs {
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    throw new Error('--apply and --dry-run are mutually exclusive; choose one.');
  }
  // An unknown flag is refused rather than ignored: a mistyped
  // `--auto-aply` silently running the review-first path would look like a
  // successful automatic run that wrote nothing.
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new Error(`Unknown flag '${arg}'.`);
    }
    if (arg === '--label') i += 1;
  }
  return {
    label,
    apply: argv.includes('--apply'),
    autoApply: argv.includes('--auto-apply'),
    report: argv.includes('--report'),
    requireCompleteSource: argv.includes('--require-complete-source'),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The bundle, validated against the manifest actually on disk, and the
 * in-progress season list the E2 gate is re-evaluated against at the write.
 *
 * The digest is recomputed here rather than trusted from the bundle, which is
 * the whole point of the check: a snapshot that changed after emission is no
 * longer evidence of what the bundle describes.
 */
function loadBundle(
  projectRoot: string, label: string,
): { bundle: SettleBundle; inProgressSeasons: number[] } {
  const raw = readJson(join(bundleRootOf(projectRoot), label, 'observations.json')) as {
    manifest_path?: unknown;
  };
  if (typeof raw.manifest_path !== 'string') {
    throw new Error('The bundle names no manifest_path, so it cannot be verified.');
  }
  // The emitter writes an ABSOLUTE path; joining it onto the root again is the
  // T8 double-prefix defect. The rule lives in the contract module.
  const manifestPath = resolveManifestPath(projectRoot, raw.manifest_path);
  const actualManifestSha256 = createHash('sha256')
    .update(readFileSync(manifestPath))
    .digest('hex');

  const seasons = readJson(join(projectRoot, 'data', 'reference', 'seasons.json')) as {
    in_progress_seasons?: unknown;
  };
  const inProgressSeasons = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];

  const registry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );

  const bundle = validateSettleBundle({
    raw,
    expectedSnapshotLabel: label,
    actualManifestSha256,
    inProgressSeasons,
    registry,
  });
  return { bundle, inProgressSeasons };
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function counterLines(counters: SettleCounters): string[] {
  const lines: string[] = [];
  const group = (title: string, keys: readonly (keyof SettleCounters)[]) => {
    lines.push('', title);
    for (const key of keys) lines.push(`  ${key}: ${counters[key]}`);
  };
  group('Snapshot', [
    'snapshotMatches', 'snapshotPlayerMatchRows', 'snapshotRejections',
    'snapshotUnkeyedRejections',
  ]);
  group('Observation', [
    'observationsSeen', 'payloadsCreated', 'payloadsReused', 'versionsAppended',
    'observationsUnchanged', 'observationsCorrected', 'observationsHistoryOnly',
    'observationsMarkedAbsent', 'observationsReappeared', 'absenceSweepSkipped',
  ]);
  group('Projection / resolution', [
    'projectionRowsWritten', 'venueUnmapped', 'nullInCoveredStat',
    'unresolvedIdentityPlayer', 'unresolvedIdentityClub', 'unresolvedIdentityVenue',
    'unresolvedIdentityMatch', 'foreignOwnedCollision', 'sourceDisagreement',
    'advisoryDisagreement', 'manualAuthorityRefusals',
  ]);
  group('Review', ['candidatesCreated', 'candidatesRefreshed', 'candidatesMootLeftPending']);
  group('Data issues', ['dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved']);
  // ISSUE-122: canonical ROWS as PostgreSQL wrote them, the ledger rows
  // beside them, the retries §9.3 keyed on target state, and the two ways an
  // offered target does not land — a gate re-read inside the savepoint, or a
  // write that rolled back. Never summed with the observation counters.
  group('Canonical (ISSUE-122)', [
    'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
    'canonicalRetryApplied', 'canonicalApplyRefusals', 'canonicalApplyFailures',
  ]);
  // ISSUE-131: identity moves, the three fail-closed refusals that stop one,
  // and the human overrides an identity move carried with it. A rekey is also
  // counted as an update above; this says how many of those updates moved the
  // rendering rather than the facts, and how many HUMAN decisions travelled.
  group('Canonical identity (ISSUE-131)', [
    'canonicalMatchesRekeyed', 'canonicalRekeyRefusals', 'canonicalOverridesCarried',
  ]);
  group('Derived recompute', ['derivedRecomputeRuns', 'derivedRecomputePlayers']);
  return lines;
}

export type SettleCliDeps = {
  /** The repository root the bundle, manifest and reference data are read under. */
  projectRoot?: string;
  /**
   * A client the CALLER owns. Supplied by tests so the run goes to the
   * database they guard; the CLI then does not end it. When omitted the
   * CLI opens `AFLDB_IMPORT_DATABASE_URL` and closes it.
   */
  sql?: postgres.Sql;
  /** Where the lines go. Defaults to stdout. */
  log?: (line: string) => void;
};

export type SettleCliOutcome = {
  args: SettleCliArgs;
  /** Null on `--report`. */
  result: SettleRunResult | null;
  /** Built after a committed apply and on `--report`; null on a dry run. */
  report: SettleExceptionReport | null;
  /**
   * AFLDB-ISSUE-128. The source-completeness verdict for this run. Null on
   * `--report`, which runs no settle and so measures no source.
   */
  sourceCompleteness: SourceCompletenessVerdict | null;
};

/**
 * The CLI, as one callable so the whole path — flag parsing, bundle
 * verification, the run, the counters and the report — can be exercised
 * end to end against `afldb_test` by the integration suite, and not only
 * from a terminal against a bundle that happens to be on disk.
 */
export async function runSettleCli(
  argv: readonly string[], deps: SettleCliDeps = {},
): Promise<SettleCliOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseSettleArgs(argv);

  // Offline and fail-closed. No database has been opened yet.
  const { bundle, inProgressSeasons } = loadBundle(projectRoot, args.label);
  log(
    `Bundle v${bundle.bundleContractVersion} '${bundle.snapshotLabel}' `
    + `(${bundle.acquisitionKind}, season ${bundle.season}, fitzRoy `
    + `${bundle.fitzroyVersion ?? 'unpinned'}) validated against its manifest.`,
  );

  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createImportClient();
  try {
    if (args.report) {
      const report = await buildSettleExceptionReport(sql, { season: bundle.season });
      for (const line of renderSettleExceptionReport(report)) log(line);
      return { args, result: null, report, sourceCompleteness: null };
    }

    const result = await runSettleAfltables(sql, {
      bundle,
      registry: parseSourceFamilyRegistry(
        readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
      ),
      apply: args.apply,
      // Only ever reached if the loader below is somehow absent. There is no
      // bypass: an un-implemented authority mechanism refuses rather than
      // permitting.
      manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
      // AFLDB-ISSUE-122 §8. The real provider, resolved from `data_overrides`
      // inside the run transaction. A query error or a broken pinned contract
      // yields refusal, not permission.
      manualAuthorityLoader: (tx) => loadManualAuthority(tx, bundle.season),
      // AFLDB-ISSUE-122 S6. The automatic path runs only when asked for, and
      // E2 is re-evaluated at the write against the same list the bundle was
      // validated against.
      autoApply: args.autoApply,
      inProgressSeasons,
    });

    for (const line of counterLines(result.counters)) log(line);

    // AFLDB-ISSUE-128. Rendered for EVERY run, dry or applied, and before the
    // outcome line below, so the verdict cannot be read as a footnote to a
    // success message.
    const sourceCompleteness = assessSourceCompleteness(result.counters);
    for (const line of renderSourceCompleteness(sourceCompleteness)) log(line);

    for (const skipped of result.absenceSweepSkipped) {
      log('');
      log(
        `Absence sweep SKIPPED for ${skipped.family} '${skipped.scopeKey}': ${skipped.reason}. `
        + 'Nothing in that scope was marked absent.',
      );
    }

    log('');
    if (!result.applied) {
      log(
        'Dry run. The full write path executed against real constraints and privileges'
        + (args.autoApply ? ', the automatic canonical path included' : '')
        + ', then the whole transaction was rolled back. Nothing was retained — not even the '
        + `import_batches row. Re-run with --apply${args.autoApply ? ' --auto-apply' : ''} `
        + 'to keep it.',
      );
      return { args, result, report: null, sourceCompleteness };
    }

    const { counters } = result;
    if (args.autoApply) {
      log(
        `Applied as import batch ${result.batchId}: ${counters.canonicalRowsInserted} canonical `
        + `row(s) inserted, ${counters.canonicalRowsUpdated} updated, `
        + `${counters.canonicalApplicationsLogged} ledger row(s), `
        + `${counters.canonicalRetryApplied} retried after resolution, `
        + `${counters.canonicalApplyRefusals} refused at the write, `
        + `${counters.canonicalApplyFailures} unit(s) rolled back. `
        + `Derived recompute ${counters.derivedRecomputeRuns === 1 ? 'ran' : 'skipped'}`
        + ` (${counters.derivedRecomputePlayers} player(s)).`,
      );
    } else {
      log(
        `Applied as import batch ${result.batchId}. No canonical row was written: the `
        + 'automatic path runs only with --auto-apply.',
      );
    }
    const report = await buildSettleExceptionReport(sql, { season: bundle.season });
    for (const line of renderSettleExceptionReport(report)) log(line);
    return { args, result, report, sourceCompleteness };
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const outcome = await runSettleCli(process.argv.slice(2));

  // AFLDB-ISSUE-128. The ONLY place the verdict becomes an exit code, and it
  // is reached after `runSettleCli()` has returned — so the transaction is
  // already committed and every representable record has landed. Failing here
  // costs no data; it costs the run its claim to have imported the season.
  //
  // `unknown` fails too. A run that recorded no counters has not shown the
  // source was covered, and "not shown" is not "shown to be fine".
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

// Run only when this file is the entry point. Importing it — as the
// integration suite does to drive `runSettleCli()` — must not start a run.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
