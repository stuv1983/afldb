#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S2 (§7.1, §5.4, §17) — the AFL.com.au direct-HTTP
 * acquisition CLI.
 *
 * "Acquire (network, files only) ... Nothing here adjudicates" (§7.1): this
 * tool fetches one WMCTok token, the season's match feed, and per selected
 * match its playerStats and matchRoster, writes the raw bytes verbatim under
 * `data/sources/afl_api/matches/<label>/`, and writes `manifest.json` LAST
 * with a SHA-256 per file plus HTTP status/ETag/Cache-Control/retrieval
 * time. It parses only as much as it needs to select matches
 * (`selectAflApiMatches`) and never validates against the source-family
 * registry — that is the bundle emitter (S3, `afl-api-bundle.ts`).
 *
 * MANIFEST-LAST, SAME CONTRACT AS `deploy/afldb-settle-afltables.sh`'s
 * `cleanup_partial`: the manifest's absence IS the "acquisition did not
 * finish" signal. On any failure this process removes the partial snapshot
 * directory rather than leaving a directory a later stage could mistake for
 * a complete, hash-bound acquisition.
 *
 * Usage:
 *   npx tsx tools/current-season/acquire-afl-api.ts \
 *     --season 2026 [--status CONCLUDED] [--since YYYY-MM-DD] [--match CD_M...]
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type AflApiEndpointBases,
  type AflApiRequestPlan,
  type AflApiResponse,
  fetchAflApiCfsResource,
  fetchAflApiToken,
  type FetchLike,
  parseAflApiSeasonMatchesEnvelope,
  planAflApiMatchRosterRequest,
  planAflApiPlayerStatsRequest,
  planAflApiSeasonMatchesRequest,
  requestAflApi,
  resolveAflApiEndpointBases,
  type RetryOptions,
  selectAflApiMatches,
} from '../../src/lib/acquisition/afl-api-client';
import { AFL_API_FIXTURE_ACQUISITION_KIND } from '../../src/lib/acquisition/afl-api-fixture-identity';
import {
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '../../src/lib/acquisition/afl-api-ingestion-control';
import { claimSnapshotDir } from '../../src/lib/acquisition/snapshot-dir';
import { SETTING_KEYS } from '../../src/lib/site-settings';
// I244-F029: the shared loader, which honours AFLDB_SKIP_DOTENV so a variable
// this unit's `UnsetEnvironment=` stripped is not read straight back in.
import { loadEnv } from './load-env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export type AcquireAflApiArgs = {
  season: number;
  status: string | null;
  since: string | null;
  match: string[];
  /**
   * Fixture-only identity acquisition (§ "fixture-only Brownlow identity
   * prerequisite", 2026-09-20): fetch and preserve the season fixture feed
   * ONLY — no CFS token, no `playerStats`/`matchRoster` request for any
   * match. An explicit operator mode; there is no implicit fallback into it
   * and no implicit fallback out of it. Defaults to `false`/omitted, which
   * keeps every existing caller's behaviour byte-identical.
   */
  fixturesOnly?: boolean;
};

const KNOWN_FLAGS = new Set(['--season', '--status', '--since', '--match', '--fixtures-only']);

function valueFor(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseAcquireArgs(argv: readonly string[]): AcquireAflApiArgs {
  let season: number | null = null;
  let status: string | null = null;
  let since: string | null = null;
  const match: string[] = [];
  let fixturesOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`Unknown flag '${arg}'.`);
    if (arg === '--fixtures-only') {
      fixturesOnly = true;
      continue;
    }
    const value = valueFor(argv, i, arg);
    i += 1;
    if (arg === '--season') {
      season = Number(value);
      if (!Number.isInteger(season)) throw new Error(`--season must be an integer, got '${value}'.`);
    } else if (arg === '--status') {
      status = value;
    } else if (arg === '--since') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--since must be YYYY-MM-DD, got '${value}'.`);
      since = value;
    } else if (arg === '--match') {
      match.push(value);
    }
  }
  if (season === null) throw new Error('--season <year> is required.');
  return { season, status, since, match, fixturesOnly };
}

/**
 * §5.4: `afl-api-<season>-<YYYY-MM-DD-HHMMSS>`, in UTC so a run is
 * reproducibly labelled regardless of host timezone. Seconds were added
 * (AFLDB-ISSUE-228 follow-up) because minute granularity let two
 * acquisitions inside the same minute generate the identical label;
 * `claimSnapshotDir()` (below, in `runAcquisition`) is the actual collision
 * guarantee — this is only a best-effort widening of the base label so a
 * suffixed collision label stays rare.
 */
export function buildAflApiLabel(season: number, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
    + `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `afl-api-${season}-${stamp}`;
}

