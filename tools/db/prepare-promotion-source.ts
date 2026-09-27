/**
 * AFLDB-ISSUE-252 — promotion-source preparation (runbook §21.2, D-252-2/7/8).
 *
 * After `db:test:rebuild` and before the source dependency gate, settle the in-progress season
 * into `afldb_test` from named, retained, hash-bound snapshots, in the ownership-preserving
 * order: the retained AFL Tables settle first (first writer, `afltables`-owned, as on PROD),
 * then the retained AFL API settle, which corroborates and never re-owns.
 *
 * Orchestration and guards only. Every write is made by the unmodified settle CLIs
 * (`runSettleCli()`, `runAflApiSettleCli()`), in-process, on ONE import session whose
 * `current_database()` has been proved. No network acquisition exists anywhere in this path,
 * and the AFL API ingestion switch is read, never written (D-252-7). The AFL API fixtures-only
 * and Brownlow settles are deliberately NOT part of preparation (D-252-9a/9b).
 *
 *   DATABASE_URL="$AFLDB_TEST_DATABASE_URL" AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_IMPORT_DATABASE_URL" \
 *     npm run db:promotion:prepare-source -- --acknowledge afldb_test \
 *       --afltables-label <label> --expect-afltables-manifest-sha256 <hex> \
 *       --expect-afltables-bundle-sha256 <hex> \
 *       --afl-api-label <label> --expect-afl-api-manifest-sha256 <hex> \
 *       (--validate-only | --dry-run | --apply --record-out <new file>)
 *
 * --validate-only  offline only: both snapshots verified, no connection opened.
 * --dry-run        an UNPROVEN PREVIEW (Q-252-11): also proves the database and runs the AFL
 *                  Tables settle as a rolled-back dry run. On a fresh afldb_test it carries the
 *                  same transient `unresolvedIdentityMatch` as the first apply and is judged the
 *                  same way (bounded by `canonicalRowsInserted`; everything else strict). It
 *                  writes no record and no proof, and is never promotion-source evidence. The
 *                  AFL API step is not dry-run here: before the AFL Tables apply commits, its
 *                  result would describe first-writer inserts, not corroboration.
 * --apply          AFL Tables apply (Q-252-10: `unresolvedIdentityMatch` alone may be non-zero,
 *                  provisionally); then the mandatory same-label AFL Tables closure dry run, which
 *                  must be all zero with no write; then an AFL API dry run whose post-conditions
 *                  must pass before the AFL API apply; then the record, carrying both AFL Tables
 *                  results separately.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  aflApiSnapshotManifestSha256,
  aflApiSnapshotRoot,
  verifyAflApiSnapshotManifest,
} from '../../src/lib/acquisition/afl-api-snapshot';
import {
  proveAflApiIngestionPreflight,
  type AflApiIngestionPreflight,
} from '../../src/lib/acquisition/afl-api-ingestion-safety';
import {
  resolveManifestPath,
  SETTLE_ACQUISITION_KIND,
  validateSettleBundle,
} from '../../src/lib/acquisition/settle-afltables';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import { loadEnv } from '../current-season/load-env';
import { runAflApiSettleCli, type AflApiSettleCliOutcome } from '../current-season/settle-afl-api';
import { runSettleCli, type SettleCliOutcome } from '../current-season/settle-afltables';
import { environmentNames } from './promotion-inventory';
import {
  PREPARATION_RECORD_KIND,
  PREPARATION_RECORD_SCHEMA_VERSION,
  AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER,
  afltablesClosureDryRunProblems,
  afltablesFirstApplyProblems,
  afltablesPreviewDryRunProblems,
  aflTablesStepEvidence,
  PREPARATION_PREVIEW_STATUS,
  preexistingSeasonOwnershipProblems,
  preparationDatabaseProblems,
  retainedSnapshotProblems,
  settleStepProblems,
  type AflApiSnapshotBinding,
  type AflTablesSnapshotBinding,
  type SettleStepSummary,
} from './promotion-source-dependencies';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export { PREPARATION_RECORD_KIND, PREPARATION_RECORD_SCHEMA_VERSION };

/** The one database preparation may write. */
const SOURCE_DATABASE = environmentNames('prod').source;

