#!/usr/bin/env node
/**
 * AFLDB-ISSUE-229 / V2-GAP-008 — settles the PRE-MATCH fixture schedule of one retained AFL API
 * season feed into `fixtures`.
 *
 *   immutable snapshot -> validation -> staging -> identity resolution -> reconciliation
 *     -> transactional promotion
 *
 * Snapshot and validation (here, offline, before any connection): the `--fixtures-only`
 * acquisition's manifest re-hashes every file it names (`settle-afl-api-fixtures.ts` verifyManifest); the
 * season feed `00-season-matches.json` must be among them; the season must be declared in
 * `afl-api-identities.json` and must not be sealed (V2-GAP-006). Staging is
 * `stageAflApiFixtureFeed` (pure, `@afldb/acquisition`); resolution, reconciliation and promotion
 * are `settleAflApiFixtureStage`, one transaction under the per-season fixture lock.
 *
 * Distinct from `settle-afl-api-fixtures.ts`, which records CONCLUDED identity evidence into the
 * `match` observation spine. This tool writes `fixtures` only and never that spine (D-229-8a).
 *
 * Usage:
 *   npx tsx tools/current-season/settle-afl-api-fixture-schedule.ts \
 *     --label <fixtures-only-snapshot> (--validate-only | --dry-run | --apply) \
 *     [--acknowledge-unobserved-status POSTPONED,CANCELLED,ABANDONED]
 *
 * `--acknowledge-unobserved-status` is a per-run operator statement that the named provider
 * strings, never observed before, mean what the lifecycle maps them to. Without it they refuse
 * (D-229-3: nothing maps automatically to cancelled).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  parseAcknowledgedUnobservedStatuses,
  parseSourceFamilyRegistry,
  stageAflApiFixtureFeed,
  type AflApiFixtureStage,
} from '@afldb/acquisition';
import { postgresExecutor } from '@afldb/db';

import { parseAflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import {
  settleAflApiFixtureStage,
  type AflApiFixtureSettleOutcome,
} from '../../src/lib/acquisition/afl-api-fixture-writer';
import {
  describeAflApiIngestionReadFailure,
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '../../src/lib/acquisition/afl-api-ingestion-control';
import { AFL_API_SEASON_FEED_FILE } from '../../src/lib/acquisition/afl-api-season-enumeration';
import { aflApiSnapshotManifestSha256 } from '../../src/lib/acquisition/afl-api-snapshot';
import { SETTING_KEYS } from '../../src/lib/site-settings';
import { loadEnv } from './load-env';
// The --fixtures-only manifest check (acquisition kind, every file re-hashed), shared, not copied.
import { verifyManifest as verifyFixtureSnapshotManifest } from './settle-afl-api-fixtures';
import { refuseSealedSeasonForSettle } from './settle-season-seal';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');
const TOOL = 'settle-afl-api-fixture-schedule.ts';

export type FixtureScheduleCliArgs = {
  label: string;
  mode: 'validate-only' | 'dry-run' | 'apply';
  acknowledged: ReadonlySet<string>;
};

const KNOWN_FLAGS = new Set(['--label', '--apply', '--dry-run', '--validate-only', '--acknowledge-unobserved-status']);
const VALUE_FLAGS = new Set(['--label', '--acknowledge-unobserved-status']);

export function parseFixtureScheduleArgs(argv: readonly string[]): FixtureScheduleCliArgs {
  for (let i = 0; i < argv.length; i += 1) {
    if (!KNOWN_FLAGS.has(argv[i])) throw new Error(`Unknown argument '${argv[i]}'.`);
    if (VALUE_FLAGS.has(argv[i])) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} needs a value.`);
      i += 1;
    }
  }
  const valueOf = (flag: string) => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : undefined; };
  const label = valueOf('--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  if (label.includes('/') || label.includes('\\') || label.includes('..')) throw new Error('--label must be a snapshot directory name.');
  const modes = (['--validate-only', '--dry-run', '--apply'] as const).filter((flag) => argv.includes(flag));
  if (modes.length !== 1) throw new Error('Exactly one of --validate-only, --dry-run or --apply is required.');
  const ack = valueOf('--acknowledge-unobserved-status');
  return {
    label,
    mode: modes[0].slice(2) as FixtureScheduleCliArgs['mode'],
    acknowledged: parseAcknowledgedUnobservedStatuses(ack === undefined ? [] : ack.split(',').map((s) => s.trim())),
  };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Offline: snapshot -> validation -> stage. Opens no connection. */