type ManifestFileEntry = {
  file: string;
  sha256: string;
  http_status?: number;
  etag?: string | null;
  cache_control?: string | null;
  retrieved_at?: string;
  derived_from?: string;
};

function sha256Of(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function writeRawFile(snapshotDir: string, relPath: string, response: AflApiResponse): ManifestFileEntry {
  const path = join(snapshotDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, response.bodyText, 'utf8');
  return {
    file: relPath.split('\\').join('/'),
    sha256: sha256Of(response.bodyText),
    http_status: response.status,
    etag: response.etag,
    cache_control: response.cacheControl,
    retrieved_at: response.retrievedAt,
  };
}

export type RunAcquisitionDeps = {
  fetchImpl: FetchLike;
  projectRoot?: string;
  bases?: AflApiEndpointBases;
  retryOpts?: RetryOptions;
  log?: (line: string) => void;
  /** The instant the run's base label is derived from. Defaults to `new Date()`; tests pin it. */
  now?: Date;
  /**
   * Fired the instant `claimSnapshotDir()` has created THIS run's directory
   * (before any network call), so a caller can target partial-failure
   * cleanup at the exact directory this run claimed, rather than
   * recomputing the label and risking a mismatch against a suffix
   * `claimSnapshotDir()` may have appended on collision.
   */
  onSnapshotDirClaimed?: (dir: string, label: string) => void;
  /** Test-only escape hatch for the super-admin ingestion gate below; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
};

export type RunAcquisitionResult = {
  label: string;
  snapshotDir: string;
  manifestPath: string;
  season: number;
  compSeasonId: number;
  matchesInFeed: number;
  matchesSelected: number;
};

/**
 * The whole acquisition, minus process/CLI concerns (arg parsing, exit code,
 * partial-directory cleanup on failure — those live in `main()`). Exported
 * so tests can point it at a scratch directory with a stubbed `fetchImpl`.
 *
 * Throws on ANY unrecoverable failure — a bad token after one reissue, an
 * exhausted retry budget, a season with no declared `compSeasonId` — and
 * writes `manifest.json` only as the LAST statement, once every other file
 * for the run has been written successfully (§7.1 step 4, §5.4).
 */
export async function runAcquisition(
  args: AcquireAflApiArgs, deps: RunAcquisitionDeps,
): Promise<RunAcquisitionResult> {
  // AFLDB-ISSUE-228 follow-up (§C, §E) — the super-admin ingestion switch,
  // checked BEFORE anything else: no file read, no token fetch, no season
  // request. Fail closed (site-settings.ts `parseBooleanSetting`): a missing
  // row, an unreadable database or DATABASE_URL being unset all read as
  // disabled, matching every other enable check in this file's sibling
  // tools (e.g. `isAflApiBrownlowEnabled` in acquire-afl-api-brownlow.ts).
  const ingestionControls = deps.ingestionControls ?? await readAflApiIngestionControls();
  if (!ingestionControls.currentSeasonEnabled) {
    throw new Error(
      `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}'). `
      + 'A super admin must enable it from /admin/current-season before this tool will make a network request.',
    );
  }

  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const bases = deps.bases ?? resolveAflApiEndpointBases(process.env);
  const retryOpts = deps.retryOpts ?? {};
  const log = deps.log ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const { fetchImpl } = deps;

  const identities = readJson(
    join(projectRoot, 'data', 'reference', 'afl-api-identities.json'),
  ) as { seasons?: Record<string, { compSeasonId?: unknown }> };
  const seasonEntry = identities.seasons?.[String(args.season)];
  if (!seasonEntry || typeof seasonEntry.compSeasonId !== 'number') {
    throw new Error(
      `No compSeasonId declared for season ${args.season} in `
      + 'data/reference/afl-api-identities.json. Add it before acquiring that season.',
    );
  }
  const compSeasonId = seasonEntry.compSeasonId;

  const fixturesOnly = args.fixturesOnly ?? false;
  const parentDir = join(
    projectRoot, 'data', 'sources', 'afl_api', fixturesOnly ? 'fixtures' : 'matches',
  );
  const baseLabel = buildAflApiLabel(args.season, deps.now ?? new Date());
  const { label, dir: snapshotDir } = claimSnapshotDir(parentDir, baseLabel);
  deps.onSnapshotDirClaimed?.(snapshotDir, label);

  log(
    `AFLDB-ISSUE-228 acquire — season ${args.season} (compSeasonId ${compSeasonId}), label ${label}`
    + (fixturesOnly ? ' [--fixtures-only: season fixture feed only, no CFS/token, no playerStats/matchRoster]' : ''),
  );

  // §7.1 step 1. Memory only; never written to disk. Skipped ENTIRELY in
  // --fixtures-only mode: the season matches feed is on the PUBLIC base and
  // carries no token, and this mode never reaches a CFS endpoint at all.
  const tokenIssuedAt = new Date().toISOString();
  const tokenState: { token: string; reissuedThisRun: boolean } | null = fixturesOnly
    ? null
    : { token: await fetchAflApiToken(fetchImpl, bases, process.env, retryOpts), reissuedThisRun: false };
  const currentToken = (): string => {
    if (!tokenState) throw new Error('Internal error: no AFL API token is held in --fixtures-only mode.');
    return tokenState.token;
  };
  const reissueToken = async (): Promise<string> => {
    if (!tokenState) throw new Error('Internal error: reissueToken() called in --fixtures-only mode.');
    if (tokenState.reissuedThisRun) {
      throw new Error(
        'AFL API token was rejected even after one reissue this run; refusing further '
        + 'attempts rather than looping (§17, R6).',
      );
    }
    tokenState.reissuedThisRun = true;
    tokenState.token = await fetchAflApiToken(fetchImpl, bases, process.env, retryOpts);
    return tokenState.token;
  };

  // §7.1 step 2. The season matches feed is on the PUBLIC base and carries no token.
  const seasonPlan = planAflApiSeasonMatchesRequest(bases, compSeasonId, process.env);
  const seasonResponse = await requestAflApi(fetchImpl, seasonPlan, retryOpts);
  const seasonRaw = JSON.parse(seasonResponse.bodyText) as { matches?: unknown[] };
  const rawMatches = Array.isArray(seasonRaw.matches) ? seasonRaw.matches : [];
  const summaries = parseAflApiSeasonMatchesEnvelope(seasonResponse.bodyText);
  const rawByProviderId = new Map<string, unknown>(
    rawMatches
      .map((m) => [(m as { providerId?: unknown } | null)?.providerId, m] as const)
      .filter((entry): entry is [string, unknown] => typeof entry[0] === 'string'),
  );

  const selected = selectAflApiMatches(summaries, {
    status: args.status, since: args.since, match: args.match,
  });
  log(`  season feed: ${summaries.length} match(es); selected: ${selected.length}`);

  const files: ManifestFileEntry[] = [
    writeRawFile(snapshotDir, '00-season-matches.json', seasonResponse),
  ];

  for (const match of selected) {
    const rawMatch = rawByProviderId.get(match.providerId);
    if (rawMatch !== undefined) {
      // Derived locally from the already-fetched season feed — NOT a separate
      // HTTP call (§5.4 declares this file; §2.1 names no per-match fixture
      // endpoint). Kept alongside the two real per-match fetches below so a
      // later stage can read one match's fixture facts without re-parsing
      // the whole season file.
      const text = JSON.stringify(rawMatch, null, 2);
      const relPath = join(match.providerId, 'fixture.json');
      const path = join(snapshotDir, relPath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf8');
      files.push({
        file: relPath.split('\\').join('/'),
        sha256: sha256Of(text),
        derived_from: '00-season-matches.json',
      });
    }

    if (fixturesOnly) {
      log(`  ${match.providerId}: fixture acquired (--fixtures-only — no playerStats/matchRoster requested)`);
      continue;
    }

    const statsResult = await fetchAflApiCfsResource(
      fetchImpl,
      (tok: string): AflApiRequestPlan => planAflApiPlayerStatsRequest(bases, match.providerId, tok, process.env),
      currentToken(), reissueToken, retryOpts,
    );
    files.push(writeRawFile(snapshotDir, join(match.providerId, 'player-stats.json'), statsResult.response));

    const rosterResult = await fetchAflApiCfsResource(
      fetchImpl,
      (tok: string): AflApiRequestPlan => planAflApiMatchRosterRequest(bases, match.providerId, tok, process.env),
      currentToken(), reissueToken, retryOpts,
    );
    files.push(writeRawFile(snapshotDir, join(match.providerId, 'match-roster.json'), rosterResult.response));

    log(`  ${match.providerId}: player-stats + match-roster acquired`);
  }

  if (!fixturesOnly && tokenState) {
    writeFileSync(
      join(snapshotDir, 'token.meta.json'),
      JSON.stringify({ issued_at: tokenIssuedAt, reissued: tokenState.reissuedThisRun }, null, 2),
      'utf8',
    );
  }

  const manifestPath = join(snapshotDir, 'manifest.json');
  const manifest = {
    contract_version: 1,
    source_key: 'afl_api',
    acquisition_kind: fixturesOnly ? AFL_API_FIXTURE_ACQUISITION_KIND : 'afl_api_match_snapshot',
    // Belt-and-braces alongside acquisition_kind (operator brief: "mark the
    // snapshot/mode explicitly so the full settle cannot accidentally
    // interpret it as a complete stats/roster acquisition").
    fixtures_only: fixturesOnly,
    label,
    season: args.season,
    comp_season_id: compSeasonId,
    // `selectAflApiMatches` ignores status/since entirely once `match` is given
    // (§2.1's own selection contract), so the manifest records exactly what
    // was APPLIED, not just what was passed on the command line.
    selection: args.match.length > 0
      ? { status: null, since: null, match: args.match }
      : { status: args.status ?? 'CONCLUDED', since: args.since, match: null },
    acquired_at: new Date().toISOString(),
    counts: { matches_in_feed: summaries.length, matches_selected: selected.length },
    files,
  };
  // Written LAST: its absence is the sole "this acquisition did not finish" signal (§5.4, §7.1 step 4).
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  log(`  manifest: ${manifestPath}`);

  return {
    label,
    snapshotDir,
    manifestPath,
    season: args.season,
    compSeasonId,
    matchesInFeed: summaries.length,
    matchesSelected: selected.length,
  };
}

/** The `cleanup_partial` pattern (`deploy/afldb-settle-afltables.sh`), ported to this tool: a failure that never reached the manifest write leaves no consumable partial snapshot on disk. */
export function cleanupPartialSnapshot(snapshotDir: string, log: (line: string) => void = console.error): void {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath) && existsSync(snapshotDir)) {
    log(`acquisition did not write a manifest; removing partial snapshot ${snapshotDir}`);
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const args = parseAcquireArgs(process.argv.slice(2));
  let claimedSnapshotDir: string | null = null;
  try {
    await runAcquisition(args, {
      fetchImpl: fetch,
      projectRoot: DEFAULT_PROJECT_ROOT,
      onSnapshotDirClaimed: (dir) => { claimedSnapshotDir = dir; },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (claimedSnapshotDir) cleanupPartialSnapshot(claimedSnapshotDir);
  }
}

// Run only when this file is the entry point — importing it for tests must not start a run.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main();
}
