#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S7 (§2.5, §7.1, §10, §17) — the Brownlow bfawards
 * acquisition CLI.
 *
 * Fetches exactly two endpoints for one season — `bfawards/season/<CD_S>`
 * (the match vote-set feed) and `bfawards/leaderboard/season/<CD_S>` (the
 * reconciliation surface) — and writes the raw bytes verbatim under
 * `data/sources/afl_api/brownlow/<label>/`, manifest LAST, exactly the
 * `acquire-afl-api.ts` (S2) contract. Nothing here adjudicates: no parsing
 * beyond confirming the response is JSON, no registry validation (the S3
 * emitters + this stage's settle do that), no promotion decision.
 *
 * §10 "Operational enablement": disabled by default. Set
 * `AFLDB_AFL_API_BROWNLOW_ENABLED=true` to run anything beyond nothing — this
 * tool refuses to make a single network request otherwise, so it is never
 * accidentally wired into a chain that polls the live AFL endpoint or the
 * local simulator outside a deliberate operator session.
 *
 * Usage:
 *   npx tsx tools/current-season/acquire-afl-api-brownlow.ts --season 2026
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AflApiRequestError,
  fetchAflApiToken,
  planAflApiBrownlowLeaderboardRequest,
  planAflApiBrownlowSeasonRequest,
  requestAflApi,
  resolveAflApiEndpointBases,
  type AflApiEndpointBases,
  type AflApiResponse,
  type FetchLike,
  type RetryOptions,
} from '../../src/lib/acquisition/afl-api-client';
import { BROWNLOW_ENABLE_ENV, isAflApiBrownlowEnabled } from '../../src/lib/acquisition/afl-api-brownlow';
import {
  combineAflApiBrownlowGates,
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

export type AcquireAflApiBrownlowArgs = { season: number };

export function parseAcquireBrownlowArgs(argv: readonly string[]): AcquireAflApiBrownlowArgs {
  const index = argv.indexOf('--season');
  if (index === -1) throw new Error('--season <year> is required.');
  const value = argv[index + 1];
  const season = Number(value);
  if (!Number.isInteger(season)) throw new Error(`--season must be an integer, got '${value}'.`);
  return { season };
}

/**
 * §5.4: `afl-api-brownlow-<season>-<YYYY-MM-DD-HHMMSS>`, UTC. Seconds were
 * added (AFLDB-ISSUE-228 follow-up) because minute granularity let two
 * acquisitions inside the same live-count minute generate the identical
 * label; `claimSnapshotDir()` (below, in `runBrownlowAcquisition`) is the
 * actual collision guarantee — this is only a best-effort widening of the
 * base label so a suffixed collision label stays rare.
 */
export function buildAflApiBrownlowLabel(season: number, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
    + `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `afl-api-brownlow-${season}-${stamp}`;
}

type ManifestFileEntry = {
  file: string; sha256: string; http_status: number; etag: string | null;
  cache_control: string | null; retrieved_at: string;
};

function sha256Of(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function writeRawFile(snapshotDir: string, relPath: string, response: AflApiResponse): ManifestFileEntry {
  const path = join(snapshotDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, response.bodyText, 'utf8');
  return {
    file: relPath, sha256: sha256Of(response.bodyText), http_status: response.status,
    etag: response.etag, cache_control: response.cacheControl, retrieved_at: response.retrievedAt,
  };
}

export type RunBrownlowAcquisitionDeps = {
  fetchImpl: FetchLike;
  projectRoot?: string;
  bases?: AflApiEndpointBases;
  retryOpts?: RetryOptions;
  log?: (line: string) => void;
  now?: Date;
  /** Test-only escape hatch for the §10 enable guard; production always reads `process.env`. */
  env?: Partial<Record<string, string | undefined>>;
  /**
   * Fired the instant `claimSnapshotDir()` has created THIS run's directory
   * (before any network call), so a caller can target partial-failure
   * cleanup at the exact directory this run claimed, rather than
   * recomputing the label and risking a mismatch against a suffix
   * `claimSnapshotDir()` may have appended on collision.
   */
  onSnapshotDirClaimed?: (dir: string, label: string) => void;
  /** Test-only escape hatch for the §D two-key admin gate below; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
};

export type RunBrownlowAcquisitionResult = {
  label: string;
  snapshotDir: string;
  manifestPath: string;
  season: number;
  seasonProviderId: string;
};

export async function runBrownlowAcquisition(
  args: AcquireAflApiBrownlowArgs, deps: RunBrownlowAcquisitionDeps,
): Promise<RunBrownlowAcquisitionResult> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const env = deps.env ?? process.env;
  // AFLDB-ISSUE-228 follow-up (§D two-key safety) — BOTH the outer
  // deployment gate and the inner super-admin DB switch must be true.
  // Neither can override the other: an operator turning the admin control
  // on does nothing while AFLDB_AFL_API_BROWNLOW_ENABLED is unset, and
  // vice versa.
  const deploymentGateEnabled = isAflApiBrownlowEnabled(env);
  const ingestionControls = deps.ingestionControls ?? await readAflApiIngestionControls(env);
  const gate = combineAflApiBrownlowGates(deploymentGateEnabled, ingestionControls.brownlowAdminEnabled);
  if (!gate.effectiveEnabled) {
    throw new Error(
      'Brownlow acquisition is disabled outside the live count window (§10, §D two-key safety): '
      + `deployment gate (${BROWNLOW_ENABLE_ENV}) is ${deploymentGateEnabled ? 'enabled' : 'disabled'}, `
      + `super-admin setting (site_settings '${SETTING_KEYS.aflApiBrownlowEnabled}') is `
      + `${ingestionControls.brownlowAdminEnabled ? 'enabled' : 'disabled'}. Both must be enabled.`,
    );
  }
  const bases = deps.bases ?? resolveAflApiEndpointBases(env);
  const retryOpts = deps.retryOpts ?? {};
  const log = deps.log ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const { fetchImpl } = deps;

  const identities = readJson(
    join(projectRoot, 'data', 'reference', 'afl-api-identities.json'),
  ) as { seasons?: Record<string, { providerId?: unknown }> };
  const seasonEntry = identities.seasons?.[String(args.season)];
  if (!seasonEntry || typeof seasonEntry.providerId !== 'string') {
    throw new Error(
      `No providerId (CD_S…) declared for season ${args.season} in `
      + 'data/reference/afl-api-identities.json. Add it before acquiring that season.',
    );
  }
  const seasonProviderId = seasonEntry.providerId;

  const parentDir = join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow');
  const baseLabel = buildAflApiBrownlowLabel(args.season, deps.now ?? new Date());
  const { label, dir: snapshotDir } = claimSnapshotDir(parentDir, baseLabel);
  deps.onSnapshotDirClaimed?.(snapshotDir, label);

  log(`AFLDB-ISSUE-228 S7 Brownlow acquire — season ${args.season} (${seasonProviderId}), label ${label}`);

  let token = await fetchAflApiToken(fetchImpl, bases, env, retryOpts);
  let reissuedThisRun = false;
  const reissueToken = async (): Promise<string> => {
    if (reissuedThisRun) {
      throw new Error('AFL API token was rejected even after one reissue this run; refusing further attempts.');
    }
    reissuedThisRun = true;
    token = await fetchAflApiToken(fetchImpl, bases, env, retryOpts);
    return token;
  };

  async function fetchCfs(build: (tok: string) => ReturnType<typeof planAflApiBrownlowSeasonRequest>): Promise<AflApiResponse> {
    try {
      return await requestAflApi(fetchImpl, build(token), retryOpts);
    } catch (error) {
      if (!(error instanceof AflApiRequestError) || (error.status !== 401 && error.status !== 403)) throw error;
      const fresh = await reissueToken();
      return requestAflApi(fetchImpl, build(fresh), retryOpts);
    }
  }

  const seasonResponse = await fetchCfs((tok) => planAflApiBrownlowSeasonRequest(bases, seasonProviderId, tok, env));
  const leaderboardResponse = await fetchCfs(
    (tok) => planAflApiBrownlowLeaderboardRequest(bases, seasonProviderId, tok, env),
  );

  // Confirm the transaction succeeded and produced JSON; no adjudication (§7.1).
  JSON.parse(seasonResponse.bodyText);
  JSON.parse(leaderboardResponse.bodyText);

  const files: ManifestFileEntry[] = [
    writeRawFile(snapshotDir, '01-brownlow-season.raw.json', seasonResponse),
    writeRawFile(snapshotDir, '02-brownlow-leaderboard.raw.json', leaderboardResponse),
  ];

  const manifestPath = join(snapshotDir, 'manifest.json');
  const manifest = {
    contract_version: 1,
    source_key: 'afl_api',
    acquisition_kind: 'afl_api_brownlow_snapshot',
    label,
    season: args.season,
    season_provider_id: seasonProviderId,
    acquired_at: new Date().toISOString(),
    files,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  log(`  manifest: ${manifestPath}`);

  return {
    label, snapshotDir, manifestPath, season: args.season, seasonProviderId,
  };
}

export function cleanupPartialBrownlowSnapshot(snapshotDir: string, log: (line: string) => void = console.error): void {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath) && existsSync(snapshotDir)) {
    log(`acquisition did not write a manifest; removing partial snapshot ${snapshotDir}`);
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const args = parseAcquireBrownlowArgs(process.argv.slice(2));
  let claimedSnapshotDir: string | null = null;
  try {
    await runBrownlowAcquisition(args, {
      fetchImpl: fetch,
      projectRoot: DEFAULT_PROJECT_ROOT,
      onSnapshotDirClaimed: (dir) => { claimedSnapshotDir = dir; },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (claimedSnapshotDir) cleanupPartialBrownlowSnapshot(claimedSnapshotDir);
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main();
}