export function stageFixtureSnapshot(projectRoot: string, args: FixtureScheduleCliArgs): {
  stage: AflApiFixtureStage; manifestSha256: string;
} {
  const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures', args.label);
  const { manifest, files } = verifyFixtureSnapshotManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number' || !Number.isInteger(season)) throw new Error('manifest.json carries no integer season.');
  if (!files.some((entry) => entry.file === AFL_API_SEASON_FEED_FILE)) {
    throw new Error(`The manifest does not list ${AFL_API_SEASON_FEED_FILE}; there is no hash-bound season feed to settle.`);
  }
  const feed = readJson(join(snapshotDir, AFL_API_SEASON_FEED_FILE)) as { matches?: unknown };
  if (!Array.isArray(feed.matches)) throw new Error(`${AFL_API_SEASON_FEED_FILE} has no matches array.`);
  const ctx = {
    registry: parseSourceFamilyRegistry(readJson(join(projectRoot, 'data', 'reference', 'source-families.json'))),
    identities: parseAflApiIdentities(readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'))),
  };
  return {
    stage: stageAflApiFixtureFeed(feed.matches, ctx, { season, acknowledgedUnobservedStatuses: args.acknowledged }),
    manifestSha256: aflApiSnapshotManifestSha256(snapshotDir),
  };
}

export function describeStage(stage: AflApiFixtureStage): string[] {
  const lines = [
    `Season ${stage.season} (${stage.compSeasonProviderId}): ${stage.scheduled.length} scheduled, `
      + `${stage.transitions.length} transition(s), ${stage.completed.length} completed, ${stage.deferred.length} deferred, `
      + `${stage.refused.length} refused.`,
    `Observed statuses: ${Object.entries(stage.statusCounts).sort().map(([s, n]) => `${s}=${n}`).join(', ') || '(none)'}`,
  ];
  for (const r of stage.refused) {
    for (const x of r.refusals) lines.push(`  REFUSED ${r.providerId ?? '(no id)'} [${r.providerStatus ?? '?'}] ${x.code}: ${x.detail}`);
  }
  return lines;
}

export function describeOutcome(outcome: AflApiFixtureSettleOutcome): string[] {
  const lines = [`Outcome: ${outcome.status}${outcome.batchId ? ` (import batch ${outcome.batchId})` : ''}`];
  for (const r of outcome.refusals) lines.push(`  REFUSED ${r.providerId ?? '(no id)'} ${r.code}: ${r.detail}`);
  const tally = new Map<string, number>();
  for (const a of outcome.actions) tally.set(a.kind, (tally.get(a.kind) ?? 0) + 1);
  if (tally.size > 0) lines.push(`Actions: ${[...tally].sort().map(([k, n]) => `${k}=${n}`).join(', ')}`);
  for (const a of outcome.actions) {
    if (a.kind === 'unchanged' || a.kind === 'completed_retained') continue;
    const changed = Object.entries(a.changes).map(([c, [b, x]]) => `${c}: ${String(b)} -> ${String(x)}`).join('; ');
    lines.push(`  ${a.kind.toUpperCase()} ${a.providerId}${changed ? ` (${changed})` : ''}`);
  }
  if (outcome.unmentionedOwnedRows.length > 0) {
    lines.push(`Not in this feed, left untouched (no absence sweep, D-229-8): ${outcome.unmentionedOwnedRows.join(', ')}`);
  }
  return lines;
}

export type FixtureScheduleCliDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
  ingestionControls?: AflApiIngestionControls;
  mintFixtureKey?: () => string;
};

export async function runFixtureScheduleCli(
  argv: readonly string[], deps: FixtureScheduleCliDeps = {},
): Promise<{ stage: AflApiFixtureStage; outcome: AflApiFixtureSettleOutcome | null }> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseFixtureScheduleArgs(argv);
  const { stage, manifestSha256 } = stageFixtureSnapshot(projectRoot, args);
  for (const line of describeStage(stage)) log(line);
  if (args.mode === 'validate-only') {
    log('--validate-only: manifest, season feed and fixture contract verified. No connection opened.');
    return { stage, outcome: null };
  }

  refuseSealedSeasonForSettle(projectRoot, stage.season);
  const controls = deps.ingestionControls ?? await readAflApiIngestionControls();
  if (!controls.currentSeasonEnabled) {
    const readFailure = describeAflApiIngestionReadFailure(controls);
    if (readFailure) throw new Error(`AFL API current-season ingestion refused: ${readFailure}`);
    throw new Error(
      `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}').`,
    );
  }

  const ownsClient = deps.sql === undefined;
  let sql = deps.sql;
  if (sql === undefined) {
    const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
    if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
    sql = postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
  }
  try {
    const outcome = await settleAflApiFixtureStage(postgresExecutor(sql), {
      stage, mode: args.mode, provenance: { tool: TOOL, snapshotLabel: args.label, manifestSha256 },
      mintFixtureKey: deps.mintFixtureKey,
    });
    for (const line of describeOutcome(outcome)) log(line);
    if (outcome.status === 'dry_run') log('Dry run: every write executed against real constraints, then rolled back.');
    if (outcome.status === 'refused') throw new Error('Fixture settle refused; nothing was written.');
    return { stage, outcome };
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  loadEnv(DEFAULT_PROJECT_ROOT);
  runFixtureScheduleCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