const AFLTABLES_SNAPSHOT_ROOT = join('data', 'sources', 'afltables', 'fitzroy_core');
const AFLTABLES_MANIFEST_ROOT = join('docs', 'rebuild-manifests', 'afltables_fitzroy_core');
/** A label is a single path segment, never a path: the same shape `acquire_core.R` writes. */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type PrepareMode = 'validate-only' | 'dry-run' | 'apply';

export type PrepareArgs = {
  afltablesLabel: string;
  afltablesManifestSha256: string;
  afltablesBundleSha256: string;
  aflApiLabel: string;
  aflApiManifestSha256: string;
  mode: PrepareMode;
  recordOut: string | null;
};

const VALUE_FLAGS = [
  '--acknowledge', '--afltables-label', '--expect-afltables-manifest-sha256',
  '--expect-afltables-bundle-sha256', '--afl-api-label', '--expect-afl-api-manifest-sha256',
  '--record-out',
] as const;
const MODE_FLAGS = ['--validate-only', '--dry-run', '--apply'] as const;

export function parsePrepareArgs(argv: readonly string[]): PrepareArgs {
  const values = new Map<string, string>();
  const modes: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      if (values.has(arg)) throw new Error(`${arg} was given twice.`);
      values.set(arg, value);
      i += 1;
    } else if ((MODE_FLAGS as readonly string[]).includes(arg)) {
      modes.push(arg);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }
  if (values.get('--acknowledge') !== SOURCE_DATABASE) {
    throw new Error(`--acknowledge ${SOURCE_DATABASE} is required: preparation writes that database and no other.`);
  }
  if (modes.length !== 1) throw new Error(`Exactly one of ${MODE_FLAGS.join(', ')} is required.`);
  const mode = modes[0].slice(2) as PrepareMode;
  const required = (flag: (typeof VALUE_FLAGS)[number]): string => {
    const value = values.get(flag);
    if (!value) throw new Error(`${flag} is required.`);
    return value;
  };
  const afltablesLabel = required('--afltables-label');
  const aflApiLabel = required('--afl-api-label');
  for (const [flag, label] of [['--afltables-label', afltablesLabel], ['--afl-api-label', aflApiLabel]]) {
    if (!LABEL.test(label)) throw new Error(`${flag} '${label}' is not a snapshot label.`);
  }
  const recordOut = values.get('--record-out') ?? null;
  if (mode === 'apply' && !recordOut) throw new Error('--apply requires --record-out <new file>.');
  if (mode !== 'apply' && recordOut) throw new Error('--record-out is written by --apply only.');
  return {
    afltablesLabel,
    afltablesManifestSha256: required('--expect-afltables-manifest-sha256'),
    afltablesBundleSha256: required('--expect-afltables-bundle-sha256'),
    aflApiLabel,
    aflApiManifestSha256: required('--expect-afl-api-manifest-sha256'),
    mode,
    recordOut,
  };
}

