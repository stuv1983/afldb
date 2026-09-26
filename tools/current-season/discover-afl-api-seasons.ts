#!/usr/bin/env node
/**
 * AFLDB-ISSUE-233 — propose AFL API season registrations. PROPOSAL ONLY
 * (D-233-1): writes one reviewable proposal JSON and prints a summary. It
 * never edits `data/reference/afl-api-identities.json`, `seasons.json` or
 * `in_progress_seasons`; a reviewer copies `identitiesSeasonsAdditions` by hand.
 *
 * Usage (exactly one source):
 *   npx tsx tools/current-season/discover-afl-api-seasons.ts \
 *     --input <retained 00-compseasons.raw.json> --output <proposal.json>
 *   npx tsx tools/current-season/discover-afl-api-seasons.ts \
 *     --fetch --save-raw <new path for the raw bytes> --output <proposal.json>
 *
 * `--fetch` makes ONE public GET (no token) and is gated by the AFL API
 * current-season ingestion switch, exactly like `acquire-afl-api.ts`. The raw
 * bytes are retained verbatim at `--save-raw` before anything reads them, and
 * the proposal records their sha256. Neither output path may already exist.
 *
 * Exit 0 for `proposals` or `no_change`; exit 1 for `refused` (the proposal
 * file is still written, carrying the findings) or any error.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import {
  planAflApiCompSeasonsRequest,
  requestAflApi,
  resolveAflApiEndpointBases,
  type FetchLike,
} from '../../src/lib/acquisition/afl-api-client';
import {
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '../../src/lib/acquisition/afl-api-ingestion-control';
import {
  describeAflApiSeasonDiscovery,
  parseAflApiCompSeasons,
  proposeAflApiSeasons,
  serialiseAflApiSeasonDiscoveryProposal,
  type AflApiSeasonDiscoveryProposal,
} from '../../src/lib/acquisition/afl-api-season-discovery';
import { SETTING_KEYS } from '../../src/lib/site-settings';
import { loadEnv } from './load-env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export type DiscoverAflApiSeasonsArgs =
  | { source: 'input'; input: string; output: string }
  | { source: 'fetch'; saveRaw: string; output: string };

const KNOWN_FLAGS = new Set(['--input', '--fetch', '--save-raw', '--output']);
const VALUE_FLAGS = new Set(['--input', '--save-raw', '--output']);

export function parseDiscoverAflApiSeasonsArgs(argv: readonly string[]): DiscoverAflApiSeasonsArgs {
  const values = new Map<string, string>();
  let fetch = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`Unknown argument '${arg}'.`);
    if (arg === '--fetch') { fetch = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
    if (VALUE_FLAGS.has(arg)) values.set(arg, value);
    i += 1;
  }
  const output = values.get('--output');
  if (!output) throw new Error('--output <proposal.json> is required.');
  const input = values.get('--input');
  if (fetch === (input !== undefined)) throw new Error('Exactly one of --input <file> or --fetch is required.');
  if (fetch) {
    const saveRaw = values.get('--save-raw');
    if (!saveRaw) throw new Error('--fetch requires --save-raw <path> so the raw response is retained.');
    return { source: 'fetch', saveRaw, output };
  }
  if (values.has('--save-raw')) throw new Error('--save-raw applies only to --fetch.');
  return { source: 'input', input: input as string, output };
}

export type DiscoverAflApiSeasonsDeps = {
  projectRoot?: string;
  log?: (line: string) => void;
  fetchImpl?: FetchLike;
  /** Test-only escape hatch for the ingestion gate; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
};

function refuseExisting(path: string, what: string): void {
  if (existsSync(path)) throw new Error(`${what} '${path}' already exists; refusing to overwrite it.`);
}

export async function runDiscoverAflApiSeasons(
  argv: readonly string[], deps: DiscoverAflApiSeasonsDeps = {},
): Promise<AflApiSeasonDiscoveryProposal> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseDiscoverAflApiSeasonsArgs(argv);
  refuseExisting(args.output, 'Proposal file');

  let bytes: Buffer;
  let sourceFile: string;
  if (args.source === 'input') {
    bytes = readFileSync(args.input);
    sourceFile = args.input;
  } else {
    refuseExisting(args.saveRaw, 'Raw response file');
    const controls = deps.ingestionControls ?? await readAflApiIngestionControls();
    if (!controls.currentSeasonEnabled) {
      throw new Error(
        `AFL API current-season ingestion is disabled (site_settings '${SETTING_KEYS.aflApiCurrentSeasonEnabled}'). `
        + 'A super admin must enable it from /admin/current-season before this tool will make a network request.',
      );
    }
    const response = await requestAflApi(
      deps.fetchImpl ?? fetch, planAflApiCompSeasonsRequest(resolveAflApiEndpointBases(process.env)),
    );
    mkdirSync(dirname(args.saveRaw), { recursive: true });
    writeFileSync(args.saveRaw, response.bodyText, 'utf8');
    bytes = readFileSync(args.saveRaw);
    sourceFile = args.saveRaw;
  }

  const identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  const proposal = proposeAflApiSeasons({
    listing: parseAflApiCompSeasons(bytes.toString('utf8')),
    registered: identities.seasons,
    source: {
      file: relative(projectRoot, resolve(sourceFile)).split('\\').join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, serialiseAflApiSeasonDiscoveryProposal(proposal), 'utf8');
  for (const line of describeAflApiSeasonDiscovery(proposal)) log(line);
  log(`  proposal: ${args.output}`);
  return proposal;
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const proposal = await runDiscoverAflApiSeasons(process.argv.slice(2));
  if (proposal.verdict === 'refused') process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
