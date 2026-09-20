#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S7 follow-up (2026-09-20, §17-style CLI) — settles a
 * `--fixtures-only` acquisition (`acquire-afl-api.ts --fixtures-only`) into
 * the `match` family's own spine observation ONLY.
 *
 * This is deliberately NOT `settle-afl-api.ts`: it never builds a match
 * bundle (which needs a roster/stats capture), never resolves a canonical
 * `matches` target, never writes `staging.afl_api_match`, never writes a
 * promotion candidate. Its entire write surface is
 * `persistAflApiFixtureObservations()` — see
 * `src/lib/acquisition/afl-api-fixture-identity.ts` for why. Its purpose is
 * solely to make the season fixture feed's identity evidence durable and
 * reusable so `settle-afl-api-brownlow.ts --use-fixture-identity` can
 * resolve a Brownlow vote's `CD_M…` without a full match/roster/stats
 * acquisition for every match.
 *
 * Usage:
 *   npx tsx tools/current-season/settle-afl-api-fixtures.ts \
 *     --label <fixtures-only-snapshot> (--validate-only | --dry-run | --apply)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { parseAflApiIdentities, type AflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import {
  AFL_API_FIXTURE_ACQUISITION_KIND,
  buildAflApiFixtureRecords,
  persistAflApiFixtureObservations,
  type AflApiFixtureObservationCounters,
} from '../../src/lib/acquisition/afl-api-fixture-identity';
import { resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import { asImportBatchId } from '../../src/lib/import-batch-id';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function snapshotRootOf(projectRoot: string): string {
  return join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures');
}

export type AflApiFixturesSettleCliArgs = {
  label: string;
  apply: boolean;
  dryRun: boolean;
  validateOnly: boolean;
};

function loadEnv(projectRoot: string): void {
  let contents: string;
  try {
    contents = readFileSync(join(projectRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
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

const KNOWN_FLAGS = new Set(['--label', '--apply', '--dry-run', '--validate-only']);

export function parseAflApiFixturesSettleArgs(argv: readonly string[]): AflApiFixturesSettleCliArgs {
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  const modeFlags = ['--apply', '--dry-run', '--validate-only'].filter((flag) => argv.includes(flag));
  if (modeFlags.length !== 1) {
    throw new Error('Exactly one of --apply, --dry-run or --validate-only is required.');
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) throw new Error(`Unknown flag '${arg}'.`);
    if (arg === '--label') i += 1;
  }
  return {
    label,
    apply: argv.includes('--apply'),
    dryRun: argv.includes('--dry-run'),
    validateOnly: argv.includes('--validate-only'),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

type ManifestFile = { file: string; sha256: string; status?: string };

/**
 * Offline, fail-closed manifest verification — mirrors `settle-afl-api.ts`'s
 * `verifyManifest()` exactly, plus the ONE extra check this tool needs: the
 * manifest must actually be a `--fixtures-only` acquisition, never a normal
 * one (which this tool cannot settle — it never reads `player-stats.json`/
 * `match-roster.json` at all) and never the reverse (a full snapshot
 * accidentally treated as fixtures-only, silently discarding its roster/
 * stats evidence).
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
  if (manifest.acquisition_kind !== AFL_API_FIXTURE_ACQUISITION_KIND) {
    throw new Error(
      `manifest.json names acquisition_kind '${String(manifest.acquisition_kind)}', expected `
      + `'${AFL_API_FIXTURE_ACQUISITION_KIND}'. This tool only settles a --fixtures-only acquisition `
      + "('acquire-afl-api.ts --fixtures-only'); use 'settle-afl-api.ts' for a full "
      + 'match/roster/stats snapshot.',
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

/** Discovers every acquired `fixture.json` from the manifest's own file
 * list — the manifest is the one proof of what acquisition actually wrote. */
function fixturesRawFrom(snapshotDir: string, files: readonly ManifestFile[]): unknown[] {
  const matchDirs = new Set<string>();
  for (const entry of files) {
    const parts = entry.file.split('/');
    if (parts.length === 2 && parts[1] === 'fixture.json') matchDirs.add(parts[0]);
  }
  return [...matchDirs].sort().map((dir) => readJson(join(snapshotDir, dir, 'fixture.json')));
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function counterLines(counters: AflApiFixtureObservationCounters, buildFailures: number): string[] {
  return [
    '',
    'Observation',
    `  observationsSeen: ${counters.observationsSeen}`,
    `  versionsAppended: ${counters.versionsAppended}`,
    `  observationsUnchanged: ${counters.observationsUnchanged}`,
    `  buildFailures: ${buildFailures}`,
  ];
}

class DryRunRollback extends Error {
  constructor() { super('afl_api fixtures settle dry-run: rolling back deliberately'); this.name = 'DryRunRollback'; }
}

export type AflApiFixturesSettleCliDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
};

export type AflApiFixturesSettleCliOutcome = {
  args: AflApiFixturesSettleCliArgs;
  counters: AflApiFixtureObservationCounters | null;
  buildFailures: number;
  batchId: string | null;
};

export async function runAflApiFixturesSettleCli(
  argv: readonly string[], deps: AflApiFixturesSettleCliDeps = {},
): Promise<AflApiFixturesSettleCliOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseAflApiFixturesSettleArgs(argv);

  // Offline and fail-closed. No database has been opened yet.
  const snapshotDir = join(snapshotRootOf(projectRoot), args.label);
  const { manifest, files } = verifyManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number') throw new Error('manifest.json carries no numeric season.');

  const registry: SourceFamilyRegistry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );
  const identities: AflApiIdentities = parseAflApiIdentities(
    readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
  );

  const fixturesRaw = fixturesRawFrom(snapshotDir, files);
  const { records, buildFailures } = buildAflApiFixtureRecords(fixturesRaw, registry, identities);
  log(
    `Fixtures-only snapshot '${args.label}' (season ${season}): ${records.length} fixture(s) built, `
    + `${buildFailures.length} build failure(s).`,
  );
  for (const failure of buildFailures) {
    log(`  BUILD FAILURE ${failure.providerMatchId ?? '(unknown match)'}: ${failure.error}`);
  }

  if (args.validateOnly) {
    log('');
    log('--validate-only: manifest, registry and fixture contract verified. No connection opened.');
    return {
      args, counters: null, buildFailures: buildFailures.length, batchId: null,
    };
  }

  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createImportClient();
  let batchIdText: string | null = null;
  // A `const` object MUTATED in place inside the transaction, exactly like
  // `runSettleAflApi()`'s own `counters` (`settle-afl-api.ts`) — never a `let` REASSIGNED
  // from inside the `sql.begin()` closure. The closure is opaque to TypeScript's
  // control-flow analysis, so a reassigned outer binding read after the transaction (via
  // `counters?.observationsSeen`) does not keep the annotated `... | null` union the way a
  // mutated pre-existing object's properties do; this shape sidesteps that entirely rather
  // than asserting past it, and it means `counters` is always defined below, dry run
  // included (the assignment always happens before the `DryRunRollback` throw).
  const counters: AflApiFixtureObservationCounters = {
    observationsSeen: 0, versionsAppended: 0, observationsUnchanged: 0,
  };
  try {
    await sql.begin(async (tx) => {
      const sourceId = await resolveAflApiSourceId(tx);
      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
        VALUES (
          ${sourceId}, 'settle-afl-api-fixtures.ts', 'staging.source_record_versions', ${records.length},
          ${`AFLDB-ISSUE-228 S7 fixtures-only identity settle; snapshot=${args.label}; season=${season}; `
            + `mode=${args.apply ? 'apply' : 'dry-run'}`}
        )
        RETURNING id
      `;
      batchIdText = batch.id;
      const batchId = asImportBatchId(batch.id);
      const observedAt = new Date().toISOString();

      Object.assign(counters, await persistAflApiFixtureObservations(tx, {
        sourceId, season, registry, records, batchId, observedAt,
      }));

      if (!args.apply) throw new DryRunRollback();
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      batchIdText = null;
    } else {
      throw error;
    }
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }

  for (const line of counterLines(counters, buildFailures.length)) log(line);

  log('');
  if (!args.apply) {
    log(
      'Dry run. The write path executed against real constraints and privileges, then the whole '
      + 'transaction was rolled back. Nothing was retained — not even the import_batches row. '
      + 'Re-run with --apply to keep it.',
    );
  } else {
    log(
      `Applied as import batch ${batchIdText}: ${counters.observationsSeen} fixture observation(s) `
      + 'recorded to the match family spine. No staging.afl_api_match row, no matches/'
      + 'match_period_scores/player_match_stats write, and no promotion candidate was created — this '
      + 'tool has no code path that could.',
    );
  }

  return {
    args, counters, buildFailures: buildFailures.length, batchId: batchIdText,
  };
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  await runAflApiFixturesSettleCli(process.argv.slice(2));
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