// ---------------------------------------------------------------------------
// Offline, source-specific verification of the retained inputs
// ---------------------------------------------------------------------------

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJsonObject(path: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a JSON object');
  return raw as Record<string, unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inProgressSeasonsOf(projectRoot: string): number[] {
  const seasons = readJsonObject(join(projectRoot, 'data', 'reference', 'seasons.json'));
  return Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((y): y is number => typeof y === 'number')
    : [];
}

export type AflTablesVerifyDeps = {
  /** The settle's own offline bundle gate; injectable so a DB-free test need not build a real bundle. */
  validateBundle?: (projectRoot: string, raw: unknown, label: string, actualManifestSha256: string) => void;
};

/** `validateSettleBundle()` exactly as `settle-afltables.ts`'s `loadBundle()` calls it. */
function validateAflTablesBundle(projectRoot: string, raw: unknown, label: string, actualManifestSha256: string): void {
  validateSettleBundle({
    raw,
    expectedSnapshotLabel: label,
    actualManifestSha256,
    inProgressSeasons: inProgressSeasonsOf(projectRoot),
    registry: parseSourceFamilyRegistry(
      JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')),
    ),
  });
}

/**
 * The AFL Tables input, in its own established layout (never rewritten):
 *   manifest  docs/rebuild-manifests/afltables_fitzroy_core/<label>.json — hash-binds the CSVs
 *   CSVs      <manifest.working_directory>/<files[].filename>, which must be the label's own dir
 *   bundle    data/sources/afltables/fitzroy_core/<label>/observations.json — NOT in the
 *             manifest, so bound by its own recorded sha256, and it must name this manifest
 * The bundle's `manifest_path` must resolve to THIS checkout's manifest: that is the file the
 * settle re-hashes, so a bundle naming another checkout's copy is refused, not trusted.
 */
export function verifyAflTablesRetainedSnapshot(
  projectRoot: string, label: string, expectedManifestSha256: string, expectedBundleSha256: string,
  deps: AflTablesVerifyDeps = {},
): AflTablesSnapshotBinding & { integrityProblems: string[] } {
  const problems: string[] = [];
  const manifestPath = join(projectRoot, AFLTABLES_MANIFEST_ROOT, `${label}.json`);
  const snapshotDir = join(projectRoot, AFLTABLES_SNAPSHOT_ROOT, label);
  const bundlePath = join(snapshotDir, 'observations.json');
  let actualManifestSha256 = '';
  let actualBundleSha256 = '';
  let season: number | null = null;

  if (!existsSync(manifestPath)) {
    problems.push(`no manifest at ${join(AFLTABLES_MANIFEST_ROOT, `${label}.json`)}`);
  } else {
    actualManifestSha256 = sha256File(manifestPath);
    try {
      const manifest = readJsonObject(manifestPath);
      if (manifest.snapshot_label !== label) problems.push(`manifest snapshot_label is '${String(manifest.snapshot_label)}'`);
      if (manifest.mode !== 'acquire') problems.push(`manifest mode is '${String(manifest.mode)}', not 'acquire'`);
      if (manifest.acquisition_kind !== SETTLE_ACQUISITION_KIND) {
        problems.push(`manifest acquisition_kind is '${String(manifest.acquisition_kind)}', not '${SETTLE_ACQUISITION_KIND}'`);
      }
      const inSeason = manifest.in_season as Record<string, unknown> | undefined;
      season = typeof inSeason?.season === 'number' ? inSeason.season : null;
      if (season === null) problems.push('manifest in_season.season is missing');
      const workingDir = typeof manifest.working_directory === 'string' ? manifest.working_directory : '';
      if (normalize(workingDir) !== normalize(join(AFLTABLES_SNAPSHOT_ROOT, label))) {
        problems.push(`manifest working_directory '${workingDir}' is not the label's snapshot directory`);
      }
      const files = Array.isArray(manifest.files) ? manifest.files as { filename?: unknown; sha256?: unknown }[] : [];
      if (files.length === 0) problems.push('manifest names no files');
      for (const entry of files) {
        const name = typeof entry.filename === 'string' ? entry.filename : '';
        if (!LABEL.test(name)) { problems.push(`manifest names an invalid file '${String(entry.filename)}'`); continue; }
        const full = join(snapshotDir, name);
        if (!existsSync(full)) problems.push(`manifest names '${name}' but it is not on disk`);
        else if (sha256File(full) !== entry.sha256) problems.push(`'${name}' has changed since acquisition (sha256 mismatch)`);
      }
    } catch (error) {
      problems.push(`manifest unreadable: ${message(error)}`);
    }
  }

  if (!existsSync(bundlePath)) {
    problems.push(`no observations.json under ${join(AFLTABLES_SNAPSHOT_ROOT, label)}`);
  } else {
    actualBundleSha256 = sha256File(bundlePath);
    try {
      const bundle = readJsonObject(bundlePath);
      if (bundle.snapshot_label !== label) problems.push(`observations.json snapshot_label is '${String(bundle.snapshot_label)}'`);
      if (bundle.manifest_sha256 !== actualManifestSha256) problems.push('observations.json names a different manifest digest');
      if (bundle.season !== season) problems.push(`observations.json season ${String(bundle.season)} is not the manifest's ${String(season)}`);
      const named = typeof bundle.manifest_path === 'string' && bundle.manifest_path
        ? resolveManifestPath(resolve(projectRoot), bundle.manifest_path) : null;
      if (named === null || resolve(named) !== resolve(manifestPath)) {
        problems.push(`observations.json manifest_path '${String(bundle.manifest_path)}' is not this checkout's manifest`);
      }
      if (problems.length === 0 && season !== null) {
        (deps.validateBundle ?? validateAflTablesBundle)(projectRoot, bundle, label, actualManifestSha256);
      }
    } catch (error) {
      problems.push(`observations.json refused: ${message(error)}`);
    }
  }

  return {
    source: 'afltables', label, season,
    expectedManifestSha256, actualManifestSha256,
    expectedBundleSha256, actualBundleSha256,
    integrityProblems: problems,
  };
}

/**
 * The AFL API input, in its own established layout (never rewritten):
 *   data/sources/afl_api/matches/<label>/manifest.json, beside the payloads it hash-binds.
 * Verified by the settle's own shared reader, so a fixtures-only snapshot is refused here too.
 */
export function verifyAflApiRetainedSnapshot(
  projectRoot: string, label: string, expectedManifestSha256: string,
): AflApiSnapshotBinding & { integrityProblems: string[] } {
  const snapshotDir = join(aflApiSnapshotRoot(projectRoot), label);
  const problems: string[] = [];
  let actualManifestSha256 = '';
  let season: number | null = null;
  try {
    actualManifestSha256 = aflApiSnapshotManifestSha256(snapshotDir);
    const { manifest } = verifyAflApiSnapshotManifest(snapshotDir);
    season = typeof manifest.season === 'number' ? manifest.season : null;
    if (season === null) problems.push('manifest.json carries no numeric season');
  } catch (error) {
    problems.push(message(error));
  }
  return { source: 'afl_api', label, season, expectedManifestSha256, actualManifestSha256, integrityProblems: problems };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type PrepareDeps = {
  projectRoot?: string;
  /** The ONE import session every step writes through. */
  sql?: postgres.Sql;
  env?: Partial<Record<string, string | undefined>>;
  log?: (line: string) => void;
  now?: () => Date;
  verifyAflTables?: typeof verifyAflTablesRetainedSnapshot;
  verifyAflApi?: typeof verifyAflApiRetainedSnapshot;
  prove?: (sql: postgres.Sql, env: Partial<Record<string, string | undefined>>) => Promise<AflApiIngestionPreflight>;
  readSeasonOwnership?: (sql: postgres.Sql, season: number) => Promise<{ owner_source_key: string | null; matches: number }[]>;
  settleAfltables?: (argv: readonly string[], deps: Parameters<typeof runSettleCli>[1]) => Promise<SettleCliOutcome>;
  settleAflApi?: (argv: readonly string[], deps: Parameters<typeof runAflApiSettleCli>[1]) => Promise<AflApiSettleCliOutcome>;
  writeRecord?: (path: string, text: string) => void;
};

export type PrepareOutcome = {
  mode: PrepareMode;
  /**
   * What the run established. Only `prepared` (a written record, after the closure dry run) is
   * promotion-source evidence; `preview-unproven` (Q-252-11) and `offline-verified` never are.
   */
  status: 'offline-verified' | 'preview-unproven' | 'prepared';
  season: number;
  steps: SettleStepSummary[];
  record: Record<string, unknown> | null;
};

function refuse(title: string, problems: readonly string[]): never {
  throw new Error(`${title}\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

async function readSeasonOwnershipLive(sql: postgres.Sql, season: number) {
  return sql<{ owner_source_key: string | null; matches: number }[]>`
    SELECT s.key AS owner_source_key, count(*)::int AS matches
      FROM matches m
      LEFT JOIN sources s ON s.id = m.source_id
     WHERE m.season = ${season}
     GROUP BY s.key
     ORDER BY s.key NULLS FIRST
  `;
}

function afltablesStep(mode: 'dry-run' | 'apply', outcome: SettleCliOutcome): SettleStepSummary {
  return {
    source: 'afltables', mode, halt: null, rollbackReason: null,
    completeness: outcome.sourceCompleteness?.status ?? null,
    applied: outcome.result?.applied ?? false,
    counters: (outcome.result?.counters ?? null) as Record<string, unknown> | null,
  };
}

function aflApiStep(mode: 'dry-run' | 'apply', outcome: AflApiSettleCliOutcome): SettleStepSummary {
  const r = outcome.result;
  return {
    source: 'afl_api', mode,
    halt: r?.halt ? r.halt.reason : null,
    rollbackReason: r?.rollbackReason ?? null,
    completeness: outcome.sourceCompleteness?.status ?? null,
    applied: r?.applied ?? false,
    counters: (r?.counters ?? null) as Record<string, unknown> | null,
  };
}

function checked(
  step: SettleStepSummary, log: (line: string) => void,
  judge: (step: SettleStepSummary) => string[] = settleStepProblems, name = `${step.source} ${step.mode}`,
): SettleStepSummary {
  const problems = judge(step);
  if (problems.length > 0) {
    refuse(`STOP: the ${name} did not meet the preparation post-conditions (§21.2 step 5). `
      + 'Never re-own and never fall back: report the listed disagreements.', problems);
  }
  log(`${name}: post-conditions PASS.`);
  return step;
}

export async function runPreparePromotionSource(argv: readonly string[], deps: PrepareDeps = {}): Promise<PrepareOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parsePrepareArgs(argv);

  // 1. Offline. No connection has been opened.
  const inProgress = inProgressSeasonsOf(projectRoot);
  const bindings = [
    (deps.verifyAflTables ?? verifyAflTablesRetainedSnapshot)(
      projectRoot, args.afltablesLabel, args.afltablesManifestSha256, args.afltablesBundleSha256),
    (deps.verifyAflApi ?? verifyAflApiRetainedSnapshot)(projectRoot, args.aflApiLabel, args.aflApiManifestSha256),
  ] as const;
  const inputProblems = retainedSnapshotProblems(bindings, inProgress);
  if (inputProblems.length > 0) refuse('STOP: the retained inputs are not the recorded, verified snapshots (D-252-2).', inputProblems);
  const season = inProgress[0];
  for (const b of bindings) log(`${b.source} '${b.label}': manifest sha256 ${b.actualManifestSha256} verified, season ${b.season}.`);
  log(`afltables '${bindings[0].label}': observations.json sha256 ${bindings[0].actualBundleSha256} verified.`);
  if (args.mode === 'validate-only') {
    log('--validate-only: both retained snapshots verified offline. No connection opened.');
    return { mode: args.mode, status: 'offline-verified', season, steps: [], record: null };
  }

  const ownsClient = deps.sql === undefined;
  let sql: postgres.Sql | null = null;
  try {
    const dsn = env.AFLDB_IMPORT_DATABASE_URL;
    if (!deps.sql && !dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
    sql = deps.sql ?? postgres(dsn!, { max: 1, onnotice: () => {}, transform: { undefined: null } });

    // 2. Database identity and the switch — read, never written (D-252-7).
    const preflight = await (deps.prove ?? proveAflApiIngestionPreflight)(sql, env);
    const dbProblems = preparationDatabaseProblems({
      controlDatabase: preflight.control.database,
      importDatabase: preflight.writer.database,
      aflApiCurrentSeasonEnabled: preflight.controls.currentSeasonEnabled,
    });
    if (dbProblems.length > 0) refuse(`STOP: preparation writes ${SOURCE_DATABASE} only, with the switch explicitly enabled.`, dbProblems);
    log(`Database proved: control ${preflight.control.database}, writer ${preflight.writer.database} (${preflight.writer.role}); `
      + 'AFL API current-season switch reads enabled.');

    // 3. Nothing already in the season may be owned by anything but AFL Tables (D-252-8).
    const ownershipProblems = preexistingSeasonOwnershipProblems(
      season, await (deps.readSeasonOwnership ?? readSeasonOwnershipLive)(sql, season));
    if (ownershipProblems.length > 0) refuse('STOP: the prepared source already breaks the ownership order.', ownershipProblems);

    // 4. AFL Tables first. `env: {}` keeps the settle's ISR revalidation off: this writes
    //    afldb_test, never the running site's database.
    const settleAfltables = deps.settleAfltables ?? runSettleCli;
    const settleAflApi = deps.settleAflApi ?? runAflApiSettleCli;
    const common = ['--auto-apply', '--require-complete-source'];
    const afltablesMode = args.mode === 'apply' ? 'apply' : 'dry-run';
    const steps: SettleStepSummary[] = [];
    const afltablesOutcome = await settleAfltables(
      ['--label', args.afltablesLabel, `--${afltablesMode}`, ...common], { projectRoot, sql, log, env: {} });
    if (args.mode === 'dry-run') {
      // Q-252-11: the first apply's bounded tolerance, as an unproven preview. No record, no proof.
      const preview = checked(afltablesStep('dry-run', afltablesOutcome), log, afltablesPreviewDryRunProblems, 'afltables preview dry-run');
      steps.push(preview);
      const c = preview.counters ?? {};
      log(`afltables preview dry-run: ${AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER} = ${String(c[AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER])}, `
        + `inserted ${String(c.canonicalRowsInserted)}, updated ${String(c.canonicalRowsUpdated)} (rolled back).`);
      log('--dry-run: the AFL API step is not dry-run before the AFL Tables apply commits — it would describe '
        + 'first-writer inserts, not corroboration. Nothing was retained.');
      log(PREPARATION_PREVIEW_STATUS);
      return { mode: args.mode, status: 'preview-unproven', season, steps, record: null };
    }
    // Q-252-10: the initial apply may carry a transient `unresolvedIdentityMatch` (pending period
    // scores of the matches it inserted, applied in the same run); every other counter must be 0.
    const initialApply = checked(afltablesStep('apply', afltablesOutcome), log, afltablesFirstApplyProblems, 'afltables initial apply');
    steps.push(initialApply);
    const transient = initialApply.counters?.[AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER];
    log(`afltables initial apply: ${AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER} = ${String(transient)} `
      + '(provisional; accepted only if the closure dry run proves it 0 with no write).');

    // 5. The mandatory same-label AFL Tables closure dry run, the authoritative proof. The AFL API
    //    phase never starts unless it is clean.
    const closureOutcome = await settleAfltables(
      ['--label', args.afltablesLabel, '--dry-run', ...common], { projectRoot, sql, log, env: {} });
    steps.push(checked(afltablesStep('dry-run', closureOutcome), log, afltablesClosureDryRunProblems, 'afltables closure dry-run'));

    // 6. AFL API second: dry run, then apply only if the dry run is clean.
    const aflApiDry = await settleAflApi(['--label', args.aflApiLabel, '--dry-run', ...common], { projectRoot, sql, log });
    steps.push(checked(aflApiStep('dry-run', aflApiDry), log));
    const aflApiApply = await settleAflApi(['--label', args.aflApiLabel, '--apply', ...common], { projectRoot, sql, log });
    steps.push(checked(aflApiStep('apply', aflApiApply), log));

    // 7. The record, never overwriting.
    const record = {
      kind: PREPARATION_RECORD_KIND,
      schema_version: PREPARATION_RECORD_SCHEMA_VERSION,
      prepared_at: (deps.now ?? (() => new Date()))().toISOString(),
      season,
      source_database: preflight.writer.database,
      writer_role: preflight.writer.role,
      order: bindings.map((b) => b.source),
      inputs: bindings.map((b) => ({
        source: b.source, label: b.label, manifest_sha256: b.actualManifestSha256,
        ...(b.source === 'afltables' ? { observations_sha256: b.actualBundleSha256 } : {}),
      })),
      steps: steps.map((s) => ({ source: s.source, mode: s.mode, completeness: s.completeness, applied: s.applied })),
      batches: {
        afltables: afltablesOutcome.result?.batchId ?? null,
        afl_api: aflApiApply.result?.batchId ?? null,
      },
      // Q-252-10: the two AFL Tables results, separately; neither stands for the other.
      afltables_initial_apply: aflTablesStepEvidence(initialApply, afltablesOutcome.result?.batchId ?? null,
        'PASS (provisional: accepted by the closure dry run)'),
      afltables_closure_dry_run: aflTablesStepEvidence(steps[1], closureOutcome.result?.batchId ?? null, 'PASS'),
      counters: {
        afltables: afltablesOutcome.result?.counters ?? null,
        afl_api: aflApiApply.result?.counters ?? null,
      },
    };
    (deps.writeRecord ?? ((path, text) => writeFileSync(path, text, { flag: 'wx' })))(args.recordOut!, `${JSON.stringify(record, null, 2)}\n`);
    log(`Preparation record written to ${args.recordOut}.`);
    return { mode: args.mode, status: 'prepared', season, steps, record };
  } finally {
    if (ownsClient && sql) await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  await runPreparePromotionSource(process.argv.slice(2));
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
